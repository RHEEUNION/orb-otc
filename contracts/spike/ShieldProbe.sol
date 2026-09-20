// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// Spike: can a contract call the Orbinum ShieldedPool precompile (0x...0801) with value?
contract ShieldProbe {
    address constant SHIELDED_POOL = 0x0000000000000000000000000000000000000801;

    event Shielded(address indexed caller, bytes32 commitment, uint256 amount);

    function shieldTo(uint32 assetId, bytes32 commitment, bytes calldata memo) external payable {
        (bool ok, bytes memory ret) = SHIELDED_POOL.call{value: msg.value}(
            abi.encodeWithSignature("shield(uint32,bytes32,bytes)", assetId, commitment, memo)
        );
        if (!ok) {
            assembly { revert(add(ret, 32), mload(ret)) }
        }
        emit Shielded(msg.sender, commitment, msg.value);
    }
}
