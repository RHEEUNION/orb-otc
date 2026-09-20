import { expect } from "chai";
import { ethers, network } from "hardhat";

const ORB = (n: string) => ethers.parseEther(n);
const USD = (n: string) => ethers.parseUnits(n, 6);
const POOL = "0x0000000000000000000000000000000000000801";
const commitment = ethers.hexlify(ethers.randomBytes(32));
const memo = ethers.hexlify(ethers.randomBytes(180));

/** Fresh contracts. Fees are configurable per test (default off) and tUSD is the only whitelisted token. */
async function setup(fees?: { recipient: string; maker: number; taker: number }) {
  const [admin, maker, taker, treasury, other] = await ethers.getSigners();
  const usd = await ethers.deployContract("MockUSD");
  const q = await usd.getAddress();
  const otc = await ethers.deployContract("OrbOTCV2", [
    [q],
    fees ? fees.recipient : ethers.ZeroAddress,
    fees ? fees.maker : 0,
    fees ? fees.taker : 0,
  ]);

  const mock = await ethers.deployContract("MockShieldedPool");
  await network.provider.send("hardhat_setCode", [POOL, await ethers.provider.getCode(await mock.getAddress())]);
  const pool = await ethers.getContractAt("MockShieldedPool", POOL);
  await pool.setFailNext(false); // storage at POOL survives setCode

  for (const s of [maker, taker, other]) {
    await usd.connect(s).faucet();
    await usd.connect(s).approve(await otc.getAddress(), ethers.MaxUint256);
  }
  // Everything the contract holds in a token must be open buy escrow plus accrued fees in that token.
  const checkSolvent = async (token: { getAddress(): Promise<string>; balanceOf(a: string): Promise<bigint> } = usd) => {
    const addr = await token.getAddress();
    const n = await otc.nextOrderId();
    let owed = await otc.accruedFees(addr);
    for (let i = 0n; i < n; i++) {
      const o = await otc.orders(i);
      if (o.open && !o.isSell && o.quote === addr) owed += o.remainingQuote + o.remainingFee;
    }
    expect(await token.balanceOf(await otc.getAddress())).to.equal(owed);
  };
  return { admin, maker, taker, treasury, other, usd, q, otc, pool, checkSolvent };
}

describe("OrbOTCV2", () => {
  describe("public trading", () => {
    it("sell order partial then full fill", async () => {
      const { maker, taker, usd, q, otc } = await setup();
      await otc.connect(maker).createSellOrder(q, USD("2.5"), { value: ORB("10") });
      await otc.connect(taker).fillSellOrder(0, ORB("4"));
      expect(await usd.balanceOf(maker.address)).to.equal(USD("10000") + USD("10"));
      await otc.connect(taker).fillSellOrder(0, ORB("6"));
      expect((await otc.orders(0)).open).to.equal(false);
    });

    it("buy order filled by taker", async () => {
      const { maker, taker, usd, q, otc } = await setup();
      await otc.connect(maker).createBuyOrder(q, USD("3"), ORB("5"));
      const before = await usd.balanceOf(taker.address);
      await otc.connect(taker).fillBuyOrder(0, { value: ORB("5") });
      expect(await usd.balanceOf(taker.address)).to.equal(before + USD("15"));
      expect((await otc.orders(0)).open).to.equal(false);
    });

    it("cancel refunds escrow, only maker", async () => {
      const { maker, taker, usd, q, otc } = await setup();
      await otc.connect(maker).createSellOrder(q, USD("1"), { value: ORB("1") });
      await otc.connect(maker).createBuyOrder(q, USD("1"), ORB("7"));
      await expect(otc.connect(taker).cancelOrder(0)).to.be.revertedWith("not cancellable");
      await otc.connect(maker).cancelOrder(0);
      await otc.connect(maker).cancelOrder(1);
      expect(await usd.balanceOf(maker.address)).to.equal(USD("10000"));
      expect(await ethers.provider.getBalance(await otc.getAddress())).to.equal(0);
      await expect(otc.connect(taker).fillSellOrder(0, 1)).to.be.revertedWith("not fillable");
    });

    it("getOrders pages", async () => {
      const { maker, q, otc } = await setup();
      for (let i = 0; i < 3; i++) await otc.connect(maker).createSellOrder(q, USD("1"), { value: ORB("1") });
      const [ids] = await otc.getOrders(1, 10);
      expect(ids.length).to.equal(2);
    });
  });

  describe("private receive", () => {
    it("pays the ORB into the shielded pool instead of the taker", async () => {
      const { maker, taker, usd, q, otc, pool } = await setup();
      await otc.connect(maker).createSellOrder(q, USD("2"), { value: ORB("3") });
      const takerBefore = await ethers.provider.getBalance(taker.address);
      const tx = await otc.connect(taker).fillSellOrderPrivate(0, ORB("1"), commitment, memo);
      const r = await tx.wait();
      expect(await pool.count()).to.equal(1n);
      expect(await pool.lastValue()).to.equal(ORB("1"));
      expect(await pool.lastAssetId()).to.equal(0n);
      expect(await pool.lastCommitment()).to.equal(commitment);
      expect(await pool.lastMemo()).to.equal(memo);
      expect(await ethers.provider.getBalance(taker.address)).to.equal(takerBefore - r!.gasUsed * r!.gasPrice);
      expect(await usd.balanceOf(maker.address)).to.equal(USD("10000") + USD("2"));
      await expect(tx).to.emit(otc, "OrderFilled").withArgs(0, taker.address, ORB("1"), USD("2"), true);
    });

    it("reverts the whole fill if the shield call fails", async () => {
      const { maker, taker, usd, q, otc, pool } = await setup();
      await otc.connect(maker).createSellOrder(q, USD("2"), { value: ORB("3") });
      await pool.setFailNext(true);
      const before = await usd.balanceOf(taker.address);
      await expect(otc.connect(taker).fillSellOrderPrivate(0, ORB("1"), commitment, memo)).to.be.revertedWith("mock: shield rejected");
      expect(await usd.balanceOf(taker.address)).to.equal(before);
      expect((await otc.orders(0)).remainingOrb).to.equal(ORB("3"));
    });

    it("rejects a memo that is not 180 bytes", async () => {
      const { maker, taker, q, otc } = await setup();
      await otc.connect(maker).createSellOrder(q, USD("2"), { value: ORB("3") });
      await expect(otc.connect(taker).fillSellOrderPrivate(0, ORB("1"), commitment, "0x1234")).to.be.revertedWith("bad memo size");
    });
  });

  describe("pause and blocklist", () => {
    it("paused blocks new trading but never cancel; only the owner can pause", async () => {
      const { admin, maker, taker, q, otc } = await setup();
      await otc.connect(maker).createSellOrder(q, USD("1"), { value: ORB("1") });
      await expect(otc.connect(taker).pause()).to.be.revertedWith("not owner");
      await otc.connect(admin).pause();
      await expect(otc.connect(maker).createSellOrder(q, USD("1"), { value: ORB("1") })).to.be.revertedWith("paused");
      await expect(otc.connect(taker).fillSellOrder(0, ORB("1"))).to.be.revertedWith("paused");
      await expect(otc.connect(taker).fillSellOrderPrivate(0, ORB("1"), commitment, memo)).to.be.revertedWith("paused");
      await otc.connect(maker).cancelOrder(0);
      await otc.connect(admin).unpause();
      await otc.connect(maker).createSellOrder(q, USD("1"), { value: ORB("1") });
    });

    it("blocklist adds and removes in batch with events; only owner", async () => {
      const { admin, taker, other, otc } = await setup();
      await expect(otc.connect(taker).setBlocked([taker.address], true)).to.be.revertedWith("not owner");
      await expect(otc.connect(admin).setBlocked([taker.address, other.address], true))
        .to.emit(otc, "BlockedSet").withArgs(taker.address, true, admin.address);
      await otc.connect(admin).setBlocked([taker.address], false);
      expect(await otc.blocked(taker.address)).to.equal(false);
      expect(await otc.blocked(other.address)).to.equal(true);
    });

    it("a blocked address cannot create or fill but can cancel; a blocked maker's order cannot be filled", async () => {
      const { admin, maker, taker, q, otc } = await setup();
      await otc.connect(maker).createSellOrder(q, USD("1"), { value: ORB("2") });
      await otc.connect(admin).setBlocked([maker.address, taker.address], true);
      await expect(otc.connect(maker).createSellOrder(q, USD("1"), { value: ORB("1") })).to.be.revertedWith("blocked");
      await expect(otc.connect(taker).fillSellOrder(0, ORB("1"))).to.be.revertedWith("blocked");
      await otc.connect(admin).setBlocked([taker.address], false);
      await expect(otc.connect(taker).fillSellOrder(0, ORB("1"))).to.be.revertedWith("maker blocked");
      const before = await ethers.provider.getBalance(maker.address);
      const r = await (await otc.connect(maker).cancelOrder(0)).wait();
      expect(await ethers.provider.getBalance(maker.address)).to.equal(before + ORB("2") - r!.gasUsed * r!.gasPrice);
    });

    it("ownership can move to another address", async () => {
      const { admin, other, otc } = await setup();
      await otc.connect(admin).transferOwnership(other.address);
      await expect(otc.connect(admin).pause()).to.be.revertedWith("not owner");
      await otc.connect(other).pause();
      await expect(otc.connect(other).transferOwnership(ethers.ZeroAddress)).to.be.revertedWith("zero owner");
    });
  });

  describe("fees (maker 0.10%, taker 0.20%)", () => {
    const fees = (recipient: string) => ({ recipient, maker: 10, taker: 20 });

    it("sell order: taker pays price + fee, maker gets price - fee", async () => {
      const [, , , treasury] = await ethers.getSigners();
      const { maker, taker, usd, q, otc, checkSolvent } = await setup(fees(treasury.address));
      await otc.connect(maker).createSellOrder(q, USD("2"), { value: ORB("10") });
      const makerBefore = await usd.balanceOf(maker.address);
      const takerBefore = await usd.balanceOf(taker.address);
      await expect(otc.connect(taker).fillSellOrder(0, ORB("10")))
        .to.emit(otc, "FeeCharged").withArgs(0, q, USD("0.02"), USD("0.04"));
      expect(takerBefore - (await usd.balanceOf(taker.address))).to.equal(USD("20.04"));
      expect((await usd.balanceOf(maker.address)) - makerBefore).to.equal(USD("19.98"));
      expect(await otc.accruedFees(q)).to.equal(USD("0.06"));
      await checkSolvent();
    });

    it("buy order: maker escrows price + fee, taker receives price - fee, exact over partial fills", async () => {
      const [, , , treasury] = await ethers.getSigners();
      const { maker, taker, usd, q, otc, checkSolvent } = await setup(fees(treasury.address));
      const before = await usd.balanceOf(maker.address);
      await otc.connect(maker).createBuyOrder(q, USD("3"), ORB("10"));
      expect(before - (await usd.balanceOf(maker.address))).to.equal(USD("30.03"));
      const takerBefore = await usd.balanceOf(taker.address);
      await otc.connect(taker).fillBuyOrder(0, { value: ORB("4") });
      expect((await usd.balanceOf(taker.address)) - takerBefore).to.equal(USD("11.976"));
      await checkSolvent();
      await otc.connect(taker).fillBuyOrder(0, { value: ORB("6") });
      expect((await otc.orders(0)).remainingFee).to.equal(0n);
      expect(await otc.accruedFees(q)).to.equal(USD("0.09"));
      await checkSolvent();
    });

    it("cancelling a buy order refunds the unused maker fee", async () => {
      const [, , , treasury] = await ethers.getSigners();
      const { maker, taker, usd, q, otc, checkSolvent } = await setup(fees(treasury.address));
      const start = await usd.balanceOf(maker.address);
      await otc.connect(maker).createBuyOrder(q, USD("3"), ORB("10"));
      await otc.connect(taker).fillBuyOrder(0, { value: ORB("4") });
      await otc.connect(maker).cancelOrder(0);
      expect(start - (await usd.balanceOf(maker.address))).to.equal(USD("12.012"));
      await checkSolvent();
    });

    it("maker fee is locked at creation; taker fee follows the current rate", async () => {
      const [, , , treasury] = await ethers.getSigners();
      const { admin, maker, taker, usd, q, otc } = await setup(fees(treasury.address));
      await otc.connect(maker).createSellOrder(q, USD("2"), { value: ORB("10") });
      await otc.connect(admin).setFees(50, 100);
      const makerBefore = await usd.balanceOf(maker.address);
      const takerBefore = await usd.balanceOf(taker.address);
      await otc.connect(taker).fillSellOrder(0, ORB("10"));
      expect((await usd.balanceOf(maker.address)) - makerBefore).to.equal(USD("19.98"));
      expect(takerBefore - (await usd.balanceOf(taker.address))).to.equal(USD("20.20"));
    });

    it("private fill charges the same fees; claimFees pays the recipient, callable by anyone", async () => {
      const [, , , treasury] = await ethers.getSigners();
      const { maker, taker, other, usd, q, otc, checkSolvent } = await setup(fees(treasury.address));
      await otc.connect(maker).createSellOrder(q, USD("2"), { value: ORB("10") });
      await otc.connect(taker).fillSellOrderPrivate(0, ORB("10"), commitment, memo);
      expect(await otc.accruedFees(q)).to.equal(USD("0.06"));
      const before = await usd.balanceOf(treasury.address);
      await expect(otc.connect(other).claimFees(q)).to.emit(otc, "FeesClaimed").withArgs(q, treasury.address, USD("0.06"));
      expect((await usd.balanceOf(treasury.address)) - before).to.equal(USD("0.06"));
      await expect(otc.connect(other).claimFees(q)).to.be.revertedWith("nothing to claim");
      await checkSolvent();
    });

    it("caps at 1%, owner only, and no recipient means no fees", async () => {
      const [, , , treasury] = await ethers.getSigners();
      const { admin, maker, taker, usd, q, otc } = await setup(fees(treasury.address));
      await expect(otc.connect(admin).setFees(101, 0)).to.be.revertedWith("fee too high");
      await expect(otc.connect(taker).setFees(1, 1)).to.be.revertedWith("not owner");
      await expect(otc.connect(taker).setFeeRecipient(taker.address)).to.be.revertedWith("not owner");
      await otc.connect(admin).setFeeRecipient(ethers.ZeroAddress);
      await otc.connect(maker).createSellOrder(q, USD("2"), { value: ORB("10") });
      const takerBefore = await usd.balanceOf(taker.address);
      await otc.connect(taker).fillSellOrder(0, ORB("10"));
      expect(takerBefore - (await usd.balanceOf(taker.address))).to.equal(USD("20"));
      const usd2 = await ethers.deployContract("MockUSD");
      await expect(ethers.deployContract("OrbOTCV2", [[await usd2.getAddress()], ethers.ZeroAddress, 101, 0])).to.be.revertedWith("fee too high");
    });
  });

  describe("multiple quote tokens", () => {
    it("only whitelisted tokens are accepted, the owner manages the list, and the list is enumerable", async () => {
      const { admin, maker, taker, q, otc } = await setup();
      const usdt = await ethers.deployContract("MockToken", [6, false, 0]);
      const t = await usdt.getAddress();
      await expect(otc.connect(maker).createSellOrder(t, USD("1"), { value: ORB("1") })).to.be.revertedWith("quote not allowed");
      await expect(otc.connect(taker).setQuoteToken(t, true)).to.be.revertedWith("not owner");
      await expect(otc.connect(admin).setQuoteToken(taker.address, true)).to.be.revertedWith("not a contract");
      await expect(otc.connect(admin).setQuoteToken(t, true)).to.emit(otc, "QuoteTokenSet").withArgs(t, true);
      await otc.connect(maker).createSellOrder(t, USD("1"), { value: ORB("1") });
      const [tokens, enabled] = await otc.getQuoteTokens();
      expect([...tokens]).to.deep.equal([q, t]);
      expect([...enabled]).to.deep.equal([true, true]);
    });

    it("disabling a token blocks new orders but existing ones can still be filled and cancelled", async () => {
      const { admin, maker, taker, q, otc, usd } = await setup();
      await otc.connect(maker).createSellOrder(q, USD("1"), { value: ORB("2") });
      await otc.connect(maker).createBuyOrder(q, USD("1"), ORB("3"));
      await otc.connect(admin).setQuoteToken(q, false);
      await expect(otc.connect(maker).createSellOrder(q, USD("1"), { value: ORB("1") })).to.be.revertedWith("quote not allowed");
      await otc.connect(taker).fillSellOrder(0, ORB("1"));
      const before = await usd.balanceOf(maker.address);
      await otc.connect(maker).cancelOrder(1);
      expect((await usd.balanceOf(maker.address)) - before).to.equal(USD("3"));
      const [, enabled] = await otc.getQuoteTokens();
      expect([...enabled]).to.deep.equal([false]);
    });

    it("an 18-decimal token (BSC style): price is decimal-agnostic and fees accrue and are claimed per token", async () => {
      const [, , , treasury] = await ethers.getSigners();
      const { admin, maker, taker, q, otc, checkSolvent } = await setup({ recipient: treasury.address, maker: 10, taker: 20 });
      const bsc = await ethers.deployContract("MockToken", [18, true, 0]);
      const t = await bsc.getAddress();
      await otc.connect(admin).setQuoteToken(t, true);
      for (const s of [maker, taker]) {
        await bsc.mint(s.address, ethers.parseUnits("1000", 18));
        await bsc.connect(s).approve(await otc.getAddress(), ethers.MaxUint256);
      }
      await otc.connect(maker).createSellOrder(t, ethers.parseUnits("2", 18), { value: ORB("10") });
      await otc.connect(taker).fillSellOrder(0, ORB("10"));
      expect(await otc.accruedFees(t)).to.equal(ethers.parseUnits("0.06", 18));
      expect(await otc.accruedFees(q)).to.equal(0n);
      await checkSolvent(bsc);
      await otc.claimFees(t);
      expect(await bsc.balanceOf(treasury.address)).to.equal(ethers.parseUnits("0.06", 18));
    });

    it("works with a USDT-style token that returns nothing from transfer", async () => {
      const { admin, maker, taker, otc } = await setup();
      const usdt = await ethers.deployContract("MockToken", [6, false, 0]);
      const t = await usdt.getAddress();
      await otc.connect(admin).setQuoteToken(t, true);
      for (const s of [maker, taker]) {
        await usdt.mint(s.address, USD("1000"));
        await usdt.connect(s).approve(await otc.getAddress(), ethers.MaxUint256);
      }
      await otc.connect(maker).createSellOrder(t, USD("2"), { value: ORB("5") });
      await otc.connect(taker).fillSellOrder(0, ORB("5"));
      expect(await usdt.balanceOf(maker.address)).to.equal(USD("1000") + USD("10"));
      await otc.connect(maker).createBuyOrder(t, USD("1"), ORB("4"));
      await otc.connect(maker).cancelOrder(1);
      expect(await usdt.balanceOf(maker.address)).to.equal(USD("1010"));
    });

    it("rejects a fee-on-transfer token instead of losing accounting", async () => {
      const { admin, maker, otc } = await setup();
      const fot = await ethers.deployContract("MockToken", [6, true, 100]);
      const t = await fot.getAddress();
      await otc.connect(admin).setQuoteToken(t, true);
      await fot.mint(maker.address, USD("1000"));
      await fot.connect(maker).approve(await otc.getAddress(), ethers.MaxUint256);
      await expect(otc.connect(maker).createBuyOrder(t, USD("2"), ORB("5"))).to.be.revertedWith("unsupported token");
    });

    it("constructor needs at least one contract token", async () => {
      await expect(ethers.deployContract("OrbOTCV2", [[], ethers.ZeroAddress, 0, 0])).to.be.revertedWith("no quote token");
    });
  });
});
