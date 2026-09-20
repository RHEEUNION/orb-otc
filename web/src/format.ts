import { formatEther, formatUnits } from "viem";

export type Token = { address: `0x${string}`; symbol: string; decimals: number; enabled: boolean };

const ONE = 10n ** 18n;

/** Quote owed for `orb` wei of ORB at `price` (quote base units per 1 ORB), rounded up like the contract. */
export const cost = (orb: bigint, price: bigint) => (orb * price + ONE - 1n) / ONE;
export const feeOf = (amount: bigint, bps: number) => (amount * BigInt(bps)) / 10000n;
export const pct = (bps: number) => `${(bps / 100).toFixed(2)}%`;
export const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

export const fmtOrb = (v: bigint) => Number(formatEther(v)).toLocaleString(undefined, { maximumFractionDigits: 4 });

/** Amount of a quote token, e.g. price or total. Uses the token's own decimals. */
export function fmtQuote(v: bigint, t: Token | undefined, min = 2, max = 4) {
  const n = Number(formatUnits(v, t?.decimals ?? 6));
  return n.toLocaleString(undefined, { minimumFractionDigits: min, maximumFractionDigits: max });
}
