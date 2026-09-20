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
import {
  DEPLOYED,
  erc20Abi,
  IS_V2,
  orbinumTestnet,
  otcAbi,
  OTC,
  PRIVATE_FILL_GAS,
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
  quoteAmount: string;
  price: string;
  commitment: string;
  disclosureKey: string;
  createdAt: string;
  signMessage?: string;
  signature?: string;
};

const pub = createPublicClient({ chain: orbinumTestnet, transport: http() });
const eth = () => (window as any).ethereum;

const fmtPrice = (p: bigint) => Number(formatUnits(p, QUOTE_DECIMALS)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 });
const fmtOrb = (v: bigint) => Number(formatEther(v)).toLocaleString(undefined, { maximumFractionDigits: 4 });
const cost = (orb: bigint, price: bigint) => (orb * price + 10n ** 18n - 1n) / 10n ** 18n;
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const explorerTx = (h: string) => `${orbinumTestnet.blockExplorers.default.url}/tx/${h}`;

export default function App() {
  const [tab, setTab] = useState<Tab>("market");
  const [account, setAccount] = useState<Address | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [orbBal, setOrbBal] = useState<bigint>(0n);
  const [usdBal, setUsdBal] = useState<bigint>(0n);
  const [toast, setToast] = useState<Toast>(null);
  const [busy, setBusy] = useState(false);
  const [fill, setFill] = useState<Order | null>(null);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [paused, setPaused] = useState(false);
  const [isBlocked, setIsBlocked] = useState(false);

  const notify = (msg: string, err = false) => {
    setToast({ msg, err });
    setTimeout(() => setToast(null), 6000);
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
    if (IS_V2) setPaused((await pub.readContract({ address: OTC, abi: otcAbi, functionName: "paused" })) as boolean);
  }, []);

  const loadBalances = useCallback(async () => {
    if (!account) return;
    setOrbBal(await pub.getBalance({ address: account }));
    if (DEPLOYED) setUsdBal((await pub.readContract({ address: QUOTE, abi: erc20Abi, functionName: "balanceOf", args: [account] })) as bigint);
    if (IS_V2) setIsBlocked((await pub.readContract({ address: OTC, abi: otcAbi, functionName: "blocked", args: [account] })) as boolean);
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

  async function confirmFill(o: Order, orbAmount: bigint, privacyAddress?: string) {
    setFill(null);
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
      const hashes = await run("Filled — ORB sent to your private note", async () => {
        await approveIfNeeded(quoteAmount);
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
          quoteAmount: formatUnits(quoteAmount, QUOTE_DECIMALS),
          price: formatUnits(o.price, QUOTE_DECIMALS),
          commitment: note.commitment,
          disclosureKey: note.disclosureKey,
          createdAt: new Date().toISOString(),
        });
      }
      return;
    }
    await run("Order filled", async () => {
      if (o.isSell) {
        await approveIfNeeded(cost(orbAmount, o.price));
        return [await wallet().writeContract({ address: OTC, abi: otcAbi, functionName: "fillSellOrder", args: [o.id, orbAmount] })];
      }
      return [await wallet().writeContract({ address: OTC, abi: otcAbi, functionName: "fillBuyOrder", args: [o.id], value: orbAmount })];
    });
  }

  const create = (isSell: boolean, price: bigint, orb: bigint) =>
    run("Order created", async () => {
      if (isSell)
        return [await wallet().writeContract({ address: OTC, abi: otcAbi, functionName: "createSellOrder", args: [price], value: orb })];
      await approveIfNeeded(cost(orb, price));
      return [await wallet().writeContract({ address: OTC, abi: otcAbi, functionName: "createBuyOrder", args: [price, orb] })];
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

  const sells = useMemo(() => orders.filter((o) => o.isSell).sort((a, b) => (a.price < b.price ? -1 : a.price > b.price ? 1 : 0)), [orders]);
  const buys = useMemo(() => orders.filter((o) => !o.isSell).sort((a, b) => (a.price > b.price ? -1 : a.price < b.price ? 1 : 0)), [orders]);
  const mine = useMemo(() => orders.filter((o) => account && o.maker.toLowerCase() === account.toLowerCase()), [orders, account]);
  const tradingOff = paused || isBlocked;

  return (
    <>
      <div className="banner">TESTNET ONLY — Orbinum Testnet (chain 2700). Tokens have no real value.</div>
      {paused && <div className="banner alert">Trading is paused by the operator. You can still cancel your own orders and get your funds back.</div>}
      {!paused && isBlocked && <div className="banner alert">This address is blocked from new trades. You can still cancel your own orders and get your funds back.</div>}
      <header>
        <div className="brand">ORB<span>.OTC</span><span className="badge">testnet</span></div>
        <nav>
          {(["market", "mine", "create", ...(IS_V2 ? ["onetime"] : []), "faq"] as Tab[]).map((t) => (
            <button key={t} className={tab === t ? "on" : ""} onClick={() => setTab(t)}>
              {{ market: "Order Book", mine: "My Orders", create: "New Order", onetime: "One-time address", faq: "FAQ" }[t]}
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
            <Book title="Sell Orders" orders={sells} action="Buy ORB" cls="buy-btn" disabled={tradingOff} onAct={setFill} />
            <Book title="Buy Orders" orders={buys} action="Sell ORB" cls="sell-btn" disabled={tradingOff} onAct={setFill} />
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

        {tab === "create" && <CreateForm busy={busy || tradingOff} onSubmit={create} />}
        {tab === "onetime" && <OneTimeAddress />}

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
            <h3>Private receive</h3>
            <p>When you buy ORB from a sell order you can choose “Receive privately”. The ORB is paid into a shielded note for your Orbinum privacy address instead of your public address. Paste the privacy address from Orbinum Hub. Afterwards, open Hub → Shielded Pool → Recover Notes to see it. Price, size and the trading address stay public; what is hidden is who owns the ORB afterwards.</p>
            <h3>Trading without your main address</h3>
            <p>Every trade is made from an EVM address. Use the “One-time address” page to create a fresh one, fund it by unshielding from Hub, and import it into your wallet. Nothing links it to your main address unless you choose to prove it.</p>
            <h3>Proving a trade</h3>
            <p>After a private receive you can download a receipt with a disclosure key and sign it with the trading address. Share it only with whoever you need to show it to. A disclosure key proves a note's value and asset and cannot be used to spend it.</p>
            <h3>Operator controls</h3>
            <p>The operator can pause new trading and block specific addresses from creating or filling orders. Cancelling your own order always works, and the operator can never move or hold your funds.</p>
            <p>Contracts: OTC <a href={`${orbinumTestnet.blockExplorers.default.url}/address/${OTC}`} target="_blank" rel="noreferrer">{short(OTC)}</a> · {QUOTE_SYMBOL} <a href={`${orbinumTestnet.blockExplorers.default.url}/address/${QUOTE}`} target="_blank" rel="noreferrer">{short(QUOTE)}</a></p>
          </div>
        )}
      </main>

      {fill && <FillModal order={fill} busy={busy} privateAvailable={IS_V2} onClose={() => setFill(null)} onConfirm={confirmFill} />}
      {receipt && <ReceiptModal receipt={receipt} onSign={signReceipt} onClose={() => setReceipt(null)} />}
      {toast && <div className={"toast" + (toast.err ? " err" : "")}>{toast.msg}</div>}
    </>
  );
}

function Book({ title, orders, action, cls, disabled, onAct }: { title: string; orders: Order[]; action: string; cls: string; disabled: boolean; onAct: (o: Order) => void }) {
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
              <td><button className={"btn small " + cls} disabled={disabled} onClick={() => onAct(o)}>{action}</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function FillModal({ order, busy, privateAvailable, onClose, onConfirm }: { order: Order; busy: boolean; privateAvailable: boolean; onClose: () => void; onConfirm: (o: Order, amt: bigint, privacyAddress?: string) => void }) {
  const [amt, setAmt] = useState(formatEther(order.remainingOrb));
  const [priv, setPriv] = useState(false);
  const [addr, setAddr] = useState("");
  const [addrError, setAddrError] = useState("");
  let orb = 0n;
  try { orb = parseEther(amt || "0"); } catch { /* invalid input */ }
  const valid = orb > 0n && orb <= order.remainingOrb && cost(orb, order.price) > 0n;

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
      <div className="card" onClick={(e) => e.stopPropagation()}>
        <h2>{order.isSell ? "Buy ORB" : "Sell ORB"}</h2>
        <label>Amount (ORB) — max {fmtOrb(order.remainingOrb)}</label>
        <input value={amt} onChange={(e) => setAmt(e.target.value)} inputMode="decimal" />
        <div className="summary">
          @ {fmtPrice(order.price)} {QUOTE_SYMBOL}/ORB → you {order.isSell ? "pay" : "receive"} <b>{valid ? fmtPrice(cost(orb, order.price)) : "—"} {QUOTE_SYMBOL}</b>
        </div>
        {order.isSell && privateAvailable && (
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
          </>
        )}
        {!order.isSell && <div className="hint">The buyer receives the ORB publicly at their trading address.</div>}
        <button className="btn" disabled={!valid || busy || !privOk} onClick={() => onConfirm(order, orb, priv ? addr.trim() : undefined)}>Confirm</button>{" "}
        <button className="btn ghost" onClick={onClose}>Close</button>
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
      <div className="card wide" onClick={(e) => e.stopPropagation()}>
        <h2>Trade receipt</h2>
        <p className="hint">Nothing is stored by this site. Download it now if you may need to prove this trade later.</p>
        <div className="kv"><span>Received</span><b>{receipt.orbAmount} ORB (private note)</b></div>
        <div className="kv"><span>Paid</span><b>{receipt.quoteAmount} {QUOTE_SYMBOL}</b></div>
        <div className="kv"><span>Transaction</span><a href={explorerTx(receipt.txHash)} target="_blank" rel="noreferrer">{short(receipt.txHash)}</a></div>
        <div className="kv"><span>Note commitment</span><code>{short(receipt.commitment)}</code></div>
        <div className="kv"><span>Signed by</span><b>{receipt.signature ? short(receipt.address) : "not signed"}</b></div>
        <p className="hint">To see the ORB: Orbinum Hub → Shielded Pool → Recover Notes.</p>
        <button className="btn" onClick={download}>Download receipt</button>{" "}
        <button className="btn ghost" onClick={onSign} disabled={!!receipt.signature}>{receipt.signature ? "Signed" : "Sign proof of address"}</button>{" "}
        <button className="btn ghost" onClick={onClose}>Close</button>
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
    <div className="card wide">
      <h2>One-time address</h2>
      <p className="hint">Trade from a fresh address that has no history and is not linked to your main wallet. This page creates it in your browser and stores nothing.</p>
      <button className="btn" onClick={gen}>Generate new address</button>
      {acct && (
        <>
          <label>Address</label>
          <div className="copyrow"><code>{acct.address}</code><button className="btn ghost small" onClick={() => copy("address", acct.address)}>{copied === "address" ? "Copied" : "Copy"}</button></div>
          <label>Private key — keep secret, shown only now</label>
          <div className="copyrow"><code>{acct.key}</code><button className="btn ghost small" onClick={() => copy("key", acct.key)}>{copied === "key" ? "Copied" : "Copy"}</button></div>
          <ol className="steps">
            <li>In Orbinum Hub, unshield ORB to the address above.</li>
            <li>In your wallet choose Import account and paste the private key.</li>
            <li>Connect that account here, get tUSD, and trade.</li>
          </ol>
          <div className="warn">Testnet only. Never reuse this key on a real network, and never share it.</div>
        </>
      )}
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
            : `Locks ${fmtPrice(cost(o, p))} ${QUOTE_SYMBOL}. You receive ${amt} ORB (publicly) when filled.`
          : "Enter price and amount"}
      </div>
      <button className="btn" disabled={!valid || busy} onClick={() => onSubmit(isSell, p, o)}>Place order</button>
    </div>
  );
}
