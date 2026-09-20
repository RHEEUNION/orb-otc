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

## Privacy address format (reverse-engineered, checksum verified)

`orbpriv3:<0x owner Ax, big-endian>:<0x packed viewing pubkey, big-endian>:<8 hex checksum>`

- checksum = first 4 bytes of `sha256("orbpriv3:<A>:<B>")` (matches the real address from Hub)
- A is a valid BabyJubJub x-coordinate only when read big-endian; B unpacks to a usable point
- Not documented publicly; derived from the value itself. Confirm with the Orbinum team before shipping.

## Note construction (implemented in `spike/note.mjs`, JS only, public keys only)

- `commitment = Poseidon4(value, assetId, ownerAx, blinding)` via `poseidon-lite`, sent on-chain as LE bytes (`commitmentHexOf`)
- memo plaintext (120 B): `value_lo | value_hi | owner_pk LE | blinding LE | asset_id | counterparty(0) | circuit_version`
- `ephSk` random, `shared = (ivkPoint * ephSk).x` LE, `key = SHA256(shared || commitment || "orbinum-note-encryption-v1")`
- `ChaCha20-Poly1305(key, nonce12)` -> `nonce(12) | ct(120) | MAC(16) | ephPk packed LE(32)` = 180 B
- Source of truth is `node/primitives/encrypted-memo`. `@orbinum/protocol-core` is **stale** (104-byte symmetric memo) and must not be used.
- Offline self-test: build note for a throwaway keypair, decrypt back (value, owner, blinding, circuit version all match).

## Open items before building

1. ~~Format of the privacy address~~ reverse-engineered, see above; still worth confirming with the team.
2. ~~Browser-usable crypto~~ done in JS with the SDK's own dependencies (no WASM needed).
3. **Hub recognition:** a 0.02 ORB note was shielded to a real Hub address (tx `0xb446d578…ba02`, block 930207). Awaiting confirmation that it appears in the Hub vault after unlock/rescan.
4. Explain the direct-EOA `shield` revert.
5. Behaviour if the shield fails inside a fill: the whole fill must revert so no funds move (already true if the call result is required).

## Not possible

The tUSD side cannot be shielded: the pool only accepts registered and verified assets.
