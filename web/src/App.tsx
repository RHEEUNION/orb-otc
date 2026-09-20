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
import {
  DEPLOYED,
  erc20Abi,
  orbinumTestnet,
  otcAbi,
  OTC,
  QUOTE,
  QUOTE_DECIMALS,
  QUOTE_SYMBOL,
} from "./chain";

type Order = {
  id: bigint;
  maker: Address;
  isSell: boolean;
  open: boolean;
  price: bigint;
  remainingOrb: bigint;
  remainingQuote: bigint;
};
type Tab = "market" | "mine" | "create" | "faq";
type Toast = { msg: string; err?: boolean } | null;

const pub = createPublicClient({ chain: orbinumTestnet, transport: http() });
const eth = () => (window as any).ethereum;

const fmtPrice = (p: bigint) => Number(formatUnits(p, QUOTE_DECIMALS)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 });
const fmtOrb = (v: bigint) => Number(formatEther(v)).toLocaleString(undefined, { maximumFractionDigits: 4 });
const cost = (orb: bigint, price: bigint) => (orb * price + 10n ** 18n - 1n) / 10n ** 18n;
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

export default function App() {
  const [tab, setTab] = useState<Tab>("market");
  const [account, setAccount] = useState<Address | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [orbBal, setOrbBal] = useState<bigint>(0n);
  const [usdBal, setUsdBal] = useState<bigint>(0n);
  const [toast, setToast] = useState<Toast>(null);
  const [busy, setBusy] = useState(false);
  const [fill, setFill] = useState<Order | null>(null);

  const notify = (msg: string, err = false) => {
    setToast({ msg, err });
    setTimeout(() => setToast(null), 5000);
  };

  const loadOrders = useCallback(async () => {
    if (!DEPLOYED) return;
    const n = (await pub.readContract({ address: OTC, abi: otcAbi, functionName: "nextOrderId" })) as bigint;
    const all: Order[] = [];
    for (let from = 0n; from < n; from += 200n) {
      const [ids, list] = (await pub.readContract({ address: OTC, abi: otcAbi, functionName: "getOrders", args: [from, 200n] })) as any;
      list.forEach((o: any, i: number) => all.push({ id: ids[i], ...o }));
    }
    setOrders(all.filter((o) => o.open));
  }, []);

  const loadBalances = useCallback(async () => {
    if (!account) return;
    setOrbBal(await pub.getBalance({ address: account }));
    if (DEPLOYED) setUsdBal((await pub.readContract({ address: QUOTE, abi: erc20Abi, functionName: "balanceOf", args: [account] })) as bigint);
  }, [account]);

  useEffect(() => {
    loadOrders().catch(() => {});
    const t = setInterval(() => loadOrders().catch(() => {}), 8000);
    return () => clearInterval(t);
  }, [loadOrders]);
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

  async function run(label: string, fn: () => Promise<`0x${string}`[]>) {
    if (!account) return notify("Connect wallet first", true);
    setBusy(true);
    try {
      await ensureChain();
      for (const hash of await fn()) await pub.waitForTransactionReceipt({ hash });
      notify(`${label} ✓`);
      await loadOrders();
      await loadBalances();
    } catch (e: any) {
      notify(e.shortMessage ?? e.message, true);
    } finally {
      setBusy(false);
    }
  }

  async function approveIfNeeded(amount: bigint): Promise<`0x${string}`[]> {
    const allowance = (await pub.readContract({ address: QUOTE, abi: erc20Abi, functionName: "allowance", args: [account!, OTC] })) as bigint;
    if (allowance >= amount) return [];
    const h = await wallet().writeContract({ address: QUOTE, abi: erc20Abi, functionName: "approve", args: [OTC, amount] });
    await pub.waitForTransactionReceipt({ hash: h });
    return [];
  }

  const faucet = () =>
    run("tUSD faucet", async () => [await wallet().writeContract({ address: QUOTE, abi: erc20Abi, functionName: "faucet" })]);

  const cancel = (o: Order) =>
    run("Order cancelled", async () => [await wallet().writeContract({ address: OTC, abi: otcAbi, functionName: "cancelOrder", args: [o.id] })]);

  const confirmFill = (o: Order, orbAmount: bigint) => {
    setFill(null);
    return run("Order filled", async () => {
      if (o.isSell) {
        await approveIfNeeded(cost(orbAmount, o.price));
        return [await wallet().writeContract({ address: OTC, abi: otcAbi, functionName: "fillSellOrder", args: [o.id, orbAmount] })];
      }
      return [await wallet().writeContract({ address: OTC, abi: otcAbi, functionName: "fillBuyOrder", args: [o.id], value: orbAmount })];
    });
  };

  const create = (isSell: boolean, price: bigint, orb: bigint) =>
    run("Order created", async () => {
      if (isSell)
        return [await wallet().writeContract({ address: OTC, abi: otcAbi, functionName: "createSellOrder", args: [price], value: orb })];
      await approveIfNeeded(cost(orb, price));
      return [await wallet().writeContract({ address: OTC, abi: otcAbi, functionName: "createBuyOrder", args: [price, orb] })];
    });

  const sells = useMemo(() => orders.filter((o) => o.isSell).sort((a, b) => (a.price < b.price ? -1 : a.price > b.price ? 1 : 0)), [orders]);
  const buys = useMemo(() => orders.filter((o) => !o.isSell).sort((a, b) => (a.price > b.price ? -1 : a.price < b.price ? 1 : 0)), [orders]);
  const mine = useMemo(() => orders.filter((o) => account && o.maker.toLowerCase() === account.toLowerCase()), [orders, account]);

  return (
    <>
      <div className="banner">TESTNET ONLY — Orbinum Testnet (chain 2700). Tokens have no real value.</div>
      <header>
        <div className="brand">ORB<span>.OTC</span><span className="badge">testnet</span></div>
        <nav>
          {(["market", "mine", "create", "faq"] as Tab[]).map((t) => (
            <button key={t} className={tab === t ? "on" : ""} onClick={() => setTab(t)}>
              {{ market: "Order Book", mine: "My Orders", create: "New Order", faq: "FAQ" }[t]}
            </button>
          ))}
        </nav>
        <div className="spacer" />
        {account && (
          <>
            <span style={{ color: "var(--muted)" }}>{fmtOrb(orbBal)} ORB · {Number(formatUnits(usdBal, QUOTE_DECIMALS)).toLocaleString()} {QUOTE_SYMBOL}</span>
            <button className="btn ghost small" disabled={busy || !DEPLOYED} onClick={faucet}>Get {QUOTE_SYMBOL}</button>
            <a className="btn ghost small" href="https://faucet.orbinum.network/" target="_blank" rel="noreferrer">Get ORB</a>
          </>
        )}
        <button className="btn" onClick={connect}>{account ? short(account) : "Connect Wallet"}</button>
      </header>

      <main>
        {!DEPLOYED && (
          <p className="empty">Contracts are not deployed yet. Run <code>npm run deploy:testnet</code> and rebuild the site.</p>
        )}

        {tab === "market" && (
          <div className="grid">
            <Book title="Sell Orders" orders={sells} action="Buy ORB" cls="buy-btn" onAct={setFill} />
            <Book title="Buy Orders" orders={buys} action="Sell ORB" cls="sell-btn" onAct={setFill} />
          </div>
        )}

        {tab === "mine" && (
          <>
            <h2>My Open Orders</h2>
            <table>
              <thead><tr><th>Side</th><th>Price</th><th>ORB left</th><th>Total</th><th /></tr></thead>
              <tbody>
                {mine.length === 0 && <tr><td colSpan={5} className="empty">{account ? "No open orders" : "Connect your wallet"}</td></tr>}
                {mine.map((o) => (
                  <tr key={String(o.id)}>
                    <td className={o.isSell ? "sell" : "buy"}>{o.isSell ? "Selling" : "Buying"}</td>
                    <td>{fmtPrice(o.price)} {QUOTE_SYMBOL}</td>
                    <td>{fmtOrb(o.remainingOrb)}</td>
                    <td>{fmtPrice(cost(o.remainingOrb, o.price))} {QUOTE_SYMBOL}</td>
                    <td><button className="btn small ghost" disabled={busy} onClick={() => cancel(o)}>Cancel</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}

        {tab === "create" && <CreateForm busy={busy} onSubmit={create} />}

        {tab === "faq" && (
          <div className="faq">
            <h2>FAQ</h2>
            <h3>What is this?</h3>
            <p>A peer-to-peer OTC order book for ORB on the Orbinum testnet. Makers lock funds in an escrow contract; takers fill orders in one transaction. No custody by us, no backend.</p>
            <h3>What is tUSD?</h3>
            <p>A worthless test token (6 decimals) used as the quote currency. Use the “Get tUSD” button once per hour.</p>
            <h3>Can I fill part of an order?</h3>
            <p>Yes. Enter any amount up to the remaining size.</p>
            <h3>Fees?</h3>
            <p>None on testnet, other than gas paid in ORB.</p>
            <h3>Privacy?</h3>
            <p>Orders and fills are public EVM transactions today. Settlement through Orbinum shielded pools is on the roadmap.</p>
            <p>Contracts: OTC <a href={`${orbinumTestnet.blockExplorers.default.url}/address/${OTC}`} target="_blank" rel="noreferrer">{short(OTC)}</a> · {QUOTE_SYMBOL} <a href={`${orbinumTestnet.blockExplorers.default.url}/address/${QUOTE}`} target="_blank" rel="noreferrer">{short(QUOTE)}</a></p>
          </div>
        )}
      </main>

      {fill && <FillModal order={fill} busy={busy} onClose={() => setFill(null)} onConfirm={confirmFill} />}
      {toast && <div className={"toast" + (toast.err ? " err" : "")}>{toast.msg}</div>}
    </>
  );
}

function Book({ title, orders, action, cls, onAct }: { title: string; orders: Order[]; action: string; cls: string; onAct: (o: Order) => void }) {
  return (
    <section>
      <h2>{title}</h2>
      <table>
        <thead><tr><th>Price ({QUOTE_SYMBOL}/ORB)</th><th>Volume (ORB)</th><th>Total ({QUOTE_SYMBOL})</th><th /></tr></thead>
        <tbody>
          {orders.length === 0 && <tr><td colSpan={4} className="empty">No orders</td></tr>}
          {orders.map((o) => (
            <tr key={String(o.id)}>
              <td>{fmtPrice(o.price)}</td>
              <td>{fmtOrb(o.remainingOrb)}</td>
              <td>{fmtPrice(cost(o.remainingOrb, o.price))}</td>
              <td><button className={"btn small " + cls} onClick={() => onAct(o)}>{action}</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function FillModal({ order, busy, onClose, onConfirm }: { order: Order; busy: boolean; onClose: () => void; onConfirm: (o: Order, amt: bigint) => void }) {
  const [amt, setAmt] = useState(formatEther(order.remainingOrb));
  let orb = 0n;
  try { orb = parseEther(amt || "0"); } catch { /* invalid input */ }
  const valid = orb > 0n && orb <= order.remainingOrb && cost(orb, order.price) > 0n;
  return (
    <div className="modal" onClick={onClose}>
      <div className="card" onClick={(e) => e.stopPropagation()}>
        <h2>{order.isSell ? "Buy ORB" : "Sell ORB"}</h2>
        <label>Amount (ORB) — max {fmtOrb(order.remainingOrb)}</label>
        <input value={amt} onChange={(e) => setAmt(e.target.value)} inputMode="decimal" />
        <div className="summary">
          @ {fmtPrice(order.price)} {QUOTE_SYMBOL}/ORB → you {order.isSell ? "pay" : "receive"} <b>{valid ? fmtPrice(cost(orb, order.price)) : "—"} {QUOTE_SYMBOL}</b>
        </div>
        <button className="btn" disabled={!valid || busy} onClick={() => onConfirm(order, orb)}>Confirm</button>{" "}
        <button className="btn ghost" onClick={onClose}>Close</button>
      </div>
    </div>
  );
}

function CreateForm({ busy, onSubmit }: { busy: boolean; onSubmit: (isSell: boolean, price: bigint, orb: bigint) => void }) {
  const [isSell, setIsSell] = useState(true);
  const [price, setPrice] = useState("");
  const [amt, setAmt] = useState("");
  let p = 0n, o = 0n;
  try { p = parseUnits(price || "0", QUOTE_DECIMALS); o = parseEther(amt || "0"); } catch { /* invalid input */ }
  const valid = p > 0n && o > 0n && cost(o, p) > 0n;
  return (
    <div className="card">
      <h2>New Order</h2>
      <div className="seg">
        <button className={"btn " + (isSell ? "sell-btn" : "ghost")} onClick={() => setIsSell(true)}>Sell ORB</button>
        <button className={"btn " + (!isSell ? "buy-btn" : "ghost")} onClick={() => setIsSell(false)}>Buy ORB</button>
      </div>
      <label>Price ({QUOTE_SYMBOL} per ORB)</label>
      <input value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" placeholder="1.50" />
      <label>Amount (ORB)</label>
      <input value={amt} onChange={(e) => setAmt(e.target.value)} inputMode="decimal" placeholder="10" />
      <div className="summary">
        {valid
          ? isSell
            ? `Locks ${amt} ORB. You receive ${fmtPrice(cost(o, p))} ${QUOTE_SYMBOL} when filled.`
            : `Locks ${fmtPrice(cost(o, p))} ${QUOTE_SYMBOL}. You receive ${amt} ORB when filled.`
          : "Enter price and amount"}
      </div>
      <button className="btn" disabled={!valid || busy} onClick={() => onSubmit(isSell, p, o)}>Place order</button>
    </div>
  );
}
