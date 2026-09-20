// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @dev Test double for the Orbinum ShieldedPool precompile. Its runtime code is placed at 0x...0801
///      with hardhat_setCode. It only records what a real shield() call would receive.
contract MockShieldedPool {
    uint32 public lastAssetId;
    bytes32 public lastCommitment;
    bytes public lastMemo;
    uint256 public lastValue;
    uint256 public count;
    bool public failNext;

    function setFailNext(bool v) external {
        failNext = v;
    }

    function shield(uint32 assetId, bytes32 commitment, bytes calldata memo) external payable {
        require(!failNext, "mock: shield rejected");
        lastAssetId = assetId;
        lastCommitment = commitment;
        lastMemo = memo;
        lastValue = msg.value;
        count += 1;
    }
}
