import { ethers } from "hardhat";
import { readFileSync, writeFileSync } from "fs";

// Deploys OrbOTCV2 against the already deployed tUSD and records it as `otcV2` (v1 `otc` is left untouched).
async function main() {
  const path = "web/src/deployment.json";
  const dep = JSON.parse(readFileSync(path, "utf8"));
  const otc = await ethers.deployContract("OrbOTCV2", [dep.quote]);
  await otc.waitForDeployment();
  const [deployer] = await ethers.getSigners();
  dep.otcV2 = await otc.getAddress();
  dep.admin = deployer.address;
  console.log({ otcV2: dep.otcV2, admin: dep.admin, quote: dep.quote });
  writeFileSync(path, JSON.stringify(dep, null, 2) + "\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
