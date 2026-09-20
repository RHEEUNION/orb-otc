import { ethers } from "hardhat";
import deployment from "../web/src/deployment.json";

// Posts a few sample orders so a fresh demo order book is not empty.
async function main() {
  const usd = await ethers.getContractAt("MockUSD", deployment.quote);
  const otc = await ethers.getContractAt("OrbOTC", deployment.otc);
  const [me] = await ethers.getSigners();
  if ((await usd.allowance(me.address, deployment.otc)) < ethers.parseUnits("1000", 6)) {
    await (await usd.approve(deployment.otc, ethers.MaxUint256)).wait();
  }

  const sells: [string, string][] = [["1.20", "0.30"], ["1.35", "0.50"], ["1.50", "0.25"], ["1.80", "0.40"]];
  const buys: [string, string][] = [["1.10", "0.30"], ["1.00", "0.50"], ["0.85", "0.40"]];

  for (const [p, a] of sells) {
    await (await otc.createSellOrder(ethers.parseUnits(p, 6), { value: ethers.parseEther(a) })).wait();
    console.log("sell", a, "ORB @", p);
  }
  for (const [p, a] of buys) {
    await (await otc.createBuyOrder(ethers.parseUnits(p, 6), ethers.parseEther(a))).wait();
    console.log("buy", a, "ORB @", p);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
