// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20 {
    function transfer(address to, uint256 v) external returns (bool);
    function transferFrom(address from, address to, uint256 v) external returns (bool);
}

/// @title OrbOTC
/// @notice Escrow order book: native ORB <-> a single ERC-20 quote token.
///         Price = quote-token base units per 1 ORB (1e18 wei). Partial fills allowed.
///         Testnet build: no fees, no admin, no upgradeability.
contract OrbOTC {
    struct Order {
        address maker;
        bool isSell; // true: maker sells ORB for quote; false: maker buys ORB with quote
        bool open;
        uint256 price; // quote base units per 1e18 wei ORB
        uint256 remainingOrb; // wei of ORB still to trade
        uint256 remainingQuote; // buy orders only: quote still escrowed
    }

    IERC20 public immutable quote;
    uint256 public nextOrderId;
    mapping(uint256 => Order) public orders;

    uint256 private _lock = 1;

    modifier nonReentrant() {
        require(_lock == 1, "reentrancy");
        _lock = 2;
        _;
        _lock = 1;
    }

    event OrderCreated(uint256 indexed id, address indexed maker, bool isSell, uint256 price, uint256 orbAmount);
    event OrderFilled(uint256 indexed id, address indexed taker, uint256 orbAmount, uint256 quoteAmount);
    event OrderCancelled(uint256 indexed id);

    constructor(address quoteToken) {
        quote = IERC20(quoteToken);
    }

    function _cost(uint256 orbAmount, uint256 price, bool roundUp) internal pure returns (uint256) {
        uint256 p = orbAmount * price;
        return roundUp ? (p + 1e18 - 1) / 1e18 : p / 1e18;
    }

    function _sendOrb(address to, uint256 amt) internal {
        (bool ok, ) = to.call{value: amt}("");
        require(ok, "ORB transfer failed");
    }

    function _pull(address from, uint256 amt) internal {
        require(quote.transferFrom(from, address(this), amt), "quote pull failed");
    }

    function _push(address to, uint256 amt) internal {
        require(quote.transfer(to, amt), "quote push failed");
    }

    /// @notice Sell ORB: send ORB as msg.value, ask `price` quote units per ORB.
    function createSellOrder(uint256 price) external payable nonReentrant returns (uint256 id) {
        require(msg.value > 0 && price > 0, "bad params");
        id = nextOrderId++;
        orders[id] = Order(msg.sender, true, true, price, msg.value, 0);
        emit OrderCreated(id, msg.sender, true, price, msg.value);
    }

    /// @notice Buy ORB: escrow quote for `orbAmount` at `price` (requires prior approve).
    function createBuyOrder(uint256 price, uint256 orbAmount) external nonReentrant returns (uint256 id) {
        require(orbAmount > 0 && price > 0, "bad params");
        uint256 q = _cost(orbAmount, price, true);
        require(q > 0, "too small");
        _pull(msg.sender, q);
        id = nextOrderId++;
        orders[id] = Order(msg.sender, false, true, price, orbAmount, q);
        emit OrderCreated(id, msg.sender, false, price, orbAmount);
    }

    /// @notice Take (part of) a sell order: pay quote, receive ORB.
    function fillSellOrder(uint256 id, uint256 orbAmount) external nonReentrant {
        Order storage o = orders[id];
        require(o.open && o.isSell, "not fillable");
        require(orbAmount > 0 && orbAmount <= o.remainingOrb, "bad amount");
        uint256 q = _cost(orbAmount, o.price, true);
        require(q > 0, "too small");
        o.remainingOrb -= orbAmount;
        if (o.remainingOrb == 0) o.open = false;
        _pull(msg.sender, q);
        _push(o.maker, q);
        _sendOrb(msg.sender, orbAmount);
        emit OrderFilled(id, msg.sender, orbAmount, q);
    }

    /// @notice Take (part of) a buy order: send ORB as msg.value, receive quote.
    function fillBuyOrder(uint256 id) external payable nonReentrant {
        Order storage o = orders[id];
        require(o.open && !o.isSell, "not fillable");
        uint256 orbAmount = msg.value;
        require(orbAmount > 0 && orbAmount <= o.remainingOrb, "bad amount");
        uint256 q = orbAmount == o.remainingOrb ? o.remainingQuote : _cost(orbAmount, o.price, false);
        require(q > 0 && q <= o.remainingQuote, "too small");
        o.remainingOrb -= orbAmount;
        o.remainingQuote -= q;
        if (o.remainingOrb == 0) o.open = false;
        _sendOrb(o.maker, orbAmount);
        _push(msg.sender, q);
        emit OrderFilled(id, msg.sender, orbAmount, q);
    }

    function cancelOrder(uint256 id) external nonReentrant {
        Order storage o = orders[id];
        require(o.open && o.maker == msg.sender, "not cancellable");
        o.open = false;
        uint256 orb = o.remainingOrb;
        uint256 q = o.remainingQuote;
        o.remainingOrb = 0;
        o.remainingQuote = 0;
        if (o.isSell) _sendOrb(msg.sender, orb);
        else _push(msg.sender, q);
        emit OrderCancelled(id);
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
