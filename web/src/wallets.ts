import { useEffect, useState } from "react";

/** The part of an EIP-1193 provider this site uses. */
export type Eip1193 = {
  request(args: { method: string; params?: unknown }): Promise<any>;
  on?(event: string, handler: (...args: any[]) => void): void;
  removeListener?(event: string, handler: (...args: any[]) => void): void;
};

export type Detected = { id: string; name: string; icon?: string; provider: Eip1193 };

type Announce = { info: { uuid: string; name: string; icon: string; rdns: string }; provider: Eip1193 };

/**
 * Browser wallets found through EIP-6963. Every installed wallet announces itself, so MetaMask, Rabby, Coinbase Wallet,
 * OKX, Trust and others can coexist instead of fighting over `window.ethereum`.
 */
export function useWallets(): Detected[] {
  const [list, setList] = useState<Detected[]>([]);
  useEffect(() => {
    const seen = new Map<string, Detected>();
    const onAnnounce = (e: Event) => {
      const d = (e as CustomEvent<Announce>).detail;
      if (!d?.info || !d.provider) return;
      seen.set(d.info.uuid, { id: d.info.rdns || d.info.uuid, name: d.info.name, icon: d.info.icon, provider: d.provider });
      setList([...seen.values()]);
    };
    window.addEventListener("eip6963:announceProvider", onAnnounce);
    window.dispatchEvent(new Event("eip6963:requestProvider"));
    return () => window.removeEventListener("eip6963:announceProvider", onAnnounce);
  }, []);
  return list;
}

const legacyName = (p: any) =>
  p?.isRabby ? "Rabby" : p?.isCoinbaseWallet ? "Coinbase Wallet" : p?.isTrust || p?.isTrustWallet ? "Trust Wallet" : p?.isOkxWallet || p?.isOKExWallet ? "OKX Wallet" : p?.isBraveWallet ? "Brave Wallet" : p?.isMetaMask ? "MetaMask" : "Browser wallet";

/** Adds wallets that only expose `window.ethereum` (older wallets, in-app browsers) to the EIP-6963 list. */
export function withLegacy(found: Detected[]): Detected[] {
  const eth = (window as any).ethereum;
  if (!eth) return found;
  const all: any[] = Array.isArray(eth.providers) && eth.providers.length ? eth.providers : [eth];
  const extra = all
    .filter((p) => p && !found.some((d) => d.provider === p))
    .map((p, i) => ({ id: `legacy-${i}`, name: legacyName(p), provider: p as Eip1193 }));
  // A legacy provider is usually the same wallet that already announced itself: skip it if the names match.
  return [...found, ...extra.filter((x) => !found.some((d) => d.name === x.name))];
}
