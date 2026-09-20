import { unpackUsableViewingKey, BN254_R } from '@orbinum/protocol';
import { sha256 } from '@noble/hashes/sha2.js';
import { sha3_256, keccak_256 } from '@noble/hashes/sha3.js';
import { blake2b, blake2s } from '@noble/hashes/blake2.js';

const addr = 'orbpriv3:0x13704e7156d525934900daedab8c7e7f4c68e85df1b1d8942e3954673bd77775:0x9c81e14cc30fe2c2a9e7bf1791c3f9484454fc15909338d26044e458c86cf7ab:a8900a0f';
const [scheme, A, B, C] = addr.split(':');
const hex = (h) => Uint8Array.from(h.replace(/^0x/, '').match(/../g).map((x) => parseInt(x, 16)));
const be = (h) => BigInt(h);
const le = (h) => BigInt('0x' + [...hex(h)].reverse().map((b) => b.toString(16).padStart(2, '0')).join(''));

const p = BN254_R;
const modpow = (b, e, m) => { let r = 1n; b %= m; while (e > 0n) { if (e & 1n) r = r * b % m; b = b * b % m; e >>= 1n; } return r; };
const isSquare = (n) => n === 0n || modpow(n, (p - 1n) / 2n, p) === 1n;
const inv = (n) => modpow(((n % p) + p) % p, p - 2n, p);
const onCurveX = (x) => { const a = 168700n, d = 168696n; const num = ((1n - a * x * x) % p + p) % p; const den = ((1n - d * x * x) % p + p) % p; return isSquare(num * inv(den) % p); };

console.log('scheme', scheme);
for (const [name, f] of [['BE', be], ['LE', le]]) {
  const a = f(A);
  console.log(`A as ${name}: < r ? ${a < p}  x on curve? ${a < p && onCurveX(a)}`);
  const b = f(B);
  let pt = null; try { pt = unpackUsableViewingKey(b); } catch (e) { pt = 'err ' + e.message; }
  console.log(`B as ${name}: usable ivk point ->`, pt ? (Array.isArray(pt) ? 'YES ' + pt[0].toString(16).slice(0, 12) + '…' : pt) : 'null');
}

// checksum candidates
const target = C.toLowerCase();
const enc = new TextEncoder();
const inputs = {
  'str scheme:A:B': enc.encode(`${scheme}:${A}:${B}`),
  'str A:B': enc.encode(`${A}:${B}`),
  'str scheme+A+B nocolon': enc.encode(`${scheme}${A}${B}`),
  'bytes A||B': new Uint8Array([...hex(A), ...hex(B)]),
  'bytes scheme||A||B': new Uint8Array([...enc.encode(scheme), ...hex(A), ...hex(B)]),
  'str A+B hexnoprefix': enc.encode(A.slice(2) + B.slice(2)),
  'bytes 0x03||A||B': new Uint8Array([3, ...hex(A), ...hex(B)]),
  'bytes rev(A)||rev(B)': new Uint8Array([...hex(A).reverse(), ...hex(B).reverse()]),
};
const hashes = { sha256, sha256x2: (x) => sha256(sha256(x)), sha3_256, keccak_256, blake2b_32: (x) => blake2b(x, { dkLen: 32 }), blake2s };
let found = false;
for (const [iname, inp] of Object.entries(inputs)) for (const [hname, h] of Object.entries(hashes)) {
  const out = [...h(inp)].map((b) => b.toString(16).padStart(2, '0')).join('');
  if (out.startsWith(target) || out.endsWith(target)) { console.log('CHECKSUM MATCH:', hname, 'over', iname, out.startsWith(target) ? '(first 4 bytes)' : '(last 4 bytes)'); found = true; }
}
if (!found) console.log('checksum: no match among tested schemes');
