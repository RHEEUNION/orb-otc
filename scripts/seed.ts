import { ethers } from "hardhat";
import deployment from "../web/src/deployment.json";

// Posts a few sample orders so a fresh demo order book is not empty. Uses the test token as the quote.
async function main() {
  const usd = await ethers.getContractAt("MockUSD", deployment.quote);
  const otcAddress = (deployment as { otcV2?: string }).otcV2;
  if (!otcAddress) throw new Error("No otcV2 in web/src/deployment.json");
  const otc = await ethers.getContractAt("OrbOTCV2", otcAddress);
  const [me] = await ethers.getSigners();
  if ((await usd.allowance(me.address, otcAddress)) < ethers.parseUnits("1000", 6)) {
    await (await usd.approve(otcAddress, ethers.MaxUint256)).wait();
  }

  const sells: [string, string][] = [["1.20", "0.06"], ["1.35", "0.10"], ["1.50", "0.05"], ["1.80", "0.08"]];
  const buys: [string, string][] = [["1.10", "0.06"], ["1.00", "0.10"], ["0.85", "0.08"]];

  for (const [p, a] of sells) {
    await (await otc.createSellOrder(deployment.quote, ethers.parseUnits(p, 6), { value: ethers.parseEther(a) })).wait();
    console.log("sell", a, "ORB @", p);
  }
  for (const [p, a] of buys) {
    await (await otc.createBuyOrder(deployment.quote, ethers.parseUnits(p, 6), ethers.parseEther(a))).wait();
    console.log("buy", a, "ORB @", p);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
