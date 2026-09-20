# Operations (internal)

Only the team needs this. Traders just open the site and connect a wallet.

## Layout

```
contracts/   OrbOTC.sol (escrow), MockUSD.sol (tUSD + faucet)
test/        Hardhat tests
scripts/     deploy.ts
web/         Vite + React + viem site (static)
```

## One-time: deploy contracts

Run by an operator, never by users.

1. Fund a **dedicated testnet deployer wallet** with ORB from https://faucet.orbinum.network/.
2. Set its key locally (never commit it):

   ```bash
   cp .env.example .env    # DEPLOYER_KEY=0x...
   npm install
   npm test
   npm run deploy:testnet
   ```

3. The script writes the addresses to `web/src/deployment.json`. **Commit that file.** It is public data baked into the site, which is why end users never touch any config.

Redeploying creates a fresh, empty order book, so only do it when the contract changes.

## Contract v2 (private receive, pause, blocklist)

```bash
npx hardhat run scripts/deploy-v2.ts --network orbinumTestnet   # deploys OrbOTCV2, adds `otcV2` to web/src/deployment.json
# environment variables: FEE_RECIPIENT, MAKER_FEE_BPS (default 10), TAKER_FEE_BPS (default 20),
# QUOTE_TOKENS (comma separated; defaults to the testnet test token)
```

The site uses `otcV2` when present and falls back to `otc` (v1). Deploying v2 does not touch v1.

Operator commands (run with the owner key in `.env`):

```bash
node scripts/admin.mjs status
node scripts/admin.mjs pause            # stop new orders and fills; cancel still works
node scripts/admin.mjs unpause
node scripts/admin.mjs block 0xabc... 0xdef...
node scripts/admin.mjs unblock 0xabc...
node scripts/admin.mjs check 0xabc...
node scripts/admin.mjs transfer-owner 0xMultisig...   # do this before mainnet
node scripts/admin.mjs set-fees 10 20                 # maker and taker in basis points (100 = 1%, cap 100)
node scripts/admin.mjs set-fee-recipient 0xabc...     # 0x000... turns fees off
node scripts/admin.mjs claim-fees <token>             # send accrued fees in that quote token to the recipient
node scripts/admin.mjs quotes                         # list whitelisted quote tokens
node scripts/admin.mjs add-quote 0xToken              # whitelist a quote token (exact contract address only)
node scripts/admin.mjs remove-quote 0xToken           # stop NEW orders in it; existing orders still fill and cancel
```

See `docs/COMPLIANCE.md` for what these controls are for and their limits.

## Turning on mainnet features

Everything prepared for mainnet is off by default.

| Feature | How to enable |
|---|---|
| USDT and USDC as quote tokens | Deploy with `QUOTE_TOKENS=<USDT>,<USDC>`, or call `add-quote` on a live contract. Use the exact contract addresses on Orbinum, never a look-alike. Only standard tokens work: fee-on-transfer and rebasing tokens are rejected, and tokens that return no value (USDT style) are supported |
| Multichain balance scanner | Set `"features": { "multichainScan": true }` in `web/src/deployment.json` and rebuild. Preview on testnet with `?scan=1` in the URL. Networks and token addresses are in `web/src/scanner.ts` |
| Bridging into Orbinum | Not built. Needs Orbinum's mainnet stablecoin route, see `docs/CROSSCHAIN.md` |

Validate the scanner configuration against the live networks any time with `node spike/verify-scanner.mts` (checks every token address, symbol and decimals, then runs a real scan).

## Testnet ORB budget

The Orbinum faucet gives 5 ORB per 24 hours, and every sell order locks its ORB in escrow. Keep demo orders small (0.05 to 0.1 ORB) and cancel unused ones to get the ORB back. `node scripts/cancel-all.mjs <contract>` cancels every open order of the deployer wallet on a contract.

## Build and host the site

The site is fully static and needs no server.

```bash
cd web
npm install
npm run build      # output in web/dist
```

Publish `web/dist` on any static host (Cloudflare Pages, Vercel, Netlify, S3 + CDN). Build command `npm run build`, root directory `web`, output directory `dist`.

## Checklist before announcing

- [ ] Contracts deployed and `web/src/deployment.json` committed
- [ ] Site hosted on the production domain
- [ ] Connect, add-network, faucet, create, partial fill, cancel verified with two wallets
- [ ] Testnet-only banner visible
