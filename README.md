# ORB OTC (Orbinum Testnet)

Peer-to-peer OTC order book for ORB on the [Orbinum](https://github.com/orbinum) testnet, in the style of Bittensor.Exchange's TAO OTC. **Testnet only.**

- Escrow contract (`contracts/OrbOTC.sol`): native ORB <-> tUSD (test ERC-20), partial fills, cancel, no fees, no admin.
- Web app (`web/`): Vite + React + viem. Reads the order book straight from the chain. No backend.
- Network: Orbinum Testnet, chain ID 2700, RPC `https://rpc-1.testnet.orbinum.io` ([docs](https://docs.orbinum.network/build/get-started)).

## Run

```bash
npm install
npm test                       # contract tests (local Hardhat network)

# deploy to testnet (needs testnet ORB for gas: https://faucet.orbinum.network/)
cp .env.example .env           # set DEPLOYER_KEY (testnet-only key!)
npm run deploy:testnet         # writes web/src/deployment.json

cd web && npm install && npm run dev
```

## Roadmap

- Shielded settlement via Orbinum shielded pools (`@orbinum/protocol`, proof-generator)
- Order history / trade tape from events
- Mainnet build after an audit
