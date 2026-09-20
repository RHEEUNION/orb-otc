import { ethers } from "hardhat";
import { readFileSync, writeFileSync } from "fs";

// Deploys OrbOTCV2 and records it as `otcV2` in web/src/deployment.json (v1 `otc` is left untouched).
//
// Quote tokens: testnet uses the test token already deployed (`quote` in deployment.json). For mainnet set
// QUOTE_TOKENS to the exact USDT and USDC contract addresses on Orbinum (comma separated). More can be added
// later with `node scripts/admin.mjs add-quote <address>`.
//
// Fees are charged in the quote token. A privacy address cannot receive an ERC-20, so the recipient is an EVM address.
const FEE_RECIPIENT = process.env.FEE_RECIPIENT ?? "0x3937B5F83f8e3DB413bD202bAf4da5A64879690F";
const MAKER_FEE_BPS = Number(process.env.MAKER_FEE_BPS ?? 10); // 0.10%
const TAKER_FEE_BPS = Number(process.env.TAKER_FEE_BPS ?? 20); // 0.20%

async function main() {
  const path = "web/src/deployment.json";
  const dep = JSON.parse(readFileSync(path, "utf8"));
  const quoteTokens = process.env.QUOTE_TOKENS ? process.env.QUOTE_TOKENS.split(",").map((s) => s.trim()) : [dep.quote];
  const otc = await ethers.deployContract("OrbOTCV2", [quoteTokens, FEE_RECIPIENT, MAKER_FEE_BPS, TAKER_FEE_BPS]);
  await otc.waitForDeployment();
  const [deployer] = await ethers.getSigners();
  dep.otcV2 = await otc.getAddress();
  dep.admin = deployer.address;
  dep.feeRecipient = FEE_RECIPIENT;
  console.log({ otcV2: dep.otcV2, admin: dep.admin, quoteTokens, feeRecipient: FEE_RECIPIENT, makerBps: MAKER_FEE_BPS, takerBps: TAKER_FEE_BPS });
  writeFileSync(path, JSON.stringify(dep, null, 2) + "\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
