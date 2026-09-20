// Parity check: the browser module (web/src/privacy.ts) must agree with the spike implementation
// that the real Hub vault accepted (note.mjs, built on the Orbinum SDK).
import { createNoteDisclosureKey, decodeNoteDisclosureKey, fastMulBase, bigintTo32Be, BABYJUB_SUBORDER, bytesToBigintLE } from '@orbinum/protocol';
import { sha256 } from '@noble/hashes/sha2.js';
import { buildPrivateNote, disclosureKey, tryOpenNote, parsePrivacyAddress, helpers, bytesToHex } from '../web/src/privacy.ts';
import { packPoint } from '@zk-kit/baby-jubjub';
import { bigintTo32Le } from '@orbinum/protocol';

const REAL = 'orbpriv3:0x13704e7156d525934900daedab8c7e7f4c68e85df1b1d8942e3954673bd77775:0x9c81e14cc30fe2c2a9e7bf1791c3f9484454fc15909338d26044e458c86cf7ab:a8900a0f';
let failed = 0;
const check = (name: string, ok: boolean) => { console.log(ok ? 'ok  ' : 'FAIL', name); if (!ok) failed++; };

// 1. real Hub address parses in the browser module
try { parsePrivacyAddress(REAL); check('real Hub address parses', true); } catch (e) { check('real Hub address parses: ' + (e as Error).message, false); }

// 2. disclosure key is byte-identical to the SDK's and decodes/verifies with the SDK
const sample = { commitment: 123456789n, value: 50000000000000000n, assetId: 0n, ownerPk: 987654321n, blinding: 555n };
check('disclosure key identical to SDK', disclosureKey(sample) === createNoteDisclosureKey(sample));

// 3. throwaway recipient: build a note, open it with the viewing secret, check everything
const ivsk = bytesToBigintLE(crypto.getRandomValues(new Uint8Array(32))) % BABYJUB_SUBORDER || 1n;
const ownerAx = fastMulBase(((ivsk + 777n) % BABYJUB_SUBORDER))[0];
const a = '0x' + ownerAx.toString(16).padStart(64, '0');
const b = bytesToHex(bigintTo32Le(packPoint(fastMulBase(ivsk))));
const chk = bytesToHex(sha256(new TextEncoder().encode(`orbpriv3:${a}:${b}`))).slice(2, 10);
const addr = `orbpriv3:${a}:${b}:${chk}`;
const value = 50_000_000_000_000_000n;
const n = buildPrivateNote(addr, value);
const opened = tryOpenNote(n.memo, n.commitment, ivsk);
check('memo is 180 bytes', (n.memo.length - 2) / 2 === 180);
check('recipient opens the note', !!opened);
check('value matches', opened?.value === value);
check('owner matches', opened?.ownerPk === ownerAx);
check('view tag matches', opened?.viewTagOk === true);
check('circuit version 1', opened?.circuitVersion === 1);

// 4. commitment equals Poseidon4 as verified by the SDK's own decoder
const dec = decodeNoteDisclosureKey(n.disclosureKey);
check('SDK verifies our disclosure key (Poseidon4 matches)', dec !== null && dec.value === value);
check('commitment bytes match disclosure commitment (LE)', dec !== null && n.commitment === bytesToHex(bigintTo32Le(dec.commitment)));

// 5. bad inputs are rejected
for (const [name, bad] of [['wrong checksum', REAL.replace(/:[0-9a-f]{8}$/, ':00000000')], ['wrong scheme', REAL.replace('orbpriv3', 'orbpriv9')], ['truncated', REAL.slice(0, 60)]] as const) {
  let rejected = false; try { parsePrivacyAddress(bad); } catch { rejected = true; }
  check('rejects ' + name, rejected);
}

console.log(failed === 0 ? '\nPARITY OK' : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
