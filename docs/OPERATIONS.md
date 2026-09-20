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
