// Read-only scan of a wallet's USDT and USDC balances on other EVM networks.
// Ready for mainnet: it is switched on with the `multichainScan` feature flag (see features.ts) and does nothing
// on testnet. It only calls public RPC endpoints and never asks the wallet to sign anything.
import { createPublicClient, erc20Abi, fallback, formatUnits, http, type Address, type Chain } from "viem";
import { arbitrum, base, bsc, mainnet, polygon } from "viem/chains";

export type StableSymbol = "USDT" | "USDC";

export type ScanChain = {
  chain: Chain;
  rpcs: string[]; // tried in order
  tokens: { symbol: StableSymbol; address: Address; decimals: number }[];
};

/** Exact contract addresses only. Bridged or look-alike versions must never be added by symbol. */
export const SCAN_CHAINS: ScanChain[] = [
  {
    chain: mainnet,
    rpcs: ["https://ethereum-rpc.publicnode.com", "https://cloudflare-eth.com"],
    tokens: [
      { symbol: "USDT", address: "0xdAC17F958D2ee523a2206206994597C13D831ec7", decimals: 6 },
      { symbol: "USDC", address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", decimals: 6 },
    ],
  },
  {
    chain: bsc,
    rpcs: ["https://bsc-rpc.publicnode.com", "https://bsc-dataseed.binance.org"],
    tokens: [
      // Binance-Peg tokens on BNB Chain use 18 decimals, unlike Ethereum
      { symbol: "USDT", address: "0x55d398326f99059fF775485246999027B3197955", decimals: 18 },
      { symbol: "USDC", address: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d", decimals: 18 },
    ],
  },
  {
    chain: arbitrum,
    rpcs: ["https://arbitrum-one-rpc.publicnode.com", "https://arb1.arbitrum.io/rpc"],
    tokens: [
      { symbol: "USDT", address: "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9", decimals: 6 },
      { symbol: "USDC", address: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", decimals: 6 },
    ],
  },
  {
    chain: base,
    rpcs: ["https://base-rpc.publicnode.com", "https://mainnet.base.org"],
    tokens: [
      { symbol: "USDT", address: "0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2", decimals: 6 },
      { symbol: "USDC", address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", decimals: 6 },
    ],
  },
  {
    chain: polygon,
    rpcs: ["https://polygon-bor-rpc.publicnode.com", "https://polygon-rpc.com"],
    tokens: [
      { symbol: "USDT", address: "0xc2132D05D31c914a87C6611C10748AEb04B58e8F", decimals: 6 },
      { symbol: "USDC", address: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359", decimals: 6 },
    ],
  },
];

export type StableBalance = {
  chainId: number;
  chainName: string;
  symbol: StableSymbol;
  token: Address;
  decimals: number;
  raw: bigint;
  amount: string; // human readable
};

export type ScanResult = {
  balances: StableBalance[]; // non-zero only, largest first
  totals: Record<StableSymbol, bigint>; // normalised to 6 decimals for comparing across chains
  errors: { chainId: number; chainName: string; message: string }[];
};

const to6 = (raw: bigint, decimals: number) => (decimals >= 6 ? raw / 10n ** BigInt(decimals - 6) : raw * 10n ** BigInt(6 - decimals));

async function scanChain(owner: Address, c: ScanChain, timeoutMs: number): Promise<StableBalance[]> {
  const client = createPublicClient({
    chain: c.chain,
    transport: fallback(c.rpcs.map((url) => http(url, { timeout: timeoutMs, retryCount: 0 }))),
  });
  const results = await client.multicall({
    allowFailure: true,
    contracts: c.tokens.map((t) => ({ address: t.address, abi: erc20Abi, functionName: "balanceOf" as const, args: [owner] })),
  });
  const out: StableBalance[] = [];
  results.forEach((r, i) => {
    const t = c.tokens[i];
    if (r.status !== "success") throw new Error(`${t.symbol} balance read failed`);
    const raw = r.result as bigint;
    if (raw > 0n) out.push({ chainId: c.chain.id, chainName: c.chain.name, symbol: t.symbol, token: t.address, decimals: t.decimals, raw, amount: formatUnits(raw, t.decimals) });
  });
  return out;
}

/** Scans all configured networks in parallel. A failing network is reported in `errors` and does not stop the rest. */
export async function scanStablecoins(owner: Address, chains: ScanChain[] = SCAN_CHAINS, timeoutMs = 8000): Promise<ScanResult> {
  const settled = await Promise.allSettled(chains.map((c) => scanChain(owner, c, timeoutMs)));
  const balances: StableBalance[] = [];
  const errors: ScanResult["errors"] = [];
  settled.forEach((s, i) => {
    if (s.status === "fulfilled") balances.push(...s.value);
    else {
      const reason = s.reason as { shortMessage?: string; message?: string } | undefined;
      errors.push({ chainId: chains[i].chain.id, chainName: chains[i].chain.name, message: reason?.shortMessage ?? reason?.message ?? "scan failed" });
    }
  });
  balances.sort((a, b) => (to6(b.raw, b.decimals) > to6(a.raw, a.decimals) ? 1 : -1));
  const totals: ScanResult["totals"] = { USDT: 0n, USDC: 0n };
  for (const b of balances) totals[b.symbol] += to6(b.raw, b.decimals);
  return { balances, totals, errors };
}
