// Operator controls for OrbOTCV2. Uses DEPLOYER_KEY (the contract owner) from .env.
//   node scripts/admin.mjs status
//   node scripts/admin.mjs pause | unpause
//   node scripts/admin.mjs block 0xabc... 0xdef...
//   node scripts/admin.mjs unblock 0xabc...
//   node scripts/admin.mjs check 0xabc...
//   node scripts/admin.mjs transfer-owner 0xnewOwner
//   node scripts/admin.mjs set-fees <makerBps> <takerBps>   (100 bps = 1%, cap 100)
//   node scripts/admin.mjs set-fee-recipient 0xaddr          (0x000... turns fees off)
//   node scripts/admin.mjs claim-fees <token>                (sends accrued fees in that token to the recipient)
//   node scripts/admin.mjs quotes                            (lists whitelisted quote tokens)
//   node scripts/admin.mjs add-quote 0xtoken                 (whitelist USDT, USDC, ... exact contract addresses only)
//   node scripts/admin.mjs remove-quote 0xtoken              (stops NEW orders in that token; existing orders keep working)
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
    console.log({
      contract: dep.otcV2,
      owner: await otc.owner(),
      paused: await otc.paused(),
      you: signer.address,
      makerFeeBps: Number(await otc.makerFeeBps()),
      takerFeeBps: Number(await otc.takerFeeBps()),
      feeRecipient: await otc.feeRecipient(),
    });
    {
      const [tokens, enabled] = await otc.getQuoteTokens();
      for (let i = 0; i < tokens.length; i++) {
        const t = new ethers.Contract(tokens[i], ["function symbol() view returns (string)", "function decimals() view returns (uint8)"], provider);
        console.log(`quote ${await t.symbol()} ${tokens[i]} enabled=${enabled[i]} accruedFees=${ethers.formatUnits(await otc.accruedFees(tokens[i]), await t.decimals())}`);
      }
    }
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
  case "set-fees": {
    const [m, t] = args.map(Number);
    if (!Number.isInteger(m) || !Number.isInteger(t)) throw new Error("Usage: set-fees <makerBps> <takerBps>");
    await send(`fees set to maker ${m} bps, taker ${t} bps`, otc.setFees(m, t));
    break;
  }
  case "set-fee-recipient": {
    const [to] = args.length ? args : [ethers.ZeroAddress];
    await send(`fee recipient set to ${ethers.getAddress(to)}`, otc.setFeeRecipient(ethers.getAddress(to)));
    break;
  }
  case "claim-fees": {
    const [token] = addrs();
    await send(`fees claimed for ${token}`, otc.claimFees(token));
    break;
  }
  case "quotes": {
    const [tokens, enabled] = await otc.getQuoteTokens();
    tokens.forEach((t, i) => console.log(t, "enabled:", enabled[i]));
    break;
  }
  case "add-quote": {
    const [token] = addrs();
    await send(`quote token ${token} enabled`, otc.setQuoteToken(token, true));
    break;
  }
  case "remove-quote": {
    const [token] = addrs();
    await send(`quote token ${token} disabled for new orders`, otc.setQuoteToken(token, false));
    break;
  }
  default:
    console.log("Usage: status | pause | unpause | block <addr...> | unblock <addr...> | check <addr...> | transfer-owner <addr> | set-fees <maker> <taker> | set-fee-recipient <addr> | claim-fees <token> | quotes | add-quote <addr> | remove-quote <addr>");
}
