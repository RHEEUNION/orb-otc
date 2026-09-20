// Builds a shield note for a recipient's PUBLIC privacy address. Handles no private keys.
// Format sources: node/primitives/encrypted-memo (memo.rs, keys.rs), @orbinum/protocol SDK.
import {
  BN254_R,
  BABYJUB_SUBORDER,
  NATIVE_ASSET_ID,
  CURRENT_CIRCUIT_VERSION,
  bigintTo32Le,
  bytesToBigintLE,
  commitmentHexOf,
  createNoteDisclosureKey,
  decodeNoteDisclosureKey,
  fastMulBase,
  fastMulPoint,
  unpackUsableViewingKey,
} from '@orbinum/protocol';
import { packPoint } from '@zk-kit/baby-jubjub';
import { poseidon4 } from 'poseidon-lite';
import { chacha20poly1305 } from '@noble/ciphers/chacha.js';
import { sha256 } from '@noble/hashes/sha2.js';

const KEY_DOMAIN = new TextEncoder().encode('orbinum-note-encryption-v1');
const toHex = (u8) => '0x' + [...u8].map((b) => b.toString(16).padStart(2, '0')).join('');
const randBytes = (n) => crypto.getRandomValues(new Uint8Array(n));
const randScalar = (mod) => {
  for (;;) {
    const v = bytesToBigintLE(randBytes(32)) % mod;
    if (v > 0n) return v;
  }
};

/** orbpriv3:<ownerAx 0x BE>:<packed ivk 0x BE>:<sha256("orbpriv3:A:B")[0..4] hex> */
export function parsePrivacyAddress(text) {
  const parts = text.trim().split(':');
  if (parts.length !== 4 || parts[0] !== 'orbpriv3') throw new Error('Not an orbpriv3 privacy address');
  const [scheme, a, b, checksum] = parts;
  if (!/^0x[0-9a-f]{64}$/i.test(a) || !/^0x[0-9a-f]{64}$/i.test(b) || !/^[0-9a-f]{8}$/i.test(checksum))
    throw new Error('Malformed privacy address');
  const expect = toHex(sha256(new TextEncoder().encode(`${scheme}:${a}:${b}`))).slice(2, 10);
  if (expect !== checksum.toLowerCase()) throw new Error('Privacy address checksum mismatch');
  const ownerPk = BigInt(a);
  if (ownerPk === 0n || ownerPk >= BN254_R) throw new Error('Invalid owner key');
  const ivk = unpackUsableViewingKey(BigInt(b));
  if (!ivk) throw new Error('Unusable viewing key');
  return { ownerPk, ivkPoint: ivk };
}

/** @returns {{commitment: string, memo: string, blinding: bigint, commitmentBig: bigint}} */
export function buildShieldNote(privacyAddress, valueWei, assetId = Number(NATIVE_ASSET_ID)) {
  const { ownerPk, ivkPoint } = parsePrivacyAddress(privacyAddress);
  const blinding = randScalar(BN254_R);
  const commitmentBig = poseidon4([valueWei, BigInt(assetId), ownerPk, blinding]);

  // Self-check against the SDK's own Poseidon4 verifier.
  const key = createNoteDisclosureKey({ commitment: commitmentBig, value: valueWei, assetId: BigInt(assetId), ownerPk, blinding });
  if (!decodeNoteDisclosureKey(key)) throw new Error('commitment self-check failed');

  const commitment = commitmentHexOf(commitmentBig);
  const commitmentBytes = Uint8Array.from(commitment.slice(2).match(/../g).map((h) => parseInt(h, 16)));

  // plaintext: value_lo(8) value_hi(8) owner_pk(32 LE) blinding(32 LE) asset_id(4) counterparty(32) circuit_version(4) = 120
  const pt = new Uint8Array(120);
  const dv = new DataView(pt.buffer);
  dv.setBigUint64(0, valueWei & 0xffff_ffff_ffff_ffffn, true);
  dv.setBigUint64(8, valueWei >> 64n, true);
  pt.set(bigintTo32Le(ownerPk), 16);
  pt.set(bigintTo32Le(blinding), 48);
  dv.setUint32(80, assetId, true);
  dv.setUint32(116, CURRENT_CIRCUIT_VERSION, true);

  // ECDH: ephSk random, shared = (ivk * ephSk).x (LE), key = SHA256(shared || commitment || domain)
  const ephSk = randScalar(BABYJUB_SUBORDER);
  const ephPk = fastMulBase(ephSk);
  const shared = bigintTo32Le(fastMulPoint(ivkPoint, ephSk)[0]);
  const encKey = sha256(new Uint8Array([...shared, ...commitmentBytes, ...KEY_DOMAIN]));
  const nonce = randBytes(12);
  const ct = chacha20poly1305(encKey, nonce).encrypt(pt); // 120 + 16 MAC
  const memoBytes = new Uint8Array([...nonce, ...ct, ...bigintTo32Le(packPoint(ephPk))]);
  if (memoBytes.length !== 180) throw new Error('memo size ' + memoBytes.length);

  return { commitment, memo: toHex(memoBytes), blinding, commitmentBig, ephPkBytes: memoBytes.slice(148) };
}

/** Recipient-side decrypt (for self-tests only; needs ivsk). */
export function decryptMemo(memoHex, commitmentHex, ivsk) {
  const m = Uint8Array.from(memoHex.slice(2).match(/../g).map((h) => parseInt(h, 16)));
  const c = Uint8Array.from(commitmentHex.slice(2).match(/../g).map((h) => parseInt(h, 16)));
  const ephPacked = bytesToBigintLE(m.slice(148));
  const ephPt = unpackUsableViewingKey(ephPacked);
  const shared = bigintTo32Le(fastMulPoint(ephPt, ivsk)[0]);
  const encKey = sha256(new Uint8Array([...shared, ...c, ...KEY_DOMAIN]));
  const pt = chacha20poly1305(encKey, m.slice(0, 12)).decrypt(m.slice(12, 148));
  const dv = new DataView(pt.buffer, pt.byteOffset);
  return {
    value: dv.getBigUint64(0, true) | (dv.getBigUint64(8, true) << 64n),
    ownerPk: bytesToBigintLE(pt.slice(16, 48)),
    blinding: bytesToBigintLE(pt.slice(48, 80)),
    assetId: dv.getUint32(80, true),
    circuitVersion: dv.getUint32(116, true),
  };
}

export { packPoint, fastMulBase, toHex };
