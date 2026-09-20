// Cancels every open order made by the deployer wallet on the given OTC contract(s), returning the escrow.
//   node scripts/cancel-all.mjs 0xContract [0xContract ...]
// Works on any OrbOTC version because it only uses cancelOrder(uint256) and nextOrderId().
import { readFileSync } from "node:fs";
import { ethers } from "ethers";

const env = Object.fromEntries(readFileSync(".env", "utf8").split("\n").filter(Boolean).map((l) => l.split("=")));
const provider = new ethers.JsonRpcProvider(env.ORBINUM_RPC ?? "https://rpc-1.testnet.orbinum.io");
const signer = new ethers.Wallet(env.DEPLOYER_KEY, provider);
const abi = ["function nextOrderId() view returns (uint256)", "function cancelOrder(uint256 id)"];

for (const addr of process.argv.slice(2)) {
  const otc = new ethers.Contract(addr, abi, signer);
  const n = await otc.nextOrderId();
  let cancelled = 0;
  for (let id = 0n; id < n; id++) {
    try {
      await otc.cancelOrder.staticCall(id); // reverts if not open or not ours
    } catch {
      continue;
    }
    await (await otc.cancelOrder(id)).wait();
    cancelled++;
  }
  console.log(`${addr}: cancelled ${cancelled} order(s); contract now holds ${ethers.formatEther(await provider.getBalance(addr))} ORB`);
}
console.log("deployer ORB:", ethers.formatEther(await provider.getBalance(signer.address)));
