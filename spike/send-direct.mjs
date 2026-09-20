// Same note as send.mjs, but the EOA calls the ShieldedPool precompile (0x...0801) directly, like the Hub does.
import { readFileSync, writeFileSync } from 'node:fs';
import { ethers } from 'ethers';
import { NATIVE_ASSET_ID } from '@orbinum/protocol';
import { buildShieldNote } from './note.mjs';

const addr = process.argv[2];
const amount = process.argv[3] ?? '0.012';
const env = Object.fromEntries(readFileSync('../.env', 'utf8').split('\n').filter(Boolean).map((l) => l.split('=')));
const POOL = '0x0000000000000000000000000000000000000801';
const provider = new ethers.JsonRpcProvider('https://rpc-1.testnet.orbinum.io');
const wallet = new ethers.Wallet(env.DEPLOYER_KEY, provider);

const value = ethers.parseEther(amount);
const note = buildShieldNote(addr, value);
const iface = new ethers.Interface(['function shield(uint32,bytes32,bytes)']);
const data = iface.encodeFunctionData('shield', [Number(NATIVE_ASSET_ID), note.commitment, note.memo]);

const gas = await provider.estimateGas({ from: wallet.address, to: POOL, data, value });
console.log('estimated gas:', gas.toString(), 'commitment:', note.commitment);
const tx = await wallet.sendTransaction({ to: POOL, data, value, gasLimit: (gas * 12n) / 10n });
console.log('tx:', tx.hash);
const r = await tx.wait();
console.log('status:', r.status, 'block:', r.blockNumber, 'gasUsed:', r.gasUsed.toString());
writeFileSync('last-note.json', JSON.stringify({ tx: tx.hash, block: r.blockNumber, commitment: note.commitment, amount }, null, 2));
