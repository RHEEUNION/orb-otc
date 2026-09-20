# Mainnet stablecoins across networks (design, not built)

Goal: on mainnet, ORB trades only against USDT and USDC. A buyer should be able to pay with stablecoins they hold on any network, and a seller should be able to receive USDT/USDC on the network they prefer (Ethereum, BNB Chain, Tron, ...).

Nothing here is implemented. Testnet uses one test token (tUSD) on Orbinum itself.

## What is verified today

| Fact | Source |
|---|---|
| Orbinum has an ISMP messaging pallet that sends **messages** through Hyperbridge to any chain Hyperbridge connects | `orbinum/node` `frame/ismp-messaging` README |
| That pallet is generic message passing. No stablecoin or token gateway for Orbinum is documented or present in the node repo | repo search |
| Orbinum mainnet is targeted for Q4 2026. Cross-chain bridges to Ethereum and L2s appear as a 2027 item | Orbinum roadmap |
| Hyperbridge's own token gateway was deprecated in favour of `HyperFungibleToken`; its Intents Gateway lists USDC, USDT and ETH on Ethereum, Base, BNB Chain and Arbitrum. Tron is not in that list | Hyperbridge docs and coverage (secondary sources) |
| Hyperbridge reported an April 2026 exploit (forged cross-chain message, bridged DOT minted, about $2.5M lost across four EVM chains) | Wikipedia summary of press reports |

## What is not known (ask the Orbinum team)

1. Which USDT and USDC will exist on Orbinum at mainnet, and their ERC-20 addresses.
2. Whether Orbinum will be a destination for Hyperbridge's intents or any other stablecoin bridge, and when.
3. Whether Tron will be supported by any route.

Until these are answered, the settlement asset on Orbinum cannot be chosen.

## Where the difficulty is

The escrow contract runs on Orbinum, so the quote asset has to be an asset that lives on Orbinum. Every other network is a *funding* or *payout* path. Three separate problems:

1. **Seeing balances** on other networks (easy, read only).
2. **Getting stablecoins to Orbinum** for a buyer (needs a bridge that supports Orbinum).
3. **Sending proceeds out** to another network for a seller (needs the same bridge in the other direction).

## Options

| Option | How it works | Fit |
|---|---|---|
| A. Settle on Orbinum, funding by bridge | Orders settle in Orbinum USDT/USDC. The site shows where the user holds stablecoins and guides a bridge into Orbinum, then the trade | Simplest and safest. Two steps for the user |
| B. Intent based cross-chain fill | The taker signs one intent on the source chain; a solver delivers stablecoins to the OTC contract on Orbinum and the fill executes | Best UX. Needs a protocol that supports Orbinum as destination and a message with a contract call. Not available today |
| C. Cross-chain atomic swap (hash time lock) | ORB on Orbinum locked against USDT on another chain with a shared hash | Trust minimised but poor UX: two transactions on two chains, timeouts, and a Tron variant needs its own contract |
| D. Payout preference on the order | The maker chooses payout network and address when placing the order; proceeds are bridged out after each fill | Good for sellers. Must keep a fallback: if the bridge step fails, proceeds stay claimable on Orbinum |

## Recommended path

1. **Launch on Option A** once Orbinum has USDT/USDC. Do not depend on a bridge inside the trade itself.
2. **Balance scanner** in the connect flow. EVM networks: read USDT/USDC balances through public RPC multicalls. Tron needs TronLink and the TronGrid API because MetaMask cannot sign for Tron and its addresses are a different format.
3. **Route helper**: for the network with the largest balance, show a link or in-app flow to the chosen bridge, the expected time and the risk of that route.
4. **Payout preference (Option D) for sellers**, stored in the order, but the contract always credits the seller on Orbinum first. Bridging out is a separate step that can be retried, so a bridge outage never strands the ORB sale.
5. **Option B later**, when a supported intent protocol reaches Orbinum.
6. **Contract change**: orders carry a quote token from a whitelist (USDT, USDC) instead of a single `quote`. Fees stay in the order's quote token.

## Risk notes

- The bridge is the largest new risk. Do not hold user funds in bridge contracts, show the route being used, and let users choose "I already have it on Orbinum".
- Bridged and native versions of a stablecoin can differ. Whitelist exact contract addresses only.
- Cross-chain payouts and funding do not change the compliance position: the operator screening, blocklist and disclosure tooling in `docs/COMPLIANCE.md` still apply, and bridging adds a further hop to monitor.
- Any bridge integration needs its own security review before mainnet.
