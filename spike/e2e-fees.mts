// On-chain check of the fee flow on the real testnet: private fill -> fees accrue -> claimFees -> recipient is paid.
import { readFileSync } from 'node:fs';
import { createPublicClient, createWalletClient, http, parseEther, parseUnits, formatUnits, defineChain, parseAbi } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { buildPrivateNote } from '../web/src/privacy.ts';

const ADDR = process.argv[2];
const dep = JSON.parse(readFileSync('../web/src/deployment.json', 'utf8'));
const env = Object.fromEntries(readFileSync('../.env', 'utf8').split('\n').filter(Boolean).map((l) => l.split('=')));
const burnerKey = JSON.parse(readFileSync('burner.json', 'utf8')).key;
const chain = defineChain({ id: 2700, name: 'Orbinum Testnet', nativeCurrency: { name: 'ORB', symbol: 'ORB', decimals: 18 }, rpcUrls: { default: { http: ['https://rpc-1.testnet.orbinum.io'] } } });
const otcAbi = parseAbi([
  'function createSellOrder(uint256 price) payable returns (uint256)',
  'function fillSellOrderPrivate(uint256 id, uint256 orbAmount, bytes32 commitment, bytes memo)',
  'function nextOrderId() view returns (uint256)',
  'function accruedFees() view returns (uint256)',
  'function feeRecipient() view returns (address)',
  'function makerFeeBps() view returns (uint16)',
  'function takerFeeBps() view returns (uint16)',
  'function claimFees()',
]);
const usdAbi = parseAbi(['function balanceOf(address) view returns (uint256)', 'function approve(address,uint256) returns (bool)', 'function faucet()']);

const pub = createPublicClient({ chain, transport: http() });
const maker = createWalletClient({ chain, transport: http(), account: privateKeyToAccount(env.DEPLOYER_KEY as `0x${string}`) });
const taker = createWalletClient({ chain, transport: http(), account: privateKeyToAccount(burnerKey) });
const otc = dep.otcV2 as `0x${string}`;
const usd = dep.quote as `0x${string}`;
const wait = (h: `0x${string}`) => pub.waitForTransactionReceipt({ hash: h });
const bal = (a: `0x${string}`) => pub.readContract({ address: usd, abi: usdAbi, functionName: 'balanceOf', args: [a] }) as Promise<bigint>;
const fmt = (n: bigint) => formatUnits(n, 6);
let failed = 0;
const check = (name: string, ok: boolean) => { console.log(ok ? 'ok  ' : 'FAIL', name); if (!ok) failed++; };

const mBps = BigInt(await pub.readContract({ address: otc, abi: otcAbi, functionName: 'makerFeeBps' }));
const tBps = BigInt(await pub.readContract({ address: otc, abi: otcAbi, functionName: 'takerFeeBps' }));
const recipient = (await pub.readContract({ address: otc, abi: otcAbi, functionName: 'feeRecipient' })) as `0x${string}`;
console.log('fees: maker', mBps, 'bps, taker', tBps, 'bps, recipient', recipient);

const orb = parseEther('0.1');
const price = parseUnits('2', 6);
const q = (orb * price + 10n ** 18n - 1n) / 10n ** 18n; // 0.2 tUSD
const mFee = (q * mBps) / 10000n;
const tFee = (q * tBps) / 10000n;

await wait(await taker.writeContract({ address: usd, abi: usdAbi, functionName: 'faucet' }).catch(() => '0x' as `0x${string}`)).catch(() => null);
await wait(await taker.writeContract({ address: usd, abi: usdAbi, functionName: 'approve', args: [otc, 2n ** 256n - 1n] }));
const id = (await pub.readContract({ address: otc, abi: otcAbi, functionName: 'nextOrderId' })) as bigint;
await wait(await maker.writeContract({ address: otc, abi: otcAbi, functionName: 'createSellOrder', args: [price], value: orb }));

const makerBefore = await bal(maker.account.address);
const takerBefore = await bal(taker.account.address);
const feesBefore = (await pub.readContract({ address: otc, abi: otcAbi, functionName: 'accruedFees' })) as bigint;
const recipientBefore = await bal(recipient);

const note = buildPrivateNote(ADDR, orb);
const r = await wait(await taker.writeContract({
  address: otc, abi: otcAbi, functionName: 'fillSellOrderPrivate',
  args: [id, orb, note.commitment as `0x${string}`, note.memo as `0x${string}`], gas: 1_500_000n,
}));
check('private fill succeeded', r.status === 'success');
check(`taker paid price + taker fee (${fmt(q + tFee)})`, takerBefore - (await bal(taker.account.address)) === q + tFee);
check(`maker received price - maker fee (${fmt(q - mFee)})`, (await bal(maker.account.address)) - makerBefore === q - mFee);
const feesAfter = (await pub.readContract({ address: otc, abi: otcAbi, functionName: 'accruedFees' })) as bigint;
check(`fees accrued ${fmt(mFee + tFee)}`, feesAfter - feesBefore === mFee + tFee);

await wait(await maker.writeContract({ address: otc, abi: otcAbi, functionName: 'claimFees' }));
const paid = (await bal(recipient)) - recipientBefore;
check(`recipient ${recipient} received ${fmt(feesAfter)} tUSD`, paid === feesAfter);
check('accrued fees reset to 0', ((await pub.readContract({ address: otc, abi: otcAbi, functionName: 'accruedFees' })) as bigint) === 0n);
console.log(failed === 0 ? '\nFEE FLOW OK' : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
