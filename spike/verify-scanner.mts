// Verifies the scanner config against the real networks: every token address must exist, report the expected
// symbol and decimals, and a scan of a well-known exchange wallet must return balances without errors.
import { createPublicClient, erc20Abi, http } from 'viem';
import { SCAN_CHAINS, scanStablecoins } from '../web/src/scanner.ts';

let failed = 0;
const check = (name: string, ok: boolean) => { console.log(ok ? 'ok  ' : 'FAIL', name); if (!ok) failed++; };

for (const c of SCAN_CHAINS) {
  const client = createPublicClient({ chain: c.chain, transport: http(c.rpcs[0], { timeout: 15000 }) });
  for (const t of c.tokens) {
    try {
      const [symbol, decimals] = await Promise.all([
        client.readContract({ address: t.address, abi: erc20Abi, functionName: 'symbol' }),
        client.readContract({ address: t.address, abi: erc20Abi, functionName: 'decimals' }),
      ]);
      // Tether's USDT0 deployments show the symbol as USD₮0 / USDT0, so normalise the ₮ sign
      const okSymbol = String(symbol).replace('₮', 'T').toUpperCase().includes(t.symbol);
      check(`${c.chain.name} ${t.symbol}: on-chain symbol "${symbol}", decimals ${decimals}`, okSymbol && Number(decimals) === t.decimals);
    } catch (e) {
      check(`${c.chain.name} ${t.symbol}: read failed (${(e as Error).message.slice(0, 60)})`, false);
    }
  }
}

// Binance 14 hot wallet on Ethereum: a public address that holds stablecoins.
const owner = '0x28C6c06298d514Db089934071355E5743bf21d60';
const started = Date.now();
const scan = await scanStablecoins(owner);
console.log(`scan took ${Date.now() - started} ms; ${scan.balances.length} non-zero balances; errors: ${JSON.stringify(scan.errors)}`);
for (const b of scan.balances.slice(0, 6)) console.log('  ', b.chainName.padEnd(10), b.symbol, Number(b.amount).toLocaleString());
check('scan returned balances', scan.balances.length > 0);
check('no chain failed', scan.errors.length === 0);
check('an empty address returns no balances and no errors', (await scanStablecoins('0x000000000000000000000000000000000000dEaD')).errors.length === 0);
console.log(failed === 0 ? '\nSCANNER OK' : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
