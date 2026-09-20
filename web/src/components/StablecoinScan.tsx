import { useEffect, useState } from "react";
import type { Address } from "viem";
import type { ScanResult } from "../scanner";

const nf = (s: string) => Number(s).toLocaleString(undefined, { maximumFractionDigits: 2 });

/**
 * Where the connected wallet holds USDT and USDC on other networks. Read only; the scanner is loaded on demand.
 * Bridging into Orbinum is not wired yet, so the action stays disabled until mainnet routes exist.
 */
export function StablecoinScan({ owner }: { owner: Address }) {
  const [state, setState] = useState<{ loading: boolean; res?: ScanResult; err?: string }>({ loading: true });

  useEffect(() => {
    let alive = true;
    setState({ loading: true });
    import("../scanner")
      .then((m) => m.scanStablecoins(owner))
      .then((res) => alive && setState({ loading: false, res }))
      .catch((e: Error) => alive && setState({ loading: false, err: e.message }));
    return () => {
      alive = false;
    };
  }, [owner]);

  return (
    <div className="scan">
      <div className="scan-head">
        <span>Your stablecoins on other networks</span>
        {state.loading && <span className="dots" aria-label="scanning">scanning</span>}
      </div>
      {state.err && <div className="err-text">Scan failed: {state.err}</div>}
      {state.res && state.res.balances.length === 0 && !state.res.errors.length && <div className="hint">No USDT or USDC found on Ethereum, BNB Chain, Arbitrum, Base or Polygon.</div>}
      {state.res?.balances.map((b) => (
        <div className="scan-row" key={`${b.chainId}-${b.symbol}`}>
          <span>{b.chainName}</span>
          <b>{nf(b.amount)} {b.symbol}</b>
        </div>
      ))}
      {state.res?.errors.map((e) => (
        <div className="scan-row muted" key={e.chainId}>
          <span>{e.chainName}</span>
          <span>unavailable</span>
        </div>
      ))}
      <button className="btn ghost small" disabled title="Bridge routes into Orbinum will be enabled with mainnet">Bridge to Orbinum · coming with mainnet</button>
    </div>
  );
}
