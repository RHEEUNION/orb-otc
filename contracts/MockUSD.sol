// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Testnet-only quote token (tUSD, 6 decimals) with a public faucet.
contract MockUSD {
    string public constant name = "Test USD";
    string public constant symbol = "tUSD";
    uint8 public constant decimals = 6;
    uint256 public constant FAUCET_AMOUNT = 10_000e6;
    uint256 public constant FAUCET_COOLDOWN = 1 hours;

    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    mapping(address => uint256) public lastFaucet;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    function faucet() external {
        require(lastFaucet[msg.sender] == 0 || block.timestamp >= lastFaucet[msg.sender] + FAUCET_COOLDOWN, "cooldown");
        lastFaucet[msg.sender] = block.timestamp;
        totalSupply += FAUCET_AMOUNT;
        balanceOf[msg.sender] += FAUCET_AMOUNT;
        emit Transfer(address(0), msg.sender, FAUCET_AMOUNT);
    }

    function approve(address spender, uint256 value) external returns (bool) {
        allowance[msg.sender][spender] = value;
        emit Approval(msg.sender, spender, value);
        return true;
    }

    function transfer(address to, uint256 value) external returns (bool) {
        _move(msg.sender, to, value);
        return true;
    }

    function transferFrom(address from, address to, uint256 value) external returns (bool) {
        uint256 a = allowance[from][msg.sender];
        if (a != type(uint256).max) {
            require(a >= value, "allowance");
            allowance[from][msg.sender] = a - value;
        }
        _move(from, to, value);
        return true;
    }

    function _move(address from, address to, uint256 value) internal {
        require(balanceOf[from] >= value, "balance");
        balanceOf[from] -= value;
        balanceOf[to] += value;
        emit Transfer(from, to, value);
    }
}
