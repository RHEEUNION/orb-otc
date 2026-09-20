// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title OrbOTCV2
/// @notice Escrow order book: native ORB <-> a whitelisted ERC-20 quote token (tUSD on testnet, USDT and USDC on
///         mainnet), with these features:
///         1. Several quote tokens: the owner whitelists tokens. Each order is priced and settled in one of them.
///         2. Private receive: a taker filling a sell order can have the ORB paid into a shielded note
///            (Orbinum ShieldedPool precompile) instead of a public transfer.
///         3. Operator controls: pause and blocklist for new trading. Cancelling an order is ALWAYS possible,
///            and no admin function can move or hold user funds.
///         4. Fees on the quote leg: a maker fee locked into the order when it is placed, and a taker fee at the
///            rate in force when the order is filled. Both are capped at MAX_FEE_BPS. Fees accrue per token.
/// @dev Testnet build, unaudited. Price = quote base units per 1 ORB (1e18 wei), so it is decimal-agnostic.
///      Only whitelist standard tokens: fee-on-transfer and rebasing tokens are rejected at transfer time.
contract OrbOTCV2 {
    struct Order {
        address maker;
        bool isSell; // true: maker sells ORB for quote; false: maker buys ORB with quote
        bool open;
        uint16 makerFeeBps; // maker fee rate locked when the order was placed
        address quote; // token this order is priced and settled in
        uint256 price; // quote base units per 1e18 wei ORB
        uint256 remainingOrb; // wei of ORB still to trade
        uint256 remainingQuote; // buy orders only: quote still escrowed
        uint256 remainingFee; // buy orders only: maker fee still escrowed (on top of remainingQuote)
    }

    /// Orbinum ShieldedPool precompile (node: precompiles.rs hash(2049)).
    address public constant SHIELDED_POOL = 0x0000000000000000000000000000000000000801;
    uint32 public constant NATIVE_ASSET_ID = 0;
    uint256 public constant MEMO_SIZE = 180;
    uint16 public constant MAX_FEE_BPS = 100; // 1.00% per side, hard cap
    uint256 private constant BPS = 10_000;

    address public owner;
    bool public paused;
    mapping(address => bool) public blocked;

    mapping(address => bool) public quoteAllowed;
    address[] private _quoteList; // every token that was ever whitelisted, for the UI to enumerate

    uint16 public makerFeeBps;
    uint16 public takerFeeBps;
    address public feeRecipient; // address(0) disables fees
    mapping(address => uint256) public accruedFees; // per quote token, claimed with claimFees(token)

    uint256 public nextOrderId;
    mapping(uint256 => Order) public orders;

    uint256 private _lock = 1;

    modifier nonReentrant() {
        require(_lock == 1, "reentrancy");
        _lock = 2;
        _;
        _lock = 1;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "not owner");
        _;
    }

    /// Guards every action that opens or matches trading. Not applied to cancelOrder.
    modifier tradingAllowed() {
        require(!paused, "paused");
        require(!blocked[msg.sender], "blocked");
        _;
    }

    event OrderCreated(uint256 indexed id, address indexed maker, bool isSell, address quote, uint256 price, uint256 orbAmount);
    event OrderFilled(uint256 indexed id, address indexed taker, uint256 orbAmount, uint256 quoteAmount, bool privateReceive);
    event OrderCancelled(uint256 indexed id);
    event FeeCharged(uint256 indexed id, address indexed quote, uint256 makerFee, uint256 takerFee);
    event FeesUpdated(uint16 makerFeeBps, uint16 takerFeeBps);
    event FeeRecipientUpdated(address indexed recipient);
    event FeesClaimed(address indexed token, address indexed recipient, uint256 amount);
    event QuoteTokenSet(address indexed token, bool allowed);
    event Paused(address indexed by);
    event Unpaused(address indexed by);
    event BlockedSet(address indexed account, bool isBlocked, address indexed by);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    constructor(address[] memory quoteTokens, address feeRecipient_, uint16 makerFeeBps_, uint16 takerFeeBps_) {
        require(quoteTokens.length > 0, "no quote token");
        require(makerFeeBps_ <= MAX_FEE_BPS && takerFeeBps_ <= MAX_FEE_BPS, "fee too high");
        owner = msg.sender;
        feeRecipient = feeRecipient_;
        makerFeeBps = makerFeeBps_;
        takerFeeBps = takerFeeBps_;
        emit OwnershipTransferred(address(0), msg.sender);
        emit FeeRecipientUpdated(feeRecipient_);
        emit FeesUpdated(makerFeeBps_, takerFeeBps_);
        for (uint256 i = 0; i < quoteTokens.length; i++) _setQuote(quoteTokens[i], true);
    }

    // ---------------------------------------------------------------- admin (cannot touch user funds)

    function pause() external onlyOwner {
        paused = true;
        emit Paused(msg.sender);
    }

    function unpause() external onlyOwner {
        paused = false;
        emit Unpaused(msg.sender);
    }

    /// Add or remove addresses from the blocklist in one call.
    function setBlocked(address[] calldata accounts, bool isBlocked) external onlyOwner {
        for (uint256 i = 0; i < accounts.length; i++) {
            blocked[accounts[i]] = isBlocked;
            emit BlockedSet(accounts[i], isBlocked, msg.sender);
        }
    }

    /// Move admin rights, e.g. to a multisig before mainnet.
    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "zero owner");
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    /// Whitelist (or disable) a quote token. Disabling only stops NEW orders in that token: existing orders can still
    /// be filled or cancelled, so nobody's escrow is ever stranded.
    function setQuoteToken(address token, bool allowed) external onlyOwner {
        _setQuote(token, allowed);
    }

    function _setQuote(address token, bool allowed) internal {
        require(token.code.length > 0, "not a contract");
        if (allowed && !_isListed(token)) _quoteList.push(token);
        quoteAllowed[token] = allowed;
        emit QuoteTokenSet(token, allowed);
    }

    function _isListed(address token) internal view returns (bool) {
        for (uint256 i = 0; i < _quoteList.length; i++) if (_quoteList[i] == token) return true;
        return false;
    }

    /// Change fee rates. The maker rate only affects orders placed afterwards; the taker rate applies to later fills.
    function setFees(uint16 makerBps, uint16 takerBps) external onlyOwner {
        require(makerBps <= MAX_FEE_BPS && takerBps <= MAX_FEE_BPS, "fee too high");
        makerFeeBps = makerBps;
        takerFeeBps = takerBps;
        emit FeesUpdated(makerBps, takerBps);
    }

    /// Set who receives fees. address(0) turns fees off for new orders and fills.
    function setFeeRecipient(address recipient) external onlyOwner {
        feeRecipient = recipient;
        emit FeeRecipientUpdated(recipient);
    }

    /// Send all accrued fees in `token` to the fee recipient. Anyone may call it; funds only ever go to the recipient.
    function claimFees(address token) external nonReentrant {
        address to = feeRecipient;
        uint256 amt = accruedFees[token];
        require(to != address(0) && amt > 0, "nothing to claim");
        accruedFees[token] = 0;
        _push(token, to, amt);
        emit FeesClaimed(token, to, amt);
    }

    // ---------------------------------------------------------------- helpers

    function _effMakerBps() internal view returns (uint16) {
        return feeRecipient == address(0) ? 0 : makerFeeBps;
    }

    function _effTakerBps() internal view returns (uint256) {
        return feeRecipient == address(0) ? 0 : takerFeeBps;
    }

    function _fee(uint256 amount, uint256 bps) internal pure returns (uint256) {
        return (amount * bps) / BPS;
    }

    function _cost(uint256 orbAmount, uint256 price, bool roundUp) internal pure returns (uint256) {
        uint256 p = orbAmount * price;
        return roundUp ? (p + 1e18 - 1) / 1e18 : p / 1e18;
    }

    function _sendOrb(address to, uint256 amt) internal {
        (bool ok, ) = to.call{value: amt}("");
        require(ok, "ORB transfer failed");
    }

    function _shieldOrb(uint256 amt, bytes32 commitment, bytes calldata memo) internal {
        require(memo.length == MEMO_SIZE, "bad memo size");
        (bool ok, bytes memory ret) = SHIELDED_POOL.call{value: amt}(
            abi.encodeWithSignature("shield(uint32,bytes32,bytes)", NATIVE_ASSET_ID, commitment, memo)
        );
        if (!ok) {
            if (ret.length > 0) {
                assembly {
                    revert(add(ret, 32), mload(ret))
                }
            }
            revert("shield failed");
        }
    }

    // --- token transfers that tolerate tokens with no return value (USDT style) and reject fee-on-transfer tokens

    function _balance(address token) private view returns (uint256) {
        (bool ok, bytes memory data) = token.staticcall(abi.encodeWithSignature("balanceOf(address)", address(this)));
        require(ok && data.length >= 32, "balance read failed");
        return abi.decode(data, (uint256));
    }

    function _call(address token, bytes memory data) private {
        (bool ok, bytes memory ret) = token.call(data);
        require(ok && (ret.length == 0 || abi.decode(ret, (bool))), "token transfer failed");
    }

    function _pull(address token, address from, uint256 amt) internal {
        uint256 before = _balance(token);
        _call(token, abi.encodeWithSignature("transferFrom(address,address,uint256)", from, address(this), amt));
        require(_balance(token) - before == amt, "unsupported token");
    }

    function _push(address token, address to, uint256 amt) internal {
        _call(token, abi.encodeWithSignature("transfer(address,uint256)", to, amt));
    }

    // ---------------------------------------------------------------- create

    /// @notice Sell ORB: send ORB as msg.value, ask `price` units of `quote` per ORB.
    function createSellOrder(address quote, uint256 price) external payable nonReentrant tradingAllowed returns (uint256 id) {
        require(quoteAllowed[quote], "quote not allowed");
        require(msg.value > 0 && price > 0, "bad params");
        id = nextOrderId++;
        orders[id] = Order(msg.sender, true, true, _effMakerBps(), quote, price, msg.value, 0, 0);
        emit OrderCreated(id, msg.sender, true, quote, price, msg.value);
    }

    /// @notice Buy ORB: escrow `quote` (plus the maker fee) for `orbAmount` at `price` (requires prior approve).
    function createBuyOrder(address quote, uint256 price, uint256 orbAmount)
        external
        nonReentrant
        tradingAllowed
        returns (uint256 id)
    {
        require(quoteAllowed[quote], "quote not allowed");
        require(orbAmount > 0 && price > 0, "bad params");
        uint256 q = _cost(orbAmount, price, true);
        require(q > 0, "too small");
        uint16 mBps = _effMakerBps();
        uint256 mFee = _fee(q, mBps);
        _pull(quote, msg.sender, q + mFee);
        id = nextOrderId++;
        orders[id] = Order(msg.sender, false, true, mBps, quote, price, orbAmount, q, mFee);
        emit OrderCreated(id, msg.sender, false, quote, price, orbAmount);
    }

    // ---------------------------------------------------------------- fill

    function _takeSell(uint256 id, uint256 orbAmount) internal returns (uint256 q) {
        Order storage o = orders[id];
        require(o.open && o.isSell, "not fillable");
        require(!blocked[o.maker], "maker blocked");
        require(orbAmount > 0 && orbAmount <= o.remainingOrb, "bad amount");
        q = _cost(orbAmount, o.price, true);
        require(q > 0, "too small");
        o.remainingOrb -= orbAmount;
        if (o.remainingOrb == 0) o.open = false;
        uint256 mFee = _fee(q, o.makerFeeBps);
        uint256 tFee = _fee(q, _effTakerBps());
        _pull(o.quote, msg.sender, q + tFee); // taker pays the price plus the taker fee
        _push(o.quote, o.maker, q - mFee); // maker receives the price minus the maker fee
        if (mFee + tFee > 0) {
            accruedFees[o.quote] += mFee + tFee;
            emit FeeCharged(id, o.quote, mFee, tFee);
        }
    }

    /// @notice Take (part of) a sell order: pay quote, receive ORB publicly.
    function fillSellOrder(uint256 id, uint256 orbAmount) external nonReentrant tradingAllowed {
        uint256 q = _takeSell(id, orbAmount);
        _sendOrb(msg.sender, orbAmount);
        emit OrderFilled(id, msg.sender, orbAmount, q, false);
    }

    /// @notice Take (part of) a sell order and receive the ORB as a shielded note.
    /// @param commitment Note commitment built off-chain for the taker's privacy address.
    /// @param memo       180-byte encrypted memo of that note.
    /// The whole fill reverts if the shield call fails, so funds never move without a note.
    function fillSellOrderPrivate(uint256 id, uint256 orbAmount, bytes32 commitment, bytes calldata memo)
        external
        nonReentrant
        tradingAllowed
    {
        uint256 q = _takeSell(id, orbAmount);
        _shieldOrb(orbAmount, commitment, memo);
        emit OrderFilled(id, msg.sender, orbAmount, q, true);
    }

    /// @notice Take (part of) a buy order: send ORB as msg.value, receive quote. The maker receives ORB publicly.
    function fillBuyOrder(uint256 id) external payable nonReentrant tradingAllowed {
        Order storage o = orders[id];
        require(o.open && !o.isSell, "not fillable");
        require(!blocked[o.maker], "maker blocked");
        uint256 orbAmount = msg.value;
        require(orbAmount > 0 && orbAmount <= o.remainingOrb, "bad amount");
        bool last = orbAmount == o.remainingOrb;
        uint256 q = last ? o.remainingQuote : _cost(orbAmount, o.price, false);
        require(q > 0 && q <= o.remainingQuote, "too small");
        // The maker fee escrowed at creation is released in proportion to the fill (exact on the last fill).
        uint256 mFee = last ? o.remainingFee : (o.remainingFee * orbAmount) / o.remainingOrb;
        uint256 tFee = _fee(q, _effTakerBps());
        o.remainingOrb -= orbAmount;
        o.remainingQuote -= q;
        o.remainingFee -= mFee;
        if (o.remainingOrb == 0) o.open = false;
        _sendOrb(o.maker, orbAmount);
        _push(o.quote, msg.sender, q - tFee); // taker receives the price minus the taker fee
        if (mFee + tFee > 0) {
            accruedFees[o.quote] += mFee + tFee;
            emit FeeCharged(id, o.quote, mFee, tFee);
        }
        emit OrderFilled(id, msg.sender, orbAmount, q, false);
    }

    // ---------------------------------------------------------------- cancel (never restricted)

    /// @notice Cancel your own order and get the escrow (and unused maker fee) back. Works while paused or blocked,
    ///         and even if the quote token has since been disabled.
    function cancelOrder(uint256 id) external nonReentrant {
        Order storage o = orders[id];
        require(o.open && o.maker == msg.sender, "not cancellable");
        o.open = false;
        uint256 orb = o.remainingOrb;
        uint256 q = o.remainingQuote + o.remainingFee;
        o.remainingOrb = 0;
        o.remainingQuote = 0;
        o.remainingFee = 0;
        if (o.isSell) _sendOrb(msg.sender, orb);
        else _push(o.quote, msg.sender, q);
        emit OrderCancelled(id);
    }

    // ---------------------------------------------------------------- views

    /// @notice Every token ever whitelisted and whether it is currently allowed, for the UI.
    function getQuoteTokens() external view returns (address[] memory tokens, bool[] memory enabled) {
        tokens = _quoteList;
        enabled = new bool[](tokens.length);
        for (uint256 i = 0; i < tokens.length; i++) enabled[i] = quoteAllowed[tokens[i]];
    }

    /// @notice Paged read of all orders (open or not) for the UI.
    function getOrders(uint256 from, uint256 limit) external view returns (uint256[] memory ids, Order[] memory list) {
        uint256 end = from + limit;
        if (end > nextOrderId) end = nextOrderId;
        uint256 n = end > from ? end - from : 0;
        ids = new uint256[](n);
        list = new Order[](n);
        for (uint256 i = 0; i < n; i++) {
            ids[i] = from + i;
            list[i] = orders[from + i];
        }
    }
}
