// Offline consistency test: generate a throwaway keypair, build a note for its address, decrypt it back.
import { sha256 } from '@noble/hashes/sha2.js';
import { BABYJUB_SUBORDER, bigintTo32Be, bytesToBigintLE } from '@orbinum/protocol';
import { buildShieldNote, decryptMemo, fastMulBase, packPoint, toHex } from './note.mjs';

const ivsk = bytesToBigintLE(crypto.getRandomValues(new Uint8Array(32))) % BABYJUB_SUBORDER || 1n;
const ivkPacked = packPoint(fastMulBase(ivsk));
const ownerSk = (ivsk + 12345n) % BABYJUB_SUBORDER;
const ownerAx = fastMulBase(ownerSk)[0];
const a = toHex(bigintTo32Be(ownerAx));
const b = toHex(bigintTo32Be(ivkPacked));
const chk = toHex(sha256(new TextEncoder().encode(`orbpriv3:${a}:${b}`))).slice(2, 10);
const addr = `orbpriv3:${a}:${b}:${chk}`;

const value = 20_000_000_000_000_000n; // 0.02 ORB
const n = buildShieldNote(addr, value);
const d = decryptMemo(n.memo, n.commitment, ivsk);
console.log('memo bytes:', (n.memo.length - 2) / 2);
console.log('roundtrip value ok:', d.value === value, '| owner ok:', d.ownerPk === ownerAx, '| blinding ok:', d.blinding === n.blinding, '| circuit:', d.circuitVersion);
