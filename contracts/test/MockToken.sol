// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @dev Configurable ERC-20 double for tests: any decimals, optional USDT-style missing return values,
///      optional fee-on-transfer behaviour.
contract MockToken {
    string public name = "Mock";
    string public symbol = "MOCK";
    uint8 public immutable decimals;
    bool public immutable returnsBool; // false mimics USDT on Ethereum (no return value)
    uint256 public immutable feeBps; // > 0 mimics a fee-on-transfer token

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    constructor(uint8 decimals_, bool returnsBool_, uint256 feeBps_) {
        decimals = decimals_;
        returnsBool = returnsBool_;
        feeBps = feeBps_;
    }

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function approve(address spender, uint256 value) external returns (bool) {
        allowance[msg.sender][spender] = value;
        return true;
    }

    function transfer(address to, uint256 value) external {
        _move(msg.sender, to, value);
        _ret();
    }

    function transferFrom(address from, address to, uint256 value) external {
        uint256 a = allowance[from][msg.sender];
        require(a >= value, "allowance");
        allowance[from][msg.sender] = a - value;
        _move(from, to, value);
        _ret();
    }

    function _move(address from, address to, uint256 value) internal {
        require(balanceOf[from] >= value, "balance");
        uint256 fee = (value * feeBps) / 10_000;
        balanceOf[from] -= value;
        balanceOf[to] += value - fee;
    }

    /// Returns `true` for standard tokens; returns nothing at all for USDT-style ones.
    function _ret() private view {
        if (returnsBool) {
            assembly {
                mstore(0x00, 1)
                return(0x00, 0x20)
            }
        }
    }
}
