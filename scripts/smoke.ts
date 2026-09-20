import { ethers } from "hardhat";
import deployment from "../web/src/deployment.json";

// End-to-end check against the deployed contracts (uses the deployer wallet as both maker and taker).
async function main() {
  const [me] = await ethers.getSigners();
  const usd = await ethers.getContractAt("MockUSD", deployment.quote);
  const otc = await ethers.getContractAt("OrbOTC", deployment.otc);
  const step = async (label: string, p: Promise<any>) => {
    const tx = await p;
    await tx.wait();
    console.log("ok:", label);
  };
  const price = ethers.parseUnits("2", 6);

  await step("faucet", usd.faucet());
  await step("approve", usd.approve(deployment.otc, ethers.MaxUint256));

  const id0 = await otc.nextOrderId();
  await step("createSellOrder 0.2 ORB @2", otc.createSellOrder(price, { value: ethers.parseEther("0.2") }));
  await step("fillSellOrder 0.05 (partial)", otc.fillSellOrder(id0, ethers.parseEther("0.05")));
  let o = await otc.orders(id0);
  console.log("  remaining:", ethers.formatEther(o.remainingOrb), "open:", o.open);
  await step("cancel sell", otc.cancelOrder(id0));

  const id1 = await otc.nextOrderId();
  await step("createBuyOrder 0.2 ORB @2", otc.createBuyOrder(price, ethers.parseEther("0.2")));
  await step("fillBuyOrder 0.2 (full)", otc.fillBuyOrder(id1, { value: ethers.parseEther("0.2") }));
  o = await otc.orders(id1);
  console.log("  open:", o.open);

  const bal = await ethers.provider.getBalance(deployment.otc);
  console.log("escrow ORB balance:", ethers.formatEther(bal));
  console.log("SMOKE TEST PASSED", me.address);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
