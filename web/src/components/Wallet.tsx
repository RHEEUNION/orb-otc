import { useEffect, useRef, useState } from "react";
import type { Detected } from "../wallets";

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

function WalletIcon({ src }: { src?: string }) {
  return src ? <img className="wallet-icon" src={src} alt="" width={28} height={28} /> : <span className="wallet-icon fallback" aria-hidden="true" />;
}

/** Lists every wallet found in this browser. The user picks one, then chooses the account inside that wallet. */
export function WalletModal({ wallets, onPick, onClose }: { wallets: Detected[]; onPick: (w: Detected) => void; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="modal" onClick={onClose}>
      <div className="card" role="dialog" aria-modal="true" aria-label="Connect a wallet" onClick={(e) => e.stopPropagation()}>
        <h2>Connect a wallet</h2>
        {wallets.length === 0 ? (
          <>
            <p className="hint">No wallet was detected in this browser.</p>
            <p>Install a browser wallet such as MetaMask, Rabby or Coinbase Wallet, or open this site inside your wallet app's built-in browser, then reload the page.</p>
          </>
        ) : (
          <ul className="wallets">
            {wallets.map((w) => (
              <li key={w.id + w.name}>
                <button className="wallet-row" onClick={() => onPick(w)}>
                  <WalletIcon src={w.icon} />
                  <span>{w.name}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <p className="hint">
          {wallets.length > 0 ? `${wallets.length} wallet${wallets.length === 1 ? "" : "s"} detected in this browser. ` : ""}
          You choose the account in your wallet. Wallets such as Rabby and Talisman switch accounts inside the wallet itself: change the active account there and this page follows automatically. Connecting does not sign or send anything.
        </p>
        <div className="actions">
          <button className="btn ghost" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

/** The connected wallet button: address, with copy, explorer link, switch and disconnect. */
export function WalletMenu({ address, accounts, walletName, walletIcon, balances, explorerUrl, onSelectAccount, onSwitch, onDisconnect }: { address: string; accounts: string[]; walletName: string; walletIcon?: string; balances: string; explorerUrl: string; onSelectAccount: (a: string) => void; onSwitch: () => void; onDisconnect: () => void }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => box.current && !box.current.contains(e.target as Node) && setOpen(false);
    const key = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", key);
    };
  }, [open]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  };

  return (
    <div className="walletmenu" ref={box}>
      <button className="btn solid walletbtn" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <WalletIcon src={walletIcon} />
        {short(address)}
        <span className="caret" aria-hidden="true">▾</span>
      </button>
      {open && (
        <div className="menu" role="menu">
          <div className="menu-head">
            <span>{walletName}</span>
            <code>{address}</code>
            {balances && <span>{balances}</span>}
          </div>
          {accounts.length > 1 && (
            <div className="menu-accounts" role="group" aria-label="Accounts shared by this wallet">
              <span className="menu-label">Accounts shared by {walletName}</span>
              {accounts.map((a) => (
                <button key={a} role="menuitemradio" aria-checked={same(a, address)} className={same(a, address) ? "on" : ""} onClick={() => { setOpen(false); if (!same(a, address)) onSelectAccount(a); }}>
                  <code>{short(a)}</code>
                  {same(a, address) && <em>active</em>}
                </button>
              ))}
            </div>
          )}
          <button role="menuitem" onClick={copy}>{copied ? "Copied" : "Copy address"}</button>
          <a role="menuitem" href={explorerUrl} target="_blank" rel="noreferrer" onClick={() => setOpen(false)}>View on explorer</a>
          <button role="menuitem" onClick={() => { setOpen(false); onSwitch(); }}>Switch wallet or account</button>
          <button role="menuitem" className="danger" onClick={() => { setOpen(false); onDisconnect(); }}>Disconnect</button>
        </div>
      )}
    </div>
  );
}
