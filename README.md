<div align="center">

# ORB.OTC

**Big trades, quietly. Provable when it matters.**

A private OTC desk for ORB on Orbinum. Escrowed settlement, shielded receive, selective disclosure. *Private, not anonymous.*

![status](https://img.shields.io/badge/status-testnet%20only-yellow)
![chain](https://img.shields.io/badge/Orbinum%20Testnet-2700-8b7bff)

</div>

> [!WARNING]
> **Testnet only.** ORB and tUSD on this network have no real value.

---

**Live demo:** https://rheeunion.github.io/orb-otc-demo/

## Who it is for

Sometimes a trade should not be broadcast to everyone: a foundation moving a treasury allocation, a market maker taking inventory, a fund closing a block, a validator rebalancing, or a holder exiting a large position. Public wallets turn each of those into a market signal.

ORB.OTC is community-first and institution-friendly. It gives you:

- **Escrow.** Funds sit in a contract, never with us. Cancelling always works.
- **Private receive.** The buyer takes ORB into a shielded note, so the public cannot see who holds it afterwards.
- **Selective disclosure.** A receipt with a disclosure key and a signature from the trading address lets you prove the trade to an exchange, auditor, tax authority or counterparty. Only when you choose to.

What it does **not** hide today: an order's price, size and trading addresses are public on-chain, and only the ORB receive side is private. See [docs/POSITIONING.md](docs/POSITIONING.md) for the full statement of what is and is not private.

## Trade in four steps

1. **Connect Wallet.** Click the button and approve MetaMask (or any EVM wallet). The site adds **Orbinum Testnet** to your wallet and switches to it automatically. There is nothing to configure.
2. **Get test funds.** Use **Get ORB** for testnet ORB (gas and trading) and **Get tUSD** for the test quote token. Both buttons are in the header.
3. **Pick an order.** The Order Book shows **Sell Orders** (buy ORB) and **Buy Orders** (sell ORB) with price, volume and total. Click a row's button, enter an amount (full or partial) and confirm.
4. **Or post your own.** Open **New Order**, set a price and amount, and place it. Manage or cancel open orders under **My Orders**.

## Private receive and one-time addresses

- **Receive privately.** When you buy ORB you can choose to have it paid into a shielded note for your Orbinum privacy address instead of your public address. Paste the privacy address from Orbinum Hub. Afterwards open Hub, go to Shielded Pool and run **Recover Notes** to see the ORB.
- **One-time address.** The site can create a fresh trading address in your browser (nothing is stored). Fund it by unshielding from Hub, import it into your wallet, and trade without using your main address.
- **Proof on demand.** After a private receive you can download a receipt with a disclosure key and sign it with your trading address, to prove a specific trade only when you choose to.

## Why it is safe to use

- **Non-custodial escrow.** Funds sit in the OrbOTC smart contract, never with us. They move only when an order is filled or its maker cancels.
- **Cancel anytime.** Unfilled escrow goes straight back to the maker.
- **Fees** are charged in the order's quote token (tUSD on testnet) on the trade amount: taker 0.20%, maker 0.10% (the maker rate is fixed when the order is placed). The contract caps each side at 1.00%. Gas is paid in ORB.
- **No account, no sign-up.** Your wallet is your login.
- **Operator controls never touch your funds.** The operator can pause new trading or block specific addresses from new trades, but cancelling your own order always works.

## How it works

| | Sell Orders | Buy Orders |
|---|---|---|
| **Maker locks** | ORB | tUSD |
| **Maker receives** | tUSD | ORB |
| **Taker action** | Buy ORB | Sell ORB |

`price` is tUSD per 1 ORB. Amounts use integer math and the payer's side is rounded up, so an order can never be under-funded.

## Architecture

<p align="center">
  <img src="docs/architecture.svg" alt="ORB.OTC architecture: wallets and the web UI talk to the Orbinum RPC, which reaches the OrbOTCV2 escrow contract, its quote tokens and the ShieldedPool precompile; the operator administers the contract; a multichain balance scanner is prepared for mainnet" width="900">
</p>

| Component | Role |
|---|---|
| **Web UI** | Static React + viem site with no backend. Reads the order book through the RPC (every 8 seconds) and builds transactions. Holds no keys and no funds. |
| **Wallets** | Any EIP-6963 browser wallet (MetaMask, Rabby, Talisman, Coinbase, OKX, Trust, ...). Signs every transaction, shares one or more accounts, and adds or switches to the Orbinum network. |
| **Browser modules** | Runs only in the browser: the shielded-note builder (uses the recipient's public privacy address, never a spending key), trade receipts with disclosure keys, the one-time address generator and the multichain balance scanner. |
| **Orbinum RPC** | JSON-RPC endpoint used for reads and for broadcasting signed transactions. |
| **OrbOTCV2 contract** | Escrows ORB and quote tokens, handles partial fills and cancels, charges maker and taker fees per quote token, keeps the quote-token whitelist, and supports pause, blocklist and private fills. Cancelling is always possible. |
| **Quote tokens** | The whitelisted stablecoins: tUSD (a test token) on testnet, USDT and USDC on mainnet. |
| **ShieldedPool precompile** | Orbinum's `0x…0801`. A private fill pays the ORB into a shielded note through `shield(commitment, memo)` instead of a public transfer. |
| **Orbinum Hub** | Where the buyer finds the note: Shielded Pool → Recover Notes. |
| **Operator** | Administers the contract with the admin CLI (pause, blocklist, fees, quote tokens, ownership). Moves to a multisig for mainnet. Cannot move user funds. |
| **Other EVM networks** | Prepared for mainnet and switched off: the scanner reads USDT and USDC balances on Ethereum, BNB Chain, Arbitrum, Base and Polygon through public RPCs. |

## Network

| | |
|---|---|
| Network | Orbinum Testnet |
| Chain ID | `2700` |
| RPC | `https://rpc-1.testnet.orbinum.io` |
| Currency | ORB (18 decimals) |
| Explorer | https://explorer.testnet.orbinum.network |
| ORB faucet | https://faucet.orbinum.network (5 ORB / 24h) |

## For the team

Contract deployment, hosting and release steps are in [docs/OPERATIONS.md](docs/OPERATIONS.md). Compliance notes and limits of the operator controls are in [docs/COMPLIANCE.md](docs/COMPLIANCE.md). A full status report and the mainnet checklist (Korean) are in [docs/STATUS_AND_MAINNET.ko.md](docs/STATUS_AND_MAINNET.ko.md).

## Roadmap

- [x] Escrow order book with partial fills (testnet)
- [ ] Trade history from `OrderFilled` events
- [x] Private receive for sell orders via the Orbinum shielded pool (testnet)
- [x] Operator pause and blocklist, one-time address tool, trade receipts
- [ ] Private receive for buy orders (needs a per-order privacy address)
- [ ] Automated sanctions screening and multisig admin
- [x] Multi quote token contract and multichain stablecoin balance scanner, built and switched off until mainnet
- [ ] Mainnet stablecoins (USDT/USDC) with bridging into Orbinum and payouts to other networks, see [docs/CROSSCHAIN.md](docs/CROSSCHAIN.md)
- [ ] Order expiry and minimum fill size
- [ ] Security audit and mainnet launch
