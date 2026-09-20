import { ethers } from "hardhat";
import { readFileSync, writeFileSync } from "fs";

// Deploys OrbOTCV2 against the already deployed tUSD and records it as `otcV2` (v1 `otc` is left untouched).
// Fees are charged in the quote token (tUSD here, USDT/USDC on mainnet). A privacy address cannot receive an
// ERC-20, so the fee recipient is an EVM address.
const FEE_RECIPIENT = process.env.FEE_RECIPIENT ?? "0x3937B5F83f8e3DB413bD202bAf4da5A64879690F";
const MAKER_FEE_BPS = Number(process.env.MAKER_FEE_BPS ?? 10); // 0.10%
const TAKER_FEE_BPS = Number(process.env.TAKER_FEE_BPS ?? 20); // 0.20%

async function main() {
  const path = "web/src/deployment.json";
  const dep = JSON.parse(readFileSync(path, "utf8"));
  const otc = await ethers.deployContract("OrbOTCV2", [dep.quote, FEE_RECIPIENT, MAKER_FEE_BPS, TAKER_FEE_BPS]);
  await otc.waitForDeployment();
  const [deployer] = await ethers.getSigners();
  dep.otcV2 = await otc.getAddress();
  dep.admin = deployer.address;
  dep.feeRecipient = FEE_RECIPIENT;
  console.log({ otcV2: dep.otcV2, admin: dep.admin, quote: dep.quote, feeRecipient: FEE_RECIPIENT, makerBps: MAKER_FEE_BPS, takerBps: TAKER_FEE_BPS });
  writeFileSync(path, JSON.stringify(dep, null, 2) + "\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
