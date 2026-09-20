// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20 {
    function transfer(address to, uint256 v) external returns (bool);
    function transferFrom(address from, address to, uint256 v) external returns (bool);
}

/// @title OrbOTCV2
/// @notice Escrow order book: native ORB <-> one ERC-20 quote token, with three additions over v1:
///         1. Private receive: a taker filling a sell order can have the ORB paid into a shielded note
///            (Orbinum ShieldedPool precompile) instead of a public transfer.
///         2. Operator controls: pause and blocklist for new trading. Cancelling an order is ALWAYS possible,
///            and no admin function can move or hold user funds.
///         3. Fees on the quote (stablecoin) leg: a maker fee locked into the order when it is placed, and a taker
///            fee at the rate in force when the order is filled. Both are capped at MAX_FEE_BPS.
/// @dev Testnet build, unaudited. Price = quote base units per 1 ORB (1e18 wei). Partial fills allowed.
contract OrbOTCV2 {
    struct Order {
        address maker;
        bool isSell; // true: maker sells ORB for quote; false: maker buys ORB with quote
        bool open;
        uint16 makerFeeBps; // maker fee rate locked when the order was placed
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

    IERC20 public immutable quote;
    address public owner;
    bool public paused;
    mapping(address => bool) public blocked;

    uint16 public makerFeeBps;
    uint16 public takerFeeBps;
    address public feeRecipient; // address(0) disables fees
    uint256 public accruedFees; // quote token owed to feeRecipient, claimed with claimFees()

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

    event OrderCreated(uint256 indexed id, address indexed maker, bool isSell, uint256 price, uint256 orbAmount);
    event OrderFilled(uint256 indexed id, address indexed taker, uint256 orbAmount, uint256 quoteAmount, bool privateReceive);
    event OrderCancelled(uint256 indexed id);
    event FeeCharged(uint256 indexed id, uint256 makerFee, uint256 takerFee);
    event FeesUpdated(uint16 makerFeeBps, uint16 takerFeeBps);
    event FeeRecipientUpdated(address indexed recipient);
    event FeesClaimed(address indexed recipient, uint256 amount);
    event Paused(address indexed by);
    event Unpaused(address indexed by);
    event BlockedSet(address indexed account, bool isBlocked, address indexed by);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    constructor(address quoteToken, address feeRecipient_, uint16 makerFeeBps_, uint16 takerFeeBps_) {
        require(makerFeeBps_ <= MAX_FEE_BPS && takerFeeBps_ <= MAX_FEE_BPS, "fee too high");
        quote = IERC20(quoteToken);
        owner = msg.sender;
        feeRecipient = feeRecipient_;
        makerFeeBps = makerFeeBps_;
        takerFeeBps = takerFeeBps_;
        emit OwnershipTransferred(address(0), msg.sender);
        emit FeeRecipientUpdated(feeRecipient_);
        emit FeesUpdated(makerFeeBps_, takerFeeBps_);
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

    /// Send all accrued fees to the fee recipient. Anyone may call it; funds only ever go to the recipient.
    function claimFees() external nonReentrant {
        address to = feeRecipient;
        uint256 amt = accruedFees;
        require(to != address(0) && amt > 0, "nothing to claim");
        accruedFees = 0;
        _push(to, amt);
        emit FeesClaimed(to, amt);
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

    function _pull(address from, uint256 amt) internal {
        require(quote.transferFrom(from, address(this), amt), "quote pull failed");
    }

    function _push(address to, uint256 amt) internal {
        require(quote.transfer(to, amt), "quote push failed");
    }

    // ---------------------------------------------------------------- create

    /// @notice Sell ORB: send ORB as msg.value, ask `price` quote units per ORB.
    function createSellOrder(uint256 price) external payable nonReentrant tradingAllowed returns (uint256 id) {
        require(msg.value > 0 && price > 0, "bad params");
        id = nextOrderId++;
        orders[id] = Order(msg.sender, true, true, _effMakerBps(), price, msg.value, 0, 0);
        emit OrderCreated(id, msg.sender, true, price, msg.value);
    }

    /// @notice Buy ORB: escrow quote (plus the maker fee) for `orbAmount` at `price` (requires prior approve).
    function createBuyOrder(uint256 price, uint256 orbAmount) external nonReentrant tradingAllowed returns (uint256 id) {
        require(orbAmount > 0 && price > 0, "bad params");
        uint256 q = _cost(orbAmount, price, true);
        require(q > 0, "too small");
        uint16 mBps = _effMakerBps();
        uint256 mFee = _fee(q, mBps);
        _pull(msg.sender, q + mFee);
        id = nextOrderId++;
        orders[id] = Order(msg.sender, false, true, mBps, price, orbAmount, q, mFee);
        emit OrderCreated(id, msg.sender, false, price, orbAmount);
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
        _pull(msg.sender, q + tFee); // taker pays the price plus the taker fee
        _push(o.maker, q - mFee); // maker receives the price minus the maker fee
        if (mFee + tFee > 0) {
            accruedFees += mFee + tFee;
            emit FeeCharged(id, mFee, tFee);
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
        _push(msg.sender, q - tFee); // taker receives the price minus the taker fee
        if (mFee + tFee > 0) {
            accruedFees += mFee + tFee;
            emit FeeCharged(id, mFee, tFee);
        }
        emit OrderFilled(id, msg.sender, orbAmount, q, false);
    }

    // ---------------------------------------------------------------- cancel (never restricted)

    /// @notice Cancel your own order and get the escrow (and unused maker fee) back. Works while paused or blocked.
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
        else _push(msg.sender, q);
        emit OrderCancelled(id);
    }

    // ---------------------------------------------------------------- views

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
