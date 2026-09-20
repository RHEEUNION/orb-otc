// End-to-end check of OrbOTCV2 on the real testnet, using a one-time taker wallet.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { ethers } from 'ethers';
import { buildShieldNote } from './note.mjs';

const ADDR = process.argv[2]; // taker's privacy address (public)
const dep = JSON.parse(readFileSync('../web/src/deployment.json', 'utf8'));
const env = Object.fromEntries(readFileSync('../.env', 'utf8').split('\n').filter(Boolean).map((l) => l.split('=')));
const abi = JSON.parse(readFileSync('../artifacts/contracts/OrbOTCV2.sol/OrbOTCV2.json', 'utf8')).abi;
const usdAbi = ['function faucet()', 'function approve(address,uint256) returns (bool)', 'function balanceOf(address) view returns (uint256)'];

const provider = new ethers.JsonRpcProvider('https://rpc-1.testnet.orbinum.io');
const admin = new ethers.Wallet(env.DEPLOYER_KEY, provider);
let burnerKey;
if (existsSync('burner.json')) burnerKey = JSON.parse(readFileSync('burner.json', 'utf8')).key;
else { burnerKey = ethers.Wallet.createRandom().privateKey; writeFileSync('burner.json', JSON.stringify({ key: burnerKey })); }
const burner = new ethers.Wallet(burnerKey, provider);

const otcAdmin = new ethers.Contract(dep.otcV2, abi, admin);
const otcTaker = new ethers.Contract(dep.otcV2, abi, burner);
const usdTaker = new ethers.Contract(dep.quote, usdAbi, burner);
const step = async (label, p) => { const tx = await p; const r = await tx.wait(); console.log('ok:', label, '| gas', r.gasUsed.toString()); return r; };
const expectRevert = async (label, p) => {
  try { const tx = await p; await tx.wait(); console.log('FAIL (should have reverted):', label); process.exitCode = 1; }
  catch (e) { console.log('ok (reverted as expected):', label, '->', (e.reason ?? e.shortMessage ?? e.message).slice(0, 60)); }
};

console.log('one-time taker:', burner.address);
if ((await provider.getBalance(burner.address)) < ethers.parseEther('0.2'))
  await step('fund taker 0.3 ORB', admin.sendTransaction({ to: burner.address, value: ethers.parseEther('0.3') }));
await step('taker: tUSD faucet', usdTaker.faucet().catch(() => null) ?? Promise.resolve({ wait: async () => ({ gasUsed: 0n }) }));
await step('taker: approve tUSD', usdTaker.approve(dep.otcV2, ethers.MaxUint256));

const price = ethers.parseUnits('1.5', 6);
const orbAmount = ethers.parseEther('0.05');
const id = await otcAdmin.nextOrderId();
await step('maker: create sell order 0.05 ORB @ 1.5', otcAdmin.createSellOrder(price, { value: orbAmount }));

// pause -> taker cannot fill; maker can still cancel is covered in unit tests; here check the gate
await step('admin: pause', otcAdmin.pause());
const note0 = buildShieldNote(ADDR, orbAmount);
await expectRevert('fill while paused', otcTaker.fillSellOrderPrivate(id, orbAmount, note0.commitment, note0.memo, { gasLimit: 900000n }));
await step('admin: unpause', otcAdmin.unpause());

await step('admin: block taker', otcAdmin.setBlocked([burner.address], true));
await expectRevert('fill while blocked', otcTaker.fillSellOrderPrivate(id, orbAmount, note0.commitment, note0.memo, { gasLimit: 900000n }));
await step('admin: unblock taker', otcAdmin.setBlocked([burner.address], false));

const note = buildShieldNote(ADDR, orbAmount);
const before = await provider.getBalance(burner.address);
const r = await step('taker: PRIVATE fill (ORB -> shielded note)', otcTaker.fillSellOrderPrivate(id, orbAmount, note.commitment, note.memo, { gasLimit: 1200000n }));
const after = await provider.getBalance(burner.address);
console.log('taker public ORB change (should be only gas):', ethers.formatEther(after - before));
console.log('commitment:', note.commitment);
console.log('order open after full fill:', (await otcAdmin.orders(id)).open);
writeFileSync('last-note.json', JSON.stringify({ tx: r.hash, block: r.blockNumber, commitment: note.commitment, amount: '0.05', via: 'OrbOTCV2.fillSellOrderPrivate' }, null, 2));
