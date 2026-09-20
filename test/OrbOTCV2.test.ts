import { expect } from "chai";
import { ethers, network } from "hardhat";

const ORB = (n: string) => ethers.parseEther(n);
const USD = (n: string) => ethers.parseUnits(n, 6);
const POOL = "0x0000000000000000000000000000000000000801";
const commitment = ethers.hexlify(ethers.randomBytes(32));
const memo = ethers.hexlify(ethers.randomBytes(180));

async function setup() {
  const [admin, maker, taker, other] = await ethers.getSigners();
  const usd = await ethers.deployContract("MockUSD");
  const otc = await ethers.deployContract("OrbOTCV2", [await usd.getAddress()]);

  // put a mock shielded pool at the precompile address
  const mock = await ethers.deployContract("MockShieldedPool");
  const code = await ethers.provider.getCode(await mock.getAddress());
  await network.provider.send("hardhat_setCode", [POOL, code]);
  const pool = await ethers.getContractAt("MockShieldedPool", POOL);

  for (const s of [maker, taker, other]) {
    await usd.connect(s).faucet();
    await usd.connect(s).approve(await otc.getAddress(), ethers.MaxUint256);
  }
  return { admin, maker, taker, other, usd, otc, pool };
}

describe("OrbOTCV2", () => {
  describe("public trading (unchanged behaviour)", () => {
    it("sell order partial then full fill", async () => {
      const { maker, taker, usd, otc } = await setup();
      await otc.connect(maker).createSellOrder(USD("2.5"), { value: ORB("10") });
      await otc.connect(taker).fillSellOrder(0, ORB("4"));
      expect(await usd.balanceOf(maker.address)).to.equal(USD("10000") + USD("10"));
      await otc.connect(taker).fillSellOrder(0, ORB("6"));
      expect((await otc.orders(0)).open).to.equal(false);
    });

    it("buy order filled by taker", async () => {
      const { maker, taker, usd, otc } = await setup();
      await otc.connect(maker).createBuyOrder(USD("3"), ORB("5"));
      const before = await usd.balanceOf(taker.address);
      await otc.connect(taker).fillBuyOrder(0, { value: ORB("5") });
      expect(await usd.balanceOf(taker.address)).to.equal(before + USD("15"));
      expect((await otc.orders(0)).open).to.equal(false);
    });
  });

  describe("private receive", () => {
    it("pays the ORB into the shielded pool instead of the taker", async () => {
      const { maker, taker, usd, otc, pool } = await setup();
      await otc.connect(maker).createSellOrder(USD("2"), { value: ORB("3") });
      const takerBefore = await ethers.provider.getBalance(taker.address);

      const tx = await otc.connect(taker).fillSellOrderPrivate(0, ORB("1"), commitment, memo);
      const r = await tx.wait();
      const gas = r!.gasUsed * r!.gasPrice;

      expect(await pool.count()).to.equal(1n);
      expect(await pool.lastValue()).to.equal(ORB("1"));
      expect(await pool.lastAssetId()).to.equal(0n);
      expect(await pool.lastCommitment()).to.equal(commitment);
      expect(await pool.lastMemo()).to.equal(memo);
      // taker got no public ORB and paid quote
      expect(await ethers.provider.getBalance(taker.address)).to.equal(takerBefore - gas);
      expect(await usd.balanceOf(maker.address)).to.equal(USD("10000") + USD("2"));
      expect(await ethers.provider.getBalance(await otc.getAddress())).to.equal(ORB("2"));
      await expect(tx).to.emit(otc, "OrderFilled").withArgs(0, taker.address, ORB("1"), USD("2"), true);
    });

    it("reverts the whole fill if the shield call fails", async () => {
      const { maker, taker, usd, otc, pool } = await setup();
      await otc.connect(maker).createSellOrder(USD("2"), { value: ORB("3") });
      await pool.setFailNext(true);
      const before = await usd.balanceOf(taker.address);
      await expect(otc.connect(taker).fillSellOrderPrivate(0, ORB("1"), commitment, memo)).to.be.revertedWith("mock: shield rejected");
      expect(await usd.balanceOf(taker.address)).to.equal(before);
      expect((await otc.orders(0)).remainingOrb).to.equal(ORB("3"));
    });

    it("rejects a memo that is not 180 bytes", async () => {
      const { maker, taker, otc } = await setup();
      await otc.connect(maker).createSellOrder(USD("2"), { value: ORB("3") });
      await expect(otc.connect(taker).fillSellOrderPrivate(0, ORB("1"), commitment, "0x1234")).to.be.revertedWith("bad memo size");
    });
  });

  describe("pause", () => {
    it("only the owner can pause; paused blocks new trading but not cancel", async () => {
      const { admin, maker, taker, otc } = await setup();
      await otc.connect(maker).createSellOrder(USD("1"), { value: ORB("1") });
      await expect(otc.connect(taker).pause()).to.be.revertedWith("not owner");
      await otc.connect(admin).pause();
      await expect(otc.connect(maker).createSellOrder(USD("1"), { value: ORB("1") })).to.be.revertedWith("paused");
      await expect(otc.connect(taker).fillSellOrder(0, ORB("1"))).to.be.revertedWith("paused");
      await expect(otc.connect(taker).fillSellOrderPrivate(0, ORB("1"), commitment, memo)).to.be.revertedWith("paused");
      // maker can still get the funds back
      await otc.connect(maker).cancelOrder(0);
      expect((await otc.orders(0)).open).to.equal(false);
      await otc.connect(admin).unpause();
      await otc.connect(maker).createSellOrder(USD("1"), { value: ORB("1") });
    });
  });

  describe("blocklist", () => {
    it("adds and removes addresses in batch, with events", async () => {
      const { admin, taker, other, otc } = await setup();
      await expect(otc.connect(admin).setBlocked([taker.address, other.address], true))
        .to.emit(otc, "BlockedSet")
        .withArgs(taker.address, true, admin.address);
      expect(await otc.blocked(taker.address)).to.equal(true);
      expect(await otc.blocked(other.address)).to.equal(true);
      await otc.connect(admin).setBlocked([taker.address], false);
      expect(await otc.blocked(taker.address)).to.equal(false);
      expect(await otc.blocked(other.address)).to.equal(true);
    });

    it("only the owner can change the blocklist", async () => {
      const { taker, otc } = await setup();
      await expect(otc.connect(taker).setBlocked([taker.address], true)).to.be.revertedWith("not owner");
    });

    it("a blocked address cannot create or fill, but can cancel its own order", async () => {
      const { admin, maker, taker, otc } = await setup();
      await otc.connect(maker).createSellOrder(USD("1"), { value: ORB("2") });
      await otc.connect(admin).setBlocked([maker.address, taker.address], true);
      await expect(otc.connect(maker).createSellOrder(USD("1"), { value: ORB("1") })).to.be.revertedWith("blocked");
      await expect(otc.connect(taker).fillSellOrder(0, ORB("1"))).to.be.revertedWith("blocked");
      // taker unblocked, but the order's maker is still blocked -> cannot be filled
      await otc.connect(admin).setBlocked([taker.address], false);
      await expect(otc.connect(taker).fillSellOrder(0, ORB("1"))).to.be.revertedWith("maker blocked");
      // blocked maker still recovers their own funds
      const before = await ethers.provider.getBalance(maker.address);
      const tx = await otc.connect(maker).cancelOrder(0);
      const r = await tx.wait();
      expect(await ethers.provider.getBalance(maker.address)).to.equal(before + ORB("2") - r!.gasUsed * r!.gasPrice);
    });
  });

  describe("ownership", () => {
    it("owner can hand admin rights to another address", async () => {
      const { admin, other, otc } = await setup();
      await otc.connect(admin).transferOwnership(other.address);
      await expect(otc.connect(admin).pause()).to.be.revertedWith("not owner");
      await otc.connect(other).pause();
      await expect(otc.connect(other).transferOwnership(ethers.ZeroAddress)).to.be.revertedWith("zero owner");
    });
  });
});
