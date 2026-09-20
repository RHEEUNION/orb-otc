import { expect } from "chai";
import { ethers } from "hardhat";

const ORB = (n: string) => ethers.parseEther(n);
const USD = (n: string) => ethers.parseUnits(n, 6);

async function setup() {
  const [maker, taker] = await ethers.getSigners();
  const usd = await ethers.deployContract("MockUSD");
  const otc = await ethers.deployContract("OrbOTC", [await usd.getAddress()]);
  for (const s of [maker, taker]) {
    await usd.connect(s).faucet();
    await usd.connect(s).approve(await otc.getAddress(), ethers.MaxUint256);
  }
  return { maker, taker, usd, otc };
}

describe("OrbOTC", () => {
  it("sell order: partial fill then full fill", async () => {
    const { maker, taker, usd, otc } = await setup();
    await otc.connect(maker).createSellOrder(USD("2.5"), { value: ORB("10") });
    await otc.connect(taker).fillSellOrder(0, ORB("4"));
    expect(await usd.balanceOf(maker.address)).to.equal(USD("10000") + USD("10"));
    let o = await otc.orders(0);
    expect(o.remainingOrb).to.equal(ORB("6"));
    expect(o.open).to.equal(true);
    await otc.connect(taker).fillSellOrder(0, ORB("6"));
    o = await otc.orders(0);
    expect(o.open).to.equal(false);
  });

  it("buy order: taker sells ORB into it, maker receives ORB", async () => {
    const { maker, taker, usd, otc } = await setup();
    await otc.connect(maker).createBuyOrder(USD("3"), ORB("5"));
    expect(await usd.balanceOf(maker.address)).to.equal(USD("10000") - USD("15"));
    const before = await usd.balanceOf(taker.address);
    await otc.connect(taker).fillBuyOrder(0, { value: ORB("2") });
    expect(await usd.balanceOf(taker.address)).to.equal(before + USD("6"));
    await otc.connect(taker).fillBuyOrder(0, { value: ORB("3") });
    expect((await otc.orders(0)).open).to.equal(false);
    expect(await ethers.provider.getBalance(await otc.getAddress())).to.equal(0);
  });

  it("cancel refunds escrow, only maker", async () => {
    const { maker, taker, usd, otc } = await setup();
    await otc.connect(maker).createSellOrder(USD("1"), { value: ORB("1") });
    await otc.connect(maker).createBuyOrder(USD("1"), ORB("7"));
    await expect(otc.connect(taker).cancelOrder(0)).to.be.revertedWith("not cancellable");
    await otc.connect(maker).cancelOrder(0);
    await otc.connect(maker).cancelOrder(1);
    expect(await usd.balanceOf(maker.address)).to.equal(USD("10000"));
    expect(await ethers.provider.getBalance(await otc.getAddress())).to.equal(0);
    await expect(otc.connect(taker).fillSellOrder(0, 1)).to.be.revertedWith("not fillable");
  });

  it("getOrders pages", async () => {
    const { maker, otc } = await setup();
    for (let i = 0; i < 3; i++) await otc.connect(maker).createSellOrder(USD("1"), { value: ORB("1") });
    const [ids] = await otc.getOrders(1, 10);
    expect(ids.length).to.equal(2);
  });
});
