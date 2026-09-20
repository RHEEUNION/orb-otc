<div align="center">

# ORB.OTC

**Trade ORB peer-to-peer on the Orbinum testnet.**

Connect MetaMask · post or take an order · settle on-chain in one transaction.

![status](https://img.shields.io/badge/status-testnet%20only-yellow)
![chain](https://img.shields.io/badge/Orbinum%20Testnet-2700-8b7bff)

</div>

> [!WARNING]
> **Testnet only.** ORB and tUSD on this network have no real value.

---

**Live demo:** https://rheeunion.github.io/orb-otc-demo/

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
- **Fees** are charged in tUSD on the trade amount: taker 0.20%, maker 0.10% (the maker rate is fixed when the order is placed). The contract caps each side at 1.00%. Gas is paid in ORB.
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
  <img src="docs/architecture.svg" alt="ORB.OTC architecture: Web UI, EVM wallet, Orbinum RPC, OrbOTC contract and tUSD token" width="760">
</p>

| Component | Role |
|---|---|
| **Web UI** | React + viem app. Reads the order book through the RPC and builds transactions. Holds no keys. |
| **EVM Wallet** | Signs every transaction and adds or switches to chain 2700. |
| **Orbinum RPC** | JSON-RPC endpoint used for reads (polled every 8s) and for broadcasting signed transactions. |
| **OrbOTC Contract** | Escrows ORB and tUSD, matches fills, handles partial fills and cancels. |
| **tUSD Token** | Test ERC-20 quote asset with a public faucet. |

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

Contract deployment, hosting and release steps are in [docs/OPERATIONS.md](docs/OPERATIONS.md). Compliance notes and limits of the operator controls are in [docs/COMPLIANCE.md](docs/COMPLIANCE.md).

## Roadmap

- [x] Escrow order book with partial fills (testnet)
- [ ] Trade history from `OrderFilled` events
- [x] Private receive for sell orders via the Orbinum shielded pool (testnet)
- [x] Operator pause and blocklist, one-time address tool, trade receipts
- [ ] Private receive for buy orders (needs a per-order privacy address)
- [ ] Automated sanctions screening and multisig admin
- [ ] Mainnet stablecoins (USDT/USDC) with cross-network funding and payout, see [docs/CROSSCHAIN.md](docs/CROSSCHAIN.md)
- [ ] Order expiry and minimum fill size
- [ ] Security audit and mainnet launch
