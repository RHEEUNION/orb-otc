import { readFileSync } from 'node:fs';
import { OrbinumClient } from '@orbinum/protocol';
const n = JSON.parse(readFileSync('last-note.json', 'utf8'));
const c = await OrbinumClient.connect({ substrateWs: 'wss://rpc-1.testnet.orbinum.io', evmRpc: 'https://rpc-1.testnet.orbinum.io' });
try {
  const p = await c.privacy.getMerkleProofByCommitment(n.commitment);
  console.log(JSON.stringify(p, (k, v) => (typeof v === 'bigint' ? v.toString() : v)).slice(0, 400));
} catch (e) { console.log('ERR', e.message); }
c.destroy(); process.exit(0);
