import { expect } from "chai";
import { ethers, network } from "hardhat";

const ORB = (n: string) => ethers.parseEther(n);
const USD = (n: string) => ethers.parseUnits(n, 6);
const POOL = "0x0000000000000000000000000000000000000801";
const commitment = ethers.hexlify(ethers.randomBytes(32));
const memo = ethers.hexlify(ethers.randomBytes(180));

// maker 0.10%, taker 0.20%
const MAKER_BPS = 10;
const TAKER_BPS = 20;

async function setup() {
  const [admin, maker, taker, treasury, other] = await ethers.getSigners();
  const usd = await ethers.deployContract("MockUSD");
  const otc = await ethers.deployContract("OrbOTCV2", [await usd.getAddress(), treasury.address, MAKER_BPS, TAKER_BPS]);
  const mock = await ethers.deployContract("MockShieldedPool");
  await network.provider.send("hardhat_setCode", [POOL, await ethers.provider.getCode(await mock.getAddress())]);
  await (await ethers.getContractAt("MockShieldedPool", POOL)).setFailNext(false); // storage at POOL survives setCode
  for (const s of [maker, taker, other]) {
    await usd.connect(s).faucet();
    await usd.connect(s).approve(await otc.getAddress(), ethers.MaxUint256);
  }
  const otcAddr = await otc.getAddress();
  // everything the contract holds in quote must be open buy escrow + accrued fees
  const checkSolvent = async () => {
    const n = await otc.nextOrderId();
    let owed = await otc.accruedFees();
    for (let i = 0n; i < n; i++) {
      const o = await otc.orders(i);
      if (o.open && !o.isSell) owed += o.remainingQuote + o.remainingFee;
    }
    expect(await usd.balanceOf(otcAddr)).to.equal(owed);
  };
  return { admin, maker, taker, treasury, other, usd, otc, checkSolvent };
}

describe("OrbOTCV2 fees", () => {
  it("sell order: taker pays price + taker fee, maker gets price - maker fee", async () => {
    const { maker, taker, usd, otc, checkSolvent } = await setup();
    // 10 ORB @ 2 = 20 tUSD. maker fee 0.02, taker fee 0.04
    await otc.connect(maker).createSellOrder(USD("2"), { value: ORB("10") });
    const makerBefore = await usd.balanceOf(maker.address);
    const takerBefore = await usd.balanceOf(taker.address);
    await expect(otc.connect(taker).fillSellOrder(0, ORB("10")))
      .to.emit(otc, "FeeCharged").withArgs(0, USD("0.02"), USD("0.04"));
    expect(takerBefore - (await usd.balanceOf(taker.address))).to.equal(USD("20.04"));
    expect((await usd.balanceOf(maker.address)) - makerBefore).to.equal(USD("19.98"));
    expect(await otc.accruedFees()).to.equal(USD("0.06"));
    await checkSolvent();
  });

  it("buy order: maker escrows price + maker fee, taker receives price - taker fee (partial then last fill)", async () => {
    const { maker, taker, usd, otc, checkSolvent } = await setup();
    // 10 ORB @ 3 = 30 tUSD, maker fee 0.03 -> escrow 30.03
    const before = await usd.balanceOf(maker.address);
    await otc.connect(maker).createBuyOrder(USD("3"), ORB("10"));
    expect(before - (await usd.balanceOf(maker.address))).to.equal(USD("30.03"));
    await checkSolvent();

    const takerBefore = await usd.balanceOf(taker.address);
    await otc.connect(taker).fillBuyOrder(0, { value: ORB("4") }); // 12 tUSD, maker fee 0.012, taker fee 0.024
    expect((await usd.balanceOf(taker.address)) - takerBefore).to.equal(USD("11.976"));
    await checkSolvent();
    await otc.connect(taker).fillBuyOrder(0, { value: ORB("6") }); // last fill releases the exact remainder
    expect((await otc.orders(0)).open).to.equal(false);
    expect((await otc.orders(0)).remainingFee).to.equal(0n);
    expect(await otc.accruedFees()).to.equal(USD("0.03") + USD("0.06")); // 0.03 maker + 0.06 taker
    await checkSolvent();
  });

  it("cancelling a buy order refunds the unused maker fee too", async () => {
    const { maker, taker, usd, otc, checkSolvent } = await setup();
    const start = await usd.balanceOf(maker.address);
    await otc.connect(maker).createBuyOrder(USD("3"), ORB("10"));
    await otc.connect(taker).fillBuyOrder(0, { value: ORB("4") });
    await otc.connect(maker).cancelOrder(0);
    // maker paid for 4 ORB: 12 + 0.012 fee, the rest (18 + 0.018) came back
    expect(start - (await usd.balanceOf(maker.address))).to.equal(USD("12.012"));
    await checkSolvent();
  });

  it("maker fee is locked at order creation, taker fee follows the current rate", async () => {
    const { admin, maker, taker, usd, otc } = await setup();
    await otc.connect(maker).createSellOrder(USD("2"), { value: ORB("10") }); // locks 10 bps
    await otc.connect(admin).setFees(50, 100); // maker 0.5%, taker 1%
    const makerBefore = await usd.balanceOf(maker.address);
    const takerBefore = await usd.balanceOf(taker.address);
    await otc.connect(taker).fillSellOrder(0, ORB("10"));
    expect((await usd.balanceOf(maker.address)) - makerBefore).to.equal(USD("19.98")); // still 0.10%
    expect(takerBefore - (await usd.balanceOf(taker.address))).to.equal(USD("20.20")); // now 1%
  });

  it("private fill charges the same fees", async () => {
    const { maker, taker, usd, otc, checkSolvent } = await setup();
    await otc.connect(maker).createSellOrder(USD("2"), { value: ORB("10") });
    const takerBefore = await usd.balanceOf(taker.address);
    await otc.connect(taker).fillSellOrderPrivate(0, ORB("10"), commitment, memo);
    expect(takerBefore - (await usd.balanceOf(taker.address))).to.equal(USD("20.04"));
    expect(await otc.accruedFees()).to.equal(USD("0.06"));
    await checkSolvent();
  });

  it("claimFees sends everything accrued to the recipient, callable by anyone", async () => {
    const { maker, taker, other, treasury, usd, otc, checkSolvent } = await setup();
    await otc.connect(maker).createSellOrder(USD("2"), { value: ORB("10") });
    await otc.connect(taker).fillSellOrder(0, ORB("10"));
    const before = await usd.balanceOf(treasury.address);
    await expect(otc.connect(other).claimFees()).to.emit(otc, "FeesClaimed").withArgs(treasury.address, USD("0.06"));
    expect((await usd.balanceOf(treasury.address)) - before).to.equal(USD("0.06"));
    expect(await otc.accruedFees()).to.equal(0n);
    await expect(otc.connect(other).claimFees()).to.be.revertedWith("nothing to claim");
    await checkSolvent();
  });

  it("fees cannot exceed the 1% cap and only the owner can change fee settings", async () => {
    const { admin, taker, other, otc } = await setup();
    await expect(otc.connect(admin).setFees(101, 0)).to.be.revertedWith("fee too high");
    await expect(otc.connect(admin).setFees(0, 101)).to.be.revertedWith("fee too high");
    await otc.connect(admin).setFees(100, 100);
    await expect(otc.connect(taker).setFees(1, 1)).to.be.revertedWith("not owner");
    await expect(otc.connect(taker).setFeeRecipient(taker.address)).to.be.revertedWith("not owner");
    await otc.connect(admin).setFeeRecipient(other.address);
    expect(await otc.feeRecipient()).to.equal(other.address);
  });

  it("constructor rejects fees above the cap", async () => {
    const usd = await ethers.deployContract("MockUSD");
    await expect(ethers.deployContract("OrbOTCV2", [await usd.getAddress(), ethers.ZeroAddress, 101, 0])).to.be.revertedWith("fee too high");
  });

  it("no recipient means no fees on new orders and fills", async () => {
    const { admin, maker, taker, usd, otc } = await setup();
    await otc.connect(admin).setFeeRecipient(ethers.ZeroAddress);
    await otc.connect(maker).createSellOrder(USD("2"), { value: ORB("10") });
    const takerBefore = await usd.balanceOf(taker.address);
    await otc.connect(taker).fillSellOrder(0, ORB("10"));
    expect(takerBefore - (await usd.balanceOf(taker.address))).to.equal(USD("20"));
    expect(await otc.accruedFees()).to.equal(0n);
  });

  it("fees do not block cancel while paused and never touch the maker's escrow on cancel of a sell order", async () => {
    const { admin, maker, otc } = await setup();
    await otc.connect(maker).createSellOrder(USD("2"), { value: ORB("5") });
    await otc.connect(admin).pause();
    const before = await ethers.provider.getBalance(maker.address);
    const tx = await otc.connect(maker).cancelOrder(0);
    const r = await tx.wait();
    expect(await ethers.provider.getBalance(maker.address)).to.equal(before + ORB("5") - r!.gasUsed * r!.gasPrice);
  });
});
