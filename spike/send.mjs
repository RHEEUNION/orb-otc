// Shields `AMOUNT_ORB` from the deployer wallet into a note owned by the given privacy address, via ShieldProbe.
import { readFileSync, writeFileSync } from 'node:fs';
import { ethers } from 'ethers';
import { createNoteDisclosureKey, NATIVE_ASSET_ID } from '@orbinum/protocol';
import { buildShieldNote, parsePrivacyAddress } from './note.mjs';

const addr = process.argv[2];
const amount = process.argv[3] ?? '0.02';
const env = Object.fromEntries(readFileSync('../.env', 'utf8').split('\n').filter(Boolean).map((l) => l.split('=')));
const PROBE = '0xa6Cc7d0b74Aa19188800d60A012493EfB4AC266f';

const provider = new ethers.JsonRpcProvider('https://rpc-1.testnet.orbinum.io');
const wallet = new ethers.Wallet(env.DEPLOYER_KEY, provider);
const probe = new ethers.Contract(PROBE, ['function shieldTo(uint32,bytes32,bytes) payable'], wallet);

const value = ethers.parseEther(amount);
const opts = JSON.parse(process.argv[4] ?? '{}');
console.log('variant:', JSON.stringify(opts));
const note = buildShieldNote(addr, value, Number(NATIVE_ASSET_ID), opts);
const { ownerPk } = parsePrivacyAddress(addr);
console.log('commitment:', note.commitment);

const tx = await probe.shieldTo(Number(NATIVE_ASSET_ID), note.commitment, note.memo, { value, gasLimit: 900000n });
console.log('tx:', tx.hash);
const r = await tx.wait();
console.log('status:', r.status, 'block:', r.blockNumber, 'gasUsed:', r.gasUsed.toString());

const disclosure = createNoteDisclosureKey({
  commitment: note.commitmentBig, value, assetId: BigInt(NATIVE_ASSET_ID), ownerPk, blinding: note.blinding,
});
writeFileSync('last-note.json', JSON.stringify({ tx: tx.hash, block: r.blockNumber, commitment: note.commitment, amount, disclosure }, null, 2));
console.log('saved spike/last-note.json');
