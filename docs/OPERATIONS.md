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
```

See `docs/COMPLIANCE.md` for what these controls are for and their limits.

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
