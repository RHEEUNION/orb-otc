import { OrbinumClient } from '@orbinum/protocol';
const notes = {
  '0.020 (BE ivk, no tag, via contract)': '0x35edb853c1266a2e17f2b7cdd26369e65a7610454993439f77d416b7d6b9d900',
  '0.011 (LE ivk, no tag, via contract)': '0xbd7e871ea3696c9726f628dae20c4ec316f2aa053d94a217ba109d84b3d61730',
  '0.013 (LE ivk + tag, via contract)': '0xa73d0d1df4a7c521d458f55d2ecde6726389943cf02225bb6c8d0bfbf587b10e',
  '0.012 (LE ivk + tag, direct EOA)': '0x5b4c0a4e74af4e93004214f9ec00e28b63c921be262a65a99e476569c0c5650d',
};
const c = await OrbinumClient.connect({ substrateWs: 'wss://rpc-1.testnet.orbinum.io', evmRpc: 'https://rpc-1.testnet.orbinum.io' });
const stats = await c.privacy.getPoolStats();
console.log('pool commitmentCount now:', stats.commitmentCount);
for (const [k, h] of Object.entries(notes)) {
  try { const p = await c.privacy.getMerkleProofByCommitment(h); console.log(k, '-> leafIndex', p.leafIndex ?? Object.keys(p)); }
  catch (e) { console.log(k, 'ERR', e.message); }
}
c.destroy(); process.exit(0);
