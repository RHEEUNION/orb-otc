// Builds an Orbinum shielded note for a recipient's PUBLIC privacy address, entirely in the browser.
// No private key is ever read or derived here. Formats follow the Orbinum node
// (primitives/encrypted-memo) and were checked against a real Hub vault (see docs/SHIELDED_SPIKE.md).
import { Base8, mulPointEscalar, packPoint, unpackPoint } from "@zk-kit/baby-jubjub";
import { poseidon4 } from "poseidon-lite";
import { chacha20poly1305 } from "@noble/ciphers/chacha.js";
import { sha256 } from "@noble/hashes/sha2.js";

export const BN254_R = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
export const BJJ_SUBORDER = 2736030358979909402780800718157159386076813972158567259200215660948447373041n;
export const NATIVE_ASSET_ID = 0;
export const CIRCUIT_VERSION = 1; // active on testnet (unshield and transfer circuits)
export const MEMO_SIZE = 180;

type Point = [bigint, bigint];
const enc = new TextEncoder();
const KEY_DOMAIN = enc.encode("orbinum-note-encryption-v1");
const VIEW_TAG_DOMAIN = enc.encode("orbinum-view-tag-v1");

export function hexToBytes(hex: string): Uint8Array {
  const h = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (h.length % 2 !== 0 || /[^0-9a-f]/i.test(h)) throw new Error("bad hex");
  return Uint8Array.from(h.match(/../g) ?? [], (b) => parseInt(b, 16));
}
export const bytesToHex = (u: Uint8Array) => "0x" + Array.from(u, (b) => b.toString(16).padStart(2, "0")).join("");
export function bigintTo32Le(n: bigint): Uint8Array {
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    out[i] = Number(n & 0xffn);
    n >>= 8n;
  }
  return out;
}
export function bytesToBigintLE(b: Uint8Array): bigint {
  let n = 0n;
  for (let i = b.length - 1; i >= 0; i--) n = (n << 8n) | BigInt(b[i]);
  return n;
}
const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
};
const randomBytes = (n: number) => crypto.getRandomValues(new Uint8Array(n));
function randomScalar(mod: bigint): bigint {
  for (;;) {
    const v = bytesToBigintLE(randomBytes(32)) % mod;
    if (v > 0n) return v;
  }
}
const isIdentity = (p: Point) => p[0] === 0n && p[1] === 1n;

/** Rejects points of the small (cofactor 8) subgroup: a note sealed to one would be readable by anyone. */
function unpackUsablePoint(packed: bigint): Point | null {
  const p = unpackPoint(packed) as Point | null;
  if (!p || isIdentity(p)) return null;
  if (isIdentity(mulPointEscalar(p, 8n) as Point)) return null;
  return p;
}

export type ParsedAddress = { ownerPk: bigint; ivkPoint: Point };

/** `orbpriv3:<owner Ax, 0x BE>:<packed viewing pubkey bytes, read LE>:<sha256("orbpriv3:A:B")[0..4]>` */
export function parsePrivacyAddress(text: string): ParsedAddress {
  const parts = text.trim().split(":");
  if (parts.length !== 4 || parts[0] !== "orbpriv3") throw new Error("Not an orbpriv3 privacy address");
  const [scheme, a, b, checksum] = parts;
  if (!/^0x[0-9a-f]{64}$/i.test(a) || !/^0x[0-9a-f]{64}$/i.test(b) || !/^[0-9a-f]{8}$/i.test(checksum))
    throw new Error("Malformed privacy address");
  const expected = bytesToHex(sha256(enc.encode(`${scheme}:${a}:${b}`))).slice(2, 10);
  if (expected !== checksum.toLowerCase()) throw new Error("Checksum mismatch. Copy the whole address from Orbinum Hub.");
  const ownerPk = BigInt(a);
  if (ownerPk === 0n || ownerPk >= BN254_R) throw new Error("Invalid owner key");
  const ivkPoint = unpackUsablePoint(bytesToBigintLE(hexToBytes(b)));
  if (!ivkPoint) throw new Error("Unusable viewing key");
  return { ownerPk, ivkPoint };
}

const base64Url = (s: string) => {
  const bytes = enc.encode(s);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const hx = (n: bigint) => "0x" + n.toString(16);

/** `orbdisc:` key: proves a note's value and asset without any spend power (same format as the Orbinum SDK). */
export function disclosureKey(n: { commitment: bigint; value: bigint; assetId: bigint; ownerPk: bigint; blinding: bigint }) {
  return (
    "orbdisc:" +
    base64Url(JSON.stringify({ v: 1, c: hx(n.commitment), val: hx(n.value), aid: hx(n.assetId), opk: hx(n.ownerPk), bld: hx(n.blinding) }))
  );
}

export type PrivateNote = { commitment: string; memo: string; disclosureKey: string };

export function buildPrivateNote(privacyAddress: string, valueWei: bigint, assetId = NATIVE_ASSET_ID): PrivateNote {
  const { ownerPk, ivkPoint } = parsePrivacyAddress(privacyAddress);
  const blinding = randomScalar(BN254_R);
  const commitmentBig = poseidon4([valueWei, BigInt(assetId), ownerPk, blinding]);
  const commitmentBytes = bigintTo32Le(commitmentBig);

  // plaintext (120 B): value_lo | value_hi | owner_pk LE | blinding LE | asset_id | counterparty (0) | circuit_version
  const pt = new Uint8Array(120);
  const dv = new DataView(pt.buffer);
  dv.setBigUint64(0, valueWei & 0xffff_ffff_ffff_ffffn, true);
  dv.setBigUint64(8, valueWei >> 64n, true);
  pt.set(bigintTo32Le(ownerPk), 16);
  pt.set(bigintTo32Le(blinding), 48);
  dv.setUint32(80, assetId, true);
  dv.setUint32(116, CIRCUIT_VERSION, true);

  // ECDH to the recipient's viewing key: shared = (ivk * ephSk).x
  const ephSk = randomScalar(BJJ_SUBORDER);
  const ephPk = mulPointEscalar(Base8, ephSk) as Point;
  const shared = bigintTo32Le((mulPointEscalar(ivkPoint, ephSk) as Point)[0]);
  const key = sha256(concat(shared, commitmentBytes, KEY_DOMAIN));
  const nonce = randomBytes(12);
  nonce[0] = sha256(concat(VIEW_TAG_DOMAIN, shared))[0]; // scan hint used by wallets
  const ciphertext = chacha20poly1305(key, nonce).encrypt(pt); // 120 + 16-byte MAC
  const memo = concat(nonce, ciphertext, bigintTo32Le(packPoint(ephPk)));
  if (memo.length !== MEMO_SIZE) throw new Error(`memo size ${memo.length}`);

  return {
    commitment: bytesToHex(commitmentBytes),
    memo: bytesToHex(memo),
    disclosureKey: disclosureKey({ commitment: commitmentBig, value: valueWei, assetId: BigInt(assetId), ownerPk, blinding }),
  };
}

/** Recipient-side check used in tests only (needs the viewing secret). */
export function tryOpenNote(memoHex: string, commitmentHex: string, ivsk: bigint) {
  const m = hexToBytes(memoHex);
  const c = hexToBytes(commitmentHex);
  const eph = unpackUsablePoint(bytesToBigintLE(m.slice(148)));
  if (!eph) return null;
  const shared = bigintTo32Le((mulPointEscalar(eph, ivsk) as Point)[0]);
  const key = sha256(concat(shared, c, KEY_DOMAIN));
  const pt = chacha20poly1305(key, m.slice(0, 12)).decrypt(m.slice(12, 148));
  const dv = new DataView(pt.buffer, pt.byteOffset);
  return {
    value: dv.getBigUint64(0, true) | (dv.getBigUint64(8, true) << 64n),
    ownerPk: bytesToBigintLE(pt.slice(16, 48)),
    blinding: bytesToBigintLE(pt.slice(48, 80)),
    assetId: dv.getUint32(80, true),
    circuitVersion: dv.getUint32(116, true),
    viewTagOk: m[0] === sha256(concat(VIEW_TAG_DOMAIN, shared))[0],
  };
}

export const helpers = { packPoint, mulPointEscalar, Base8, sha256, bytesToBigintLE, bigintTo32Le, bytesToHex };
