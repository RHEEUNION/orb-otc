import { ethers } from "hardhat";
import { writeFileSync } from "fs";

async function main() {
  const usd = await ethers.deployContract("MockUSD");
  await usd.waitForDeployment();
  const otc = await ethers.deployContract("OrbOTC", [await usd.getAddress()]);
  await otc.waitForDeployment();
  const out = { chainId: 2700, quote: await usd.getAddress(), otc: await otc.getAddress() };
  console.log(out);
  writeFileSync("web/src/deployment.json", JSON.stringify(out, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
