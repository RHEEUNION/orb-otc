# Compliance notes (internal)

> Not legal advice. Before any mainnet launch, get review from crypto-asset counsel in the jurisdictions you operate or serve.

## Why this matters

ORB.OTC combines an OTC order book with Orbinum's shielded pool. A privacy feature next to an OTC desk is a high-scrutiny combination: it must not become a channel for laundering or sanctions evasion. On testnet the tokens have no value, so there is no exposure today. The risk starts at mainnet with real assets.

The contract is non-custodial, but whoever runs the website and attracts users is generally treated as the responsible operator by regulators, regardless of how decentralised the contract is.

## What the product does and does not hide

| Item | Visible on-chain |
|---|---|
| Order price, size, and the EVM address that created or filled it | yes |
| tUSD leg of every trade | yes (not a shielded asset) |
| Amount of ORB when it enters the shielded pool | yes |
| Who owns the ORB afterwards (private receive) | **no** |
| Link between a trader's main identity and a one-time trading address | no, unless the trader chooses to prove it |

Because price, size, the tUSD leg and the trading address stay public, trades remain monitorable. The privacy applies to ownership of the ORB after it is shielded.

## Controls in `OrbOTCV2`

| Control | Effect | Limits |
|---|---|---|
| `pause()` / `unpause()` | Stops creating and filling orders | Cannot stop `cancelOrder` |
| `setBlocked(addresses, true/false)` | Blocks addresses from creating or filling; also blocks filling an order whose maker is blocked | Reversible, batchable, emits `BlockedSet` events |
| `transferOwnership(addr)` | Moves admin rights (use a multisig on mainnet) | |
| `cancelOrder(id)` | Always works, even when paused or blocked | Users can always recover escrow |
| `setFees`, `setFeeRecipient`, `claimFees` | Platform fees, see below | Capped at 1.00% per side by the contract |

By design no admin function can move, hold or seize user funds. It only stops new trading.

Operate it with `node scripts/admin.mjs` (see `docs/OPERATIONS.md`).

## Fees

| | Rule |
|---|---|
| Base | The quote amount of each fill (tUSD on testnet, USDT/USDC on mainnet) |
| Taker fee | Paid on top of the price by the taker of a sell order, or deducted from the price when the taker fills a buy order. Uses the rate in force at fill time |
| Maker fee | Deducted from the price the maker receives (sell order), or escrowed on top of the price (buy order). **Locked when the order is placed**, so a later rate change never affects an existing order |
| Testnet rates | Maker 0.10%, taker 0.20% |
| Cap | 1.00% per side, enforced by the contract |
| Recipient | An EVM address (a privacy address cannot receive an ERC-20). Testnet: `0x3937B5F83f8e3DB413bD202bAf4da5A64879690F` |
| Payout | Fees accrue inside the contract and `claimFees()` sends them to the recipient. This keeps a blacklisted recipient from blocking trades |

Unused maker-fee escrow on a buy order is refunded when the order is cancelled. Fees are always in the quote token, so fee revenue is public and auditable.

## Proof for the trader ("소명")

Every private receive produces a receipt in the browser (nothing is stored by the site):

- transaction hash and order id
- note commitment
- an `orbdisc:` disclosure key, which proves the note's value and asset and cannot be used to spend it
- optionally a signature from the trading address, proving control of that address

A trader can hand this to an auditor, exchange or authority to link a specific trade to themselves, without exposing anything else.

## Deferred to mainnet preparation

- Automated sanctions screening (external screening oracle checked in the contract and the front end). Needs a real provider and cannot be meaningfully tested on testnet.
- Multisig admin with a timelock instead of a single key.
- Jurisdiction review, licensing or registration if required, terms of use with prohibited activities, and a reporting channel.
- Smart contract security audit. The contracts are unaudited.
- Confirm with the Orbinum team their own compliance tooling and any policy on the shielded pool.

## Not included by decision

Per-order and per-day limits, and a separate cap for private receive, were considered and left out for now.
