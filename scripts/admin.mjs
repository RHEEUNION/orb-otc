// Operator controls for OrbOTCV2. Uses DEPLOYER_KEY (the contract owner) from .env.
//   node scripts/admin.mjs status
//   node scripts/admin.mjs pause | unpause
//   node scripts/admin.mjs block 0xabc... 0xdef...
//   node scripts/admin.mjs unblock 0xabc...
//   node scripts/admin.mjs check 0xabc...
//   node scripts/admin.mjs transfer-owner 0xnewOwner
import { readFileSync } from "node:fs";
import { ethers } from "ethers";

const [cmd, ...args] = process.argv.slice(2);
const dep = JSON.parse(readFileSync("web/src/deployment.json", "utf8"));
if (!dep.otcV2) throw new Error("No otcV2 in web/src/deployment.json. Run scripts/deploy-v2.ts first.");
const env = Object.fromEntries(
  readFileSync(".env", "utf8").split("\n").filter(Boolean).map((l) => l.split("=")),
);
const abi = JSON.parse(readFileSync("artifacts/contracts/OrbOTCV2.sol/OrbOTCV2.json", "utf8")).abi;
const provider = new ethers.JsonRpcProvider(env.ORBINUM_RPC ?? "https://rpc-1.testnet.orbinum.io");
const signer = new ethers.Wallet(env.DEPLOYER_KEY, provider);
const otc = new ethers.Contract(dep.otcV2, abi, signer);

const send = async (label, p) => {
  const tx = await p;
  const r = await tx.wait();
  console.log(`${label}: ok (tx ${tx.hash}, block ${r.blockNumber})`);
};
const addrs = () => {
  if (args.length === 0) throw new Error("Give at least one address");
  return args.map((a) => ethers.getAddress(a));
};

switch (cmd) {
  case "status":
    console.log({ contract: dep.otcV2, owner: await otc.owner(), paused: await otc.paused(), you: signer.address });
    break;
  case "pause":
    await send("paused", otc.pause());
    break;
  case "unpause":
    await send("unpaused", otc.unpause());
    break;
  case "block":
    await send(`blocked ${args.length} address(es)`, otc.setBlocked(addrs(), true));
    break;
  case "unblock":
    await send(`unblocked ${args.length} address(es)`, otc.setBlocked(addrs(), false));
    break;
  case "check":
    for (const a of addrs()) console.log(a, "blocked:", await otc.blocked(a));
    break;
  case "transfer-owner": {
    const [to] = addrs();
    await send(`ownership moved to ${to}`, otc.transferOwnership(to));
    break;
  }
  default:
    console.log("Usage: status | pause | unpause | block <addr...> | unblock <addr...> | check <addr...> | transfer-owner <addr>");
}
