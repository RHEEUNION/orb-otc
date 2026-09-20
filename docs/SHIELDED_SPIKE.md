# Spike: shielded receive for OTC fills (internal)

Goal: can OrbOTC pay the ORB side of a fill into the taker's private note instead of a public transfer?

## Verified on testnet (chain 2700)

| Check | Result |
|---|---|
| ShieldedPool precompile address | `0x0000000000000000000000000000000000000801` (node `precompiles.rs`: `hash(2049)`; SDK `PRECOMPILE_ADDR.SHIELDED_POOL`) |
| `shield(uint32,bytes32,bytes)` selector | `0x9feb22ea`, matches `keccak256` of the signature |
| Native ORB asset id | `0` (`NATIVE_ASSET_ID`) |
| Memo size | exactly 180 bytes (`ENCRYPTED_MEMO_SIZE`) |
| Contract -> precompile with `msg.value` | **Works.** `contracts/spike/ShieldProbe.sol` shielded 0.01 ORB, tx status 1, ~300k gas, nothing left in the probe |
| Direct EOA -> precompile | Reverted in one attempt. Unexplained, not needed for the contract path |

`shield` needs no ZK proof, only `(assetId, commitment, memo)` and `msg.value`. That is what makes a contract-side shielded payout possible.

## What the SDK does and does not give a dapp

- `@orbinum/protocol` (npm, 0.5.0): calldata builders, payment slips, disclosure keys, addresses. **Holds no keys and cannot build a note commitment.**
- `@orbinum/protocol-core` (Rust repo with WASM bindings): `Crypto.computeCommitment(value, assetId, ownerPk, blinding)` and `EncryptedMemo.encryptMemo(...)`. **Not published to npm**, would need to be built from source.
- The Hub derives keys from a wallet signature. That scheme lives in the unpublished wallet SDK. `wallet-cli` derives from a mnemonic (spending key -> viewing / EdDSA keys), which is a different scheme.

## Design that avoids the key problem

The dapp must never derive or hold a spending key, so it should only ever handle **public** data:

1. Taker opens Orbinum Hub, copies their receiving info (owner public key + viewing public key, "privacy address").
2. Taker pastes it into the OTC fill dialog.
3. The site builds the note client-side: random blinding, `commitment = Poseidon4(amount, 0, ownerPk, blinding)`, memo encrypted to the taker's viewing key.
4. OrbOTC pays `shield(0, commitment, memo)` with the ORB amount instead of `call{value}`.
5. Taker sees the note in Hub after a rescan.

## Open items before building

1. Exact format of the Hub "privacy address" / receiving info (docs: Keys & Identity, Payment Slips).
2. A browser-usable Poseidon4 + memo encryption that matches the chain: build `protocol-core` WASM, or ask the team to publish it.
3. Confirm a note created this way is recognised by Hub after rescan (needs a real Hub-generated address).
4. Explain the direct-EOA `shield` revert.
5. Behaviour if the shield fails inside a fill: the whole fill must revert so no funds move (already true if the call result is required).

## Not possible

The tUSD side cannot be shielded: the pool only accepts registered and verified assets.
