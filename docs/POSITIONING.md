# Positioning

## One line

**A private OTC desk for ORB: big trades, quietly, and provable when it matters.** Private, not anonymous.

## The problem

On a public chain a large trade is itself a signal. When a foundation sends tokens to a market maker or a fund closes a block, the wallet movement is visible immediately, the market reads it as selling pressure, and the price moves before the deal is done. The counterparties also become easy to track.

Fully anonymous tools solve the visibility problem but cannot be used by anyone who has to answer to an exchange, an auditor, a tax authority or a regulator.

## The idea

Hide what the public does not need to know, and keep the ability to prove what a counterparty or authority does need to know.

| Layer | What we do |
|---|---|
| Settlement | Escrow contract. No custody by the operator. Cancel always works. |
| Public visibility | The buyer receives ORB into a shielded note, so ownership after the trade is not public. One-time addresses break the link to a main address. |
| Accountability | Receipts with disclosure keys and an address-ownership signature. The holder decides who sees them. |
| Operator | Can pause trading and block addresses. Cannot move or freeze user funds. |

## Who it is for

Community first, institutions welcome.

- **Foundations and project teams** moving treasury allocations without a public dump signal.
- **Market makers** borrowing or buying inventory.
- **Funds and VCs** buying or exiting blocks, with LP and audit evidence available.
- **Validators and node operators** rebalancing.
- **Individual holders** who do not want their wallet to be followed.

## What is private today (testnet build)

| Item | Private? |
|---|---|
| Who owns the ORB after a Sell-order fill with private receive | Yes |
| Link between the trading address and the receiving privacy address | Not on-chain. It is only shown if the holder shares the receipt |
| Order price, size, trading addresses | **No.** Public contract calls |
| The quote-token (stablecoin) leg | **No.** ERC-20 cannot enter the shielded pool today |
| Private receive on Buy orders | Not available yet |

Copy on the site and in marketing must not claim more than this table.

## What we are not

- Not an anonymity or mixing service. The design goal is the opposite: private by default, provable on demand.
- Not a place to evade sanctions or launder funds. See [COMPLIANCE.md](COMPLIANCE.md). Mainnet requires screening and terms of use before launch.
- Not a token launchpad or an open listing venue. Assets are added by the operator after review.

## Voice

Calm, precise, plain. Say what is and is not hidden. Prefer "private" and "provable" over "anonymous" or "untraceable". Never promise regulatory outcomes.

## Roadmap that serves this story

1. Counterparty-restricted orders (only a named address or link holder can fill), the core block-deal feature.
2. Unlisted orders shared by link instead of the public book.
3. Stronger evidence pack: signed summary, verifier page for auditors.
4. Private receive on Buy orders and shielded quote-token settlement, when Orbinum supports it.
5. Sanctions screening, terms of use and reporting channel for mainnet.
