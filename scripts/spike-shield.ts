import { ethers } from "hardhat";

const POOL = "0x0000000000000000000000000000000000000801";
const SELECTOR_SHIELD = ethers.id("shield(uint32,bytes32,bytes)").slice(0, 10);

// Spike: (A) shield straight from an EOA, (B) shield through a contract. Dummy commitment/memo, 0.01 ORB each.
async function main() {
  const [me] = await ethers.getSigners();
  const value = ethers.parseEther("0.01");
  const memo = new Uint8Array(180); // MemoFormat.dummy()
  console.log("selector", SELECTOR_SHIELD, "(expected 0x9feb22ea)");

  const rand = () => ethers.hexlify(ethers.randomBytes(32));

  // A) EOA -> precompile
  const dataA = new ethers.Interface(["function shield(uint32,bytes32,bytes)"]).encodeFunctionData("shield", [0, rand(), memo]);
  try {
    const tx = await me.sendTransaction({ to: POOL, data: dataA, value, gasLimit: 800000 });
    const r = await tx.wait();
    console.log("A) EOA shield status:", r?.status, "gasUsed:", r?.gasUsed.toString());
  } catch (e: any) {
    console.log("A) EOA shield FAILED:", e.shortMessage ?? e.message);
  }

  // B) Contract -> precompile
  const probe = await ethers.deployContract("ShieldProbe");
  await probe.waitForDeployment();
  console.log("probe:", await probe.getAddress());
  try {
    const tx = await probe.shieldTo(0, rand(), memo, { value, gasLimit: 900000 });
    const r = await tx.wait();
    console.log("B) contract shield status:", r?.status, "gasUsed:", r?.gasUsed.toString());
  } catch (e: any) {
    console.log("B) contract shield FAILED:", e.shortMessage ?? e.message);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
