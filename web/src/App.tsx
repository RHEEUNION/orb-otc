import { useCallback, useEffect, useMemo, useState } from "react";
import {
  createPublicClient,
  createWalletClient,
  custom,
  formatEther,
  formatUnits,
  http,
  parseEther,
  parseUnits,
  type Address,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { DEPLOYED, erc20Abi, IS_V2, orbinumTestnet, otcAbi, OTC, PRIVATE_FILL_GAS, TEST_TOKEN } from "./chain";
import { FEATURES } from "./features";
import { cost, feeOf, fmtOrb, fmtQuote, pct, short, type Token } from "./format";
import { Halftone } from "./components/Hero";
import { MetalLogo } from "./components/MetalLogo";
import { StablecoinScan } from "./components/StablecoinScan";

type Order = {
  id: bigint;
  maker: Address;
  isSell: boolean;
  open: boolean;
  makerFeeBps: number;
  quote: Address;
  price: bigint;
  remainingOrb: bigint;
  remainingQuote: bigint;
  remainingFee: bigint;
};
type Tab = "market" | "mine" | "create" | "onetime" | "faq";
type Toast = { msg: string; err?: boolean } | null;
type Receipt = {
  app: string;
  network: string;
  chainId: number;
  contract: string;
  orderId: string;
  txHash: string;
  address: string;
  orbAmount: string;
  quoteToken: string;
  quoteSymbol: string;
  quoteAmount: string;
  takerFee: string;
  price: string;
  commitment: string;
  disclosureKey: string;
  createdAt: string;
  signMessage?: string;
  signature?: string;
};

const pub = createPublicClient({ chain: orbinumTestnet, transport: http() });
const eth = () => (window as any).ethereum;
const explorerTx = (h: string) => `${orbinumTestnet.blockExplorers.default.url}/tx/${h}`;
const sameAddr = (a?: string, b?: string) => !!a && !!b && a.toLowerCase() === b.toLowerCase();
const TAB_LABEL: Record<Tab, string> = { market: "Order book", mine: "My orders", create: "New order", onetime: "One-time address", faq: "FAQ" };

export default function App() {
  const [tab, setTab] = useState<Tab>("market");
  const [account, setAccount] = useState<Address | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [tokens, setTokens] = useState<Token[]>([]);
  const [sel, setSel] = useState<Address | null>(null);
  const [orbBal, setOrbBal] = useState<bigint>(0n);
  const [tokBal, setTokBal] = useState<bigint>(0n);
  const [toast, setToast] = useState<Toast>(null);
  const [busy, setBusy] = useState(false);
  const [fill, setFill] = useState<Order | null>(null);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [paused, setPaused] = useState(false);
  const [isBlocked, setIsBlocked] = useState(false);
  const [fees, setFees] = useState({ maker: 0, taker: 0 });

  const enabledTokens = useMemo(() => tokens.filter((t) => t.enabled), [tokens]);
  const tokenOf = useCallback((a?: string) => tokens.find((t) => sameAddr(t.address, a)), [tokens]);
  const selected = tokenOf(sel ?? undefined) ?? enabledTokens[0];

  const notify = (msg: string, err = false) => {
    setToast({ msg, err });
    setTimeout(() => setToast(null), 6000);
  };

  const loadOrders = useCallback(async () => {
    if (!DEPLOYED || !IS_V2) return;
    const n = (await pub.readContract({ address: OTC, abi: otcAbi, functionName: "nextOrderId" })) as bigint;
    const all: Order[] = [];
    for (let from = 0n; from < n; from += 200n) {
      const [ids, list] = (await pub.readContract({ address: OTC, abi: otcAbi, functionName: "getOrders", args: [from, 200n] })) as any;
      list.forEach((o: any, i: number) => all.push({ id: ids[i], ...o }));
    }
    setOrders(all.filter((o) => o.open));
    setPaused((await pub.readContract({ address: OTC, abi: otcAbi, functionName: "paused" })) as boolean);
    const [maker, taker, recipient] = await Promise.all([
      pub.readContract({ address: OTC, abi: otcAbi, functionName: "makerFeeBps" }),
      pub.readContract({ address: OTC, abi: otcAbi, functionName: "takerFeeBps" }),
      pub.readContract({ address: OTC, abi: otcAbi, functionName: "feeRecipient" }),
    ]);
    const on = (recipient as string) !== "0x0000000000000000000000000000000000000000";
    setFees({ maker: on ? Number(maker) : 0, taker: on ? Number(taker) : 0 });
  }, []);

  const loadTokens = useCallback(async () => {
    if (!DEPLOYED || !IS_V2) return;
    const [addrs, enabled] = (await pub.readContract({ address: OTC, abi: otcAbi, functionName: "getQuoteTokens" })) as [Address[], boolean[]];
    const list = await Promise.all(
      addrs.map(async (address, i) => ({
        address,
        enabled: enabled[i],
        symbol: (await pub.readContract({ address, abi: erc20Abi, functionName: "symbol" })) as string,
        decimals: Number(await pub.readContract({ address, abi: erc20Abi, functionName: "decimals" })),
      })),
    );
    setTokens(list);
    setSel((cur) => cur ?? list.find((t) => t.enabled)?.address ?? null);
  }, []);

  const loadBalances = useCallback(async () => {
    if (!account) return;
    setOrbBal(await pub.getBalance({ address: account }));
    if (selected) setTokBal((await pub.readContract({ address: selected.address, abi: erc20Abi, functionName: "balanceOf", args: [account] })) as bigint);
    if (IS_V2) setIsBlocked((await pub.readContract({ address: OTC, abi: otcAbi, functionName: "blocked", args: [account] })) as boolean);
  }, [account, selected]);

  useEffect(() => {
    loadTokens().catch(() => {});
    loadOrders().catch(() => {});
    const t = setInterval(() => loadOrders().catch(() => {}), 8000);
    return () => clearInterval(t);
  }, [loadOrders, loadTokens]);
  useEffect(() => { loadBalances().catch(() => {}); }, [loadBalances, orders]);

  const wallet = () => createWalletClient({ chain: orbinumTestnet, transport: custom(eth()), account: account! });

  async function ensureChain() {
    const hex = "0x" + orbinumTestnet.id.toString(16);
    try {
      await eth().request({ method: "wallet_switchEthereumChain", params: [{ chainId: hex }] });
    } catch {
      await eth().request({
        method: "wallet_addEthereumChain",
        params: [{
          chainId: hex,
          chainName: orbinumTestnet.name,
          nativeCurrency: orbinumTestnet.nativeCurrency,
          rpcUrls: orbinumTestnet.rpcUrls.default.http,
          blockExplorerUrls: [orbinumTestnet.blockExplorers.default.url],
        }],
      });
    }
  }

  async function connect() {
    if (!eth()) return notify("EVM wallet (MetaMask etc.) not found", true);
    try {
      const [a] = await eth().request({ method: "eth_requestAccounts" });
      await ensureChain();
      setAccount(a);
    } catch (e: any) {
      notify(e.shortMessage ?? e.message, true);
    }
  }

  /** Runs a transaction flow, waits for every hash, refreshes, and returns the hashes (or null on failure). */
  async function run(label: string, fn: () => Promise<`0x${string}`[]>): Promise<`0x${string}`[] | null> {
    if (!account) {
      notify("Connect wallet first", true);
      return null;
    }
    setBusy(true);
    try {
      await ensureChain();
      const hashes = await fn();
      for (const hash of hashes) await pub.waitForTransactionReceipt({ hash });
      notify(`${label} ✓`);
      await loadOrders();
      await loadBalances();
      return hashes;
    } catch (e: any) {
      notify(e.shortMessage ?? e.message, true);
      return null;
    } finally {
      setBusy(false);
    }
  }

  /** Approves the OTC contract to pull `amount` of `token`. Resets a non-zero allowance first, as some tokens require. */
  async function approveIfNeeded(token: Address, amount: bigint) {
    const allowance = (await pub.readContract({ address: token, abi: erc20Abi, functionName: "allowance", args: [account!, OTC] })) as bigint;
    if (allowance >= amount) return;
    if (allowance > 0n) {
      const reset = await wallet().writeContract({ address: token, abi: erc20Abi, functionName: "approve", args: [OTC, 0n] });
      await pub.waitForTransactionReceipt({ hash: reset });
    }
    const h = await wallet().writeContract({ address: token, abi: erc20Abi, functionName: "approve", args: [OTC, amount] });
    await pub.waitForTransactionReceipt({ hash: h });
  }

  const faucet = () =>
    run("Test tokens received", async () => [await wallet().writeContract({ address: TEST_TOKEN, abi: erc20Abi, functionName: "faucet" })]);

  const cancel = (o: Order) =>
    run("Order cancelled", async () => [await wallet().writeContract({ address: OTC, abi: otcAbi, functionName: "cancelOrder", args: [o.id] })]);

  async function confirmFill(o: Order, orbAmount: bigint, privacyAddress?: string) {
    setFill(null);
    const token = tokenOf(o.quote);
    if (!token) return notify("Unknown quote token for this order", true);
    if (o.isSell && privacyAddress) {
      // Build the shielded note in the browser from the PUBLIC privacy address. No key is handled.
      let note;
      try {
        const { buildPrivateNote } = await import("./privacy");
        note = buildPrivateNote(privacyAddress, orbAmount);
      } catch (e: any) {
        return notify(e.message, true);
      }
      const quoteAmount = cost(orbAmount, o.price);
      const takerFee = feeOf(quoteAmount, fees.taker);
      const hashes = await run("Filled — ORB sent to your private note", async () => {
        await approveIfNeeded(o.quote, quoteAmount + takerFee);
        return [
          await wallet().writeContract({
            address: OTC,
            abi: otcAbi,
            functionName: "fillSellOrderPrivate",
            args: [o.id, orbAmount, note.commitment as `0x${string}`, note.memo as `0x${string}`],
            gas: PRIVATE_FILL_GAS,
          }),
        ];
      });
      if (hashes) {
        setReceipt({
          app: "ORB.OTC",
          network: orbinumTestnet.name,
          chainId: orbinumTestnet.id,
          contract: OTC,
          orderId: o.id.toString(),
          txHash: hashes[hashes.length - 1],
          address: account!,
          orbAmount: formatEther(orbAmount),
          quoteToken: token.address,
          quoteSymbol: token.symbol,
          quoteAmount: formatUnits(quoteAmount, token.decimals),
          takerFee: formatUnits(takerFee, token.decimals),
          price: formatUnits(o.price, token.decimals),
          commitment: note.commitment,
          disclosureKey: note.disclosureKey,
          createdAt: new Date().toISOString(),
        });
      }
      return;
    }
    await run("Order filled", async () => {
      if (o.isSell) {
        const q = cost(orbAmount, o.price);
        await approveIfNeeded(o.quote, q + feeOf(q, fees.taker));
        return [await wallet().writeContract({ address: OTC, abi: otcAbi, functionName: "fillSellOrder", args: [o.id, orbAmount] })];
      }
      return [await wallet().writeContract({ address: OTC, abi: otcAbi, functionName: "fillBuyOrder", args: [o.id], value: orbAmount })];
    });
  }

  const create = (token: Token, isSell: boolean, price: bigint, orb: bigint) =>
    run("Order created", async () => {
      if (isSell)
        return [await wallet().writeContract({ address: OTC, abi: otcAbi, functionName: "createSellOrder", args: [token.address, price], value: orb })];
      const q = cost(orb, price);
      await approveIfNeeded(token.address, q + feeOf(q, fees.maker));
      return [await wallet().writeContract({ address: OTC, abi: otcAbi, functionName: "createBuyOrder", args: [token.address, price, orb] })];
    });

  async function signReceipt() {
    if (!receipt || !account) return;
    const message = `ORB.OTC receipt\ntx: ${receipt.txHash}\ncommitment: ${receipt.commitment}\naddress: ${account}`;
    try {
      const signature = await wallet().signMessage({ message });
      setReceipt({ ...receipt, signMessage: message, signature });
    } catch (e: any) {
      notify(e.shortMessage ?? e.message, true);
    }
  }

  const inToken = useCallback((o: Order) => sameAddr(o.quote, selected?.address), [selected]);
  const sells = useMemo(() => orders.filter((o) => o.isSell && inToken(o)).sort((a, b) => (a.price < b.price ? -1 : a.price > b.price ? 1 : 0)), [orders, inToken]);
  const buys = useMemo(() => orders.filter((o) => !o.isSell && inToken(o)).sort((a, b) => (a.price > b.price ? -1 : a.price < b.price ? 1 : 0)), [orders, inToken]);
  const mine = useMemo(() => orders.filter((o) => sameAddr(o.maker, account ?? undefined)), [orders, account]);
  const tradingOff = paused || isBlocked;
  const tabs: Tab[] = ["market", "mine", "create", "onetime", "faq"];

  return (
    <>
      <div className="banner">Testnet only — Orbinum Testnet (chain 2700). Tokens have no real value.</div>
      {paused && <div className="banner alert">Trading is paused by the operator. You can still cancel your own orders and get your funds back.</div>}
      {!paused && isBlocked && <div className="banner alert">This address is blocked from new trades. You can still cancel your own orders and get your funds back.</div>}

      <header className="top">
        <a className="brand" href="./" aria-label="ORB.OTC home"><HexGlyph />ORB<span>.OTC</span></a>
        <nav aria-label="Sections">
          {tabs.map((t) => (
            <button key={t} className={tab === t ? "on" : ""} onClick={() => setTab(t)}>{TAB_LABEL[t]}</button>
          ))}
        </nav>
        <div className="spacer" />
        {account && (
          <div className="bal">
            <span>{fmtOrb(orbBal)} ORB</span>
            {selected && <span>{fmtQuote(tokBal, selected, 0, 2)} {selected.symbol}</span>}
          </div>
        )}
        {account && selected && sameAddr(selected.address, TEST_TOKEN) && (
          <button className="btn ghost small" disabled={busy || !DEPLOYED} onClick={faucet}>Get {selected.symbol}</button>
        )}
        {account && <a className="btn ghost small" href="https://faucet.orbinum.network/" target="_blank" rel="noreferrer">Get ORB</a>}
        <button className="btn solid" onClick={connect}>{account ? short(account) : "Connect wallet"}</button>
      </header>

      {tab === "market" && (
        <section className="hero">
          <Halftone />
          <div className="hero-copy">
            <p className="eyebrow reveal" style={{ ["--i" as any]: 0 }}>Over-the-counter · Orbinum</p>
            <h1 className="reveal" style={{ ["--i" as any]: 1 }}>Trade ORB<br /><span>peer to peer.</span></h1>
            <p className="lede reveal" style={{ ["--i" as any]: 2 }}>Post or take an order, settle on-chain in one transaction, and receive your ORB into a shielded note if you choose.</p>
            <div className="hero-cta reveal" style={{ ["--i" as any]: 3 }}>
              <button className="btn solid" onClick={() => (account ? setTab("create") : connect())}>{account ? "New order" : "Connect wallet"}</button>
              <button className="btn ghost" onClick={() => setTab("faq")}>How it works</button>
            </div>
          </div>
          <MetalLogo src={`${import.meta.env.BASE_URL}brand/orbinum-mark-white.svg`} />
        </section>
      )}

      <main>
        {(!DEPLOYED || !IS_V2) && <p className="empty">Contracts are not deployed yet. Run <code>npm run deploy:testnet</code> and rebuild the site.</p>}

        {tab === "market" && (
          <>
            <div className="stats reveal" style={{ ["--i" as any]: 4 }}>
              <Stat label="Best ask" value={sells[0] && selected ? `${fmtQuote(sells[0].price, selected)} ${selected.symbol}` : "—"} />
              <Stat label="Best bid" value={buys[0] && selected ? `${fmtQuote(buys[0].price, selected)} ${selected.symbol}` : "—"} />
              <Stat label="Open orders" value={String(sells.length + buys.length)} />
              <Stat label="Fees · taker / maker" value={`${pct(fees.taker)} / ${pct(fees.maker)}`} />
            </div>
            {enabledTokens.length > 1 && (
              <div className="pills" role="tablist" aria-label="Quote token">
                {enabledTokens.map((t) => (
                  <button key={t.address} role="tab" aria-selected={sameAddr(t.address, selected?.address)} className={sameAddr(t.address, selected?.address) ? "on" : ""} onClick={() => setSel(t.address)}>{t.symbol}</button>
                ))}
              </div>
            )}
            <div className="grid">
              <Book title="Sell orders" caption="Buy ORB from a seller" orders={sells} token={selected} action="Buy ORB" tone="buy" disabled={tradingOff} onAct={setFill} />
              <Book title="Buy orders" caption="Sell ORB to a buyer" orders={buys} token={selected} action="Sell ORB" tone="sell" disabled={tradingOff} onAct={setFill} />
            </div>
            <p className="hint">Fees are charged in {selected?.symbol ?? "the quote token"}: taker {pct(fees.taker)} on fills, maker {pct(fees.maker)} (fixed when the order is placed). Prices above exclude fees.</p>
          </>
        )}

        {tab === "mine" && (
          <section className="reveal">
            <h2>My open orders</h2>
            <div className="tablewrap">
              <table>
                <thead><tr><th>Side</th><th>Price</th><th>ORB left</th><th>Total</th><th /></tr></thead>
                <tbody>
                  {mine.length === 0 && <tr><td colSpan={5} className="empty">{account ? "No open orders" : "Connect your wallet"}</td></tr>}
                  {mine.map((o) => {
                    const t = tokenOf(o.quote);
                    return (
                      <tr key={String(o.id)}>
                        <td className={o.isSell ? "sell" : "buy"}>{o.isSell ? "Selling" : "Buying"}</td>
                        <td>{fmtQuote(o.price, t)} {t?.symbol}</td>
                        <td>{fmtOrb(o.remainingOrb)}</td>
                        <td>{fmtQuote(cost(o.remainingOrb, o.price), t)} {t?.symbol}</td>
                        <td><button className="btn small ghost" disabled={busy} onClick={() => cancel(o)}>Cancel</button></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {tab === "create" && <CreateForm busy={busy || tradingOff} tokens={enabledTokens} initial={selected} makerBps={fees.maker} onSubmit={create} />}
        {tab === "onetime" && <OneTimeAddress />}

        {tab === "faq" && (
          <div className="faq reveal">
            <h2>FAQ</h2>
            <h3>What is this?</h3>
            <p>A peer-to-peer OTC order book for ORB on the Orbinum testnet. Makers lock funds in an escrow contract; takers fill orders in one transaction. No custody by us, no backend.</p>
            <h3>Which tokens can I trade against ORB?</h3>
            <p>Orders are priced in a whitelisted stablecoin. On testnet that is a worthless test token, {selected?.symbol ?? "tUSD"}, with a public faucet. Mainnet will use USDT and USDC only.</p>
            <h3>Can I fill part of an order?</h3>
            <p>Yes. Enter any amount up to the remaining size.</p>
            <h3>Fees?</h3>
            <p>Fees are charged in the order's quote token. The taker pays the price plus a taker fee; the maker receives the price minus a maker fee (or, for a buy order, escrows the price plus the maker fee, and any unused part is refunded when you cancel). The maker fee is fixed when the order is placed and never rises afterwards. Current rates: taker {pct(fees.taker)}, maker {pct(fees.maker)}, capped at 1.00% each by the contract. Gas is paid in ORB.</p>
            <h3>Private receive</h3>
            <p>When you buy ORB from a sell order you can choose “Receive privately”. The ORB is paid into a shielded note for your Orbinum privacy address instead of your public address. Paste the privacy address from Orbinum Hub. Afterwards, open Hub → Shielded Pool → Recover Notes to see it. Price, size and the trading address stay public; what is hidden is who owns the ORB afterwards.</p>
            <h3>Trading without your main address</h3>
            <p>Every trade is made from an EVM address. Use the “One-time address” page to create a fresh one, fund it by unshielding from Hub, and import it into your wallet. Nothing links it to your main address unless you choose to prove it.</p>
            <h3>Proving a trade</h3>
            <p>After a private receive you can download a receipt with a disclosure key and sign it with the trading address. Share it only with whoever you need to show it to. A disclosure key proves a note's value and asset and cannot be used to spend it.</p>
            <h3>Operator controls</h3>
            <p>The operator can pause new trading and block specific addresses from creating or filling orders. Cancelling your own order always works, and the operator can never move or hold your funds.</p>
            <p>Contract: <a href={`${orbinumTestnet.blockExplorers.default.url}/address/${OTC}`} target="_blank" rel="noreferrer">{short(OTC)}</a></p>
          </div>
        )}
      </main>

      <footer className="foot">
        <div className="foot-in">
          <span className="built">
            Built on
            <a href="https://orbinum.network/" target="_blank" rel="noreferrer" aria-label="Orbinum">
              <img src={`${import.meta.env.BASE_URL}brand/orbinum-horizontal-white.svg`} alt="Orbinum" height="18" />
            </a>
          </span>
          <span className="disc">ORB.OTC is an independent project and is not an official Orbinum product. Testnet only.</span>
        </div>
      </footer>

      {fill && <FillModal order={fill} token={tokenOf(fill.quote)} account={account} busy={busy} takerBps={fees.taker} onClose={() => setFill(null)} onConfirm={confirmFill} />}
      {receipt && <ReceiptModal receipt={receipt} onSign={signReceipt} onClose={() => setReceipt(null)} />}
      {toast && <div className={"toast" + (toast.err ? " err" : "")} role="status">{toast.msg}</div>}
    </>
  );
}

function HexGlyph() {
  return (
    <svg className="glyph" viewBox="0 0 24 24" aria-hidden="true">
      <polygon points="12,2 20.66,7 20.66,17 12,22 3.34,17 3.34,7" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="12" cy="12" r="2.6" fill="currentColor" />
    </svg>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <span>{label}</span>
      <b>{value}</b>
    </div>
  );
}

function Book({ title, caption, orders, token, action, tone, disabled, onAct }: { title: string; caption: string; orders: Order[]; token?: Token; action: string; tone: "buy" | "sell"; disabled: boolean; onAct: (o: Order) => void }) {
  return (
    <section className="book reveal" style={{ ["--i" as any]: 5 }}>
      <header><h2>{title}</h2><span>{caption}</span></header>
      <div className="tablewrap">
        <table>
          <thead><tr><th>Price ({token?.symbol ?? "—"}/ORB)</th><th>Volume (ORB)</th><th>Total ({token?.symbol ?? "—"})</th><th /></tr></thead>
          <tbody>
            {orders.length === 0 && <tr><td colSpan={4} className="empty">No orders</td></tr>}
            {orders.map((o) => (
              <tr key={String(o.id)}>
                <td>{fmtQuote(o.price, token)}</td>
                <td>{fmtOrb(o.remainingOrb)}</td>
                <td>{fmtQuote(cost(o.remainingOrb, o.price), token)}</td>
                <td><button className={"btn small act " + tone} disabled={disabled} onClick={() => onAct(o)}>{action}</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function FillModal({ order, token, account, busy, takerBps, onClose, onConfirm }: { order: Order; token?: Token; account: Address | null; busy: boolean; takerBps: number; onClose: () => void; onConfirm: (o: Order, amt: bigint, privacyAddress?: string) => void }) {
  const [amt, setAmt] = useState(formatEther(order.remainingOrb));
  const [priv, setPriv] = useState(false);
  const [addr, setAddr] = useState("");
  const [addrError, setAddrError] = useState("");
  let orb = 0n;
  try { orb = parseEther(amt || "0"); } catch { /* invalid input */ }
  const valid = orb > 0n && orb <= order.remainingOrb && cost(orb, order.price) > 0n;
  const q = valid ? cost(orb, order.price) : 0n;
  const fee = feeOf(q, takerBps);

  async function checkAddress(value: string) {
    setAddr(value);
    if (!value.trim()) return setAddrError("");
    try {
      const { parsePrivacyAddress } = await import("./privacy");
      parsePrivacyAddress(value);
      setAddrError("");
    } catch (e: any) {
      setAddrError(e.message);
    }
  }
  const privOk = !priv || (addr.trim() !== "" && addrError === "");

  return (
    <div className="modal" onClick={onClose}>
      <div className="card" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <h2>{order.isSell ? "Buy ORB" : "Sell ORB"}</h2>
        <label>Amount (ORB), max {fmtOrb(order.remainingOrb)}</label>
        <input value={amt} onChange={(e) => setAmt(e.target.value)} inputMode="decimal" />
        <div className="summary">
          @ {fmtQuote(order.price, token)} {token?.symbol}/ORB · price <b>{valid ? fmtQuote(q, token) : "—"} {token?.symbol}</b>
          {takerBps > 0 && valid && (
            <>
              <br />Taker fee ({pct(takerBps)}): {order.isSell ? "+" : "−"}{fmtQuote(fee, token)} {token?.symbol}
              <br />You {order.isSell ? "pay" : "receive"}: <b>{fmtQuote(order.isSell ? q + fee : q - fee, token)} {token?.symbol}</b>
            </>
          )}
        </div>
        {order.isSell && (
          <>
            <label className="check"><input type="checkbox" checked={priv} onChange={(e) => setPriv(e.target.checked)} /> Receive privately (shielded note)</label>
            {priv && (
              <>
                <label>Your Orbinum privacy address (from Hub)</label>
                <textarea value={addr} onChange={(e) => checkAddress(e.target.value)} placeholder="orbpriv3:0x…:0x…:xxxxxxxx" rows={3} />
                {addrError && <div className="err-text">{addrError}</div>}
                <div className="hint">Only public keys are used. After the trade, open Hub → Shielded Pool → Recover Notes to see your ORB.</div>
              </>
            )}
            {FEATURES.multichainScan && account && <StablecoinScan owner={account} />}
          </>
        )}
        {!order.isSell && <div className="hint">The buyer receives the ORB publicly at their trading address.</div>}
        <div className="actions">
          <button className="btn solid" disabled={!valid || busy || !privOk} onClick={() => onConfirm(order, orb, priv ? addr.trim() : undefined)}>Confirm</button>
          <button className="btn ghost" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

function ReceiptModal({ receipt, onSign, onClose }: { receipt: Receipt; onSign: () => void; onClose: () => void }) {
  const download = () => {
    const blob = new Blob([JSON.stringify(receipt, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `orb-otc-receipt-${receipt.txHash.slice(2, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <div className="modal" onClick={onClose}>
      <div className="card wide" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <h2>Trade receipt</h2>
        <p className="hint">Nothing is stored by this site. Download it now if you may need to prove this trade later.</p>
        <div className="kv"><span>Received</span><b>{receipt.orbAmount} ORB (private note)</b></div>
        <div className="kv"><span>Paid</span><b>{receipt.quoteAmount} {receipt.quoteSymbol} + {receipt.takerFee} fee</b></div>
        <div className="kv"><span>Transaction</span><a href={explorerTx(receipt.txHash)} target="_blank" rel="noreferrer">{short(receipt.txHash)}</a></div>
        <div className="kv"><span>Note commitment</span><code>{short(receipt.commitment)}</code></div>
        <div className="kv"><span>Signed by</span><b>{receipt.signature ? short(receipt.address) : "not signed"}</b></div>
        <p className="hint">To see the ORB: Orbinum Hub → Shielded Pool → Recover Notes.</p>
        <div className="actions">
          <button className="btn solid" onClick={download}>Download receipt</button>
          <button className="btn ghost" onClick={onSign} disabled={!!receipt.signature}>{receipt.signature ? "Signed" : "Sign proof of address"}</button>
          <button className="btn ghost" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

function OneTimeAddress() {
  const [acct, setAcct] = useState<{ address: string; key: string } | null>(null);
  const [copied, setCopied] = useState("");
  const gen = () => {
    const key = generatePrivateKey();
    setAcct({ address: privateKeyToAccount(key).address, key });
    setCopied("");
  };
  const copy = async (what: string, text: string) => {
    try { await navigator.clipboard.writeText(text); setCopied(what); } catch { /* clipboard unavailable */ }
  };
  return (
    <div className="card wide reveal">
      <h2>One-time address</h2>
      <p className="hint">Trade from a fresh address that has no history and is not linked to your main wallet. This page creates it in your browser and stores nothing.</p>
      <button className="btn solid" onClick={gen}>Generate new address</button>
      {acct && (
        <>
          <label>Address</label>
          <div className="copyrow"><code>{acct.address}</code><button className="btn ghost small" onClick={() => copy("address", acct.address)}>{copied === "address" ? "Copied" : "Copy"}</button></div>
          <label>Private key: keep secret, shown only now</label>
          <div className="copyrow"><code>{acct.key}</code><button className="btn ghost small" onClick={() => copy("key", acct.key)}>{copied === "key" ? "Copied" : "Copy"}</button></div>
          <ol className="steps">
            <li>In Orbinum Hub, unshield ORB to the address above.</li>
            <li>In your wallet choose Import account and paste the private key.</li>
            <li>Connect that account here, get test tokens, and trade.</li>
          </ol>
          <div className="warn">Testnet only. Never reuse this key on a real network, and never share it.</div>
        </>
      )}
    </div>
  );
}

function CreateForm({ busy, tokens, initial, makerBps, onSubmit }: { busy: boolean; tokens: Token[]; initial?: Token; makerBps: number; onSubmit: (t: Token, isSell: boolean, price: bigint, orb: bigint) => void }) {
  const [isSell, setIsSell] = useState(true);
  const [tokAddr, setTokAddr] = useState<string>(initial?.address ?? tokens[0]?.address ?? "");
  const [price, setPrice] = useState("");
  const [amt, setAmt] = useState("");
  const token = tokens.find((t) => sameAddr(t.address, tokAddr)) ?? tokens[0];
  let p = 0n, o = 0n;
  try { p = parseUnits(price || "0", token?.decimals ?? 6); o = parseEther(amt || "0"); } catch { /* invalid input */ }
  const valid = !!token && p > 0n && o > 0n && cost(o, p) > 0n;
  const q = valid ? cost(o, p) : 0n;
  const fee = feeOf(q, makerBps);
  return (
    <div className="card reveal">
      <h2>New order</h2>
      <div className="seg">
        <button className={"btn " + (isSell ? "act sell" : "ghost")} onClick={() => setIsSell(true)}>Sell ORB</button>
        <button className={"btn " + (!isSell ? "act buy" : "ghost")} onClick={() => setIsSell(false)}>Buy ORB</button>
      </div>
      {tokens.length > 1 && (
        <>
          <label>Quote token</label>
          <select value={token?.address} onChange={(e) => setTokAddr(e.target.value)}>
            {tokens.map((t) => <option key={t.address} value={t.address}>{t.symbol}</option>)}
          </select>
        </>
      )}
      <label>Price ({token?.symbol} per ORB)</label>
      <input value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" placeholder="1.50" />
      <label>Amount (ORB)</label>
      <input value={amt} onChange={(e) => setAmt(e.target.value)} inputMode="decimal" placeholder="10" />
      <div className="summary">
        {valid
          ? isSell
            ? `Locks ${amt} ORB. When filled you receive ${fmtQuote(q - fee, token)} ${token?.symbol} (price minus ${pct(makerBps)} maker fee).`
            : `Locks ${fmtQuote(q + fee, token)} ${token?.symbol} (price plus ${pct(makerBps)} maker fee, unused fee is refunded on cancel). You receive ${amt} ORB (publicly) when filled.`
          : "Enter price and amount"}
      </div>
      <button className="btn solid" disabled={!valid || busy} onClick={() => token && onSubmit(token, isSell, p, o)}>Place order</button>
    </div>
  );
}
