// Same code path as the web UI: privacy.ts builds the note, viem sends fillSellOrderPrivate with the fixed gas.
import { readFileSync, writeFileSync } from 'node:fs';
import { createPublicClient, createWalletClient, http, parseEther, parseUnits, formatEther, defineChain, parseAbi } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { buildPrivateNote } from '../web/src/privacy.ts';
const orbinumTestnet = defineChain({ id: 2700, name: 'Orbinum Testnet', nativeCurrency: { name: 'ORB', symbol: 'ORB', decimals: 18 }, rpcUrls: { default: { http: ['https://rpc-1.testnet.orbinum.io'] } } });
const PRIVATE_FILL_GAS = 1_500_000n; // same constant as web/src/chain.ts
const otcAbi = parseAbi([
  'function createSellOrder(uint256 price) payable returns (uint256)',
  'function fillSellOrderPrivate(uint256 id, uint256 orbAmount, bytes32 commitment, bytes memo)',
  'function nextOrderId() view returns (uint256)',
]);

const ADDR = process.argv[2];
const dep = JSON.parse(readFileSync('../web/src/deployment.json', 'utf8'));
const env = Object.fromEntries(readFileSync('../.env', 'utf8').split('\n').filter(Boolean).map((l) => l.split('=')));
const burnerKey = JSON.parse(readFileSync('burner.json', 'utf8')).key;

const pub = createPublicClient({ chain: orbinumTestnet, transport: http() });
const maker = createWalletClient({ chain: orbinumTestnet, transport: http(), account: privateKeyToAccount(env.DEPLOYER_KEY as `0x${string}`) });
const taker = createWalletClient({ chain: orbinumTestnet, transport: http(), account: privateKeyToAccount(burnerKey) });
const otc = dep.otcV2 as `0x${string}`;
const wait = (hash: `0x${string}`) => pub.waitForTransactionReceipt({ hash });

const orb = parseEther('0.04');
const price = parseUnits('2', 6);
const id = (await pub.readContract({ address: otc, abi: otcAbi, functionName: 'nextOrderId' })) as bigint;
await wait(await maker.writeContract({ address: otc, abi: otcAbi, functionName: 'createSellOrder', args: [price], value: orb }));
console.log('order', id, 'created');

const note = buildPrivateNote(ADDR, orb);
const before = await pub.getBalance({ address: taker.account.address });
const hash = await taker.writeContract({
  address: otc, abi: otcAbi, functionName: 'fillSellOrderPrivate',
  args: [id, orb, note.commitment as `0x${string}`, note.memo as `0x${string}`], gas: PRIVATE_FILL_GAS,
});
const r = await wait(hash);
const after = await pub.getBalance({ address: taker.account.address });
console.log('status:', r.status, 'block:', r.blockNumber, 'tx:', hash);
console.log('taker public ORB change (gas only):', formatEther(after - before));
console.log('commitment:', note.commitment);
console.log('disclosure key:', note.disclosureKey.slice(0, 40) + '...');
writeFileSync('last-note.json', JSON.stringify({ tx: hash, commitment: note.commitment, amount: '0.04', via: 'privacy.ts + OrbOTCV2' }, null, 2));
process.exit(r.status === 'success' ? 0 : 1);
