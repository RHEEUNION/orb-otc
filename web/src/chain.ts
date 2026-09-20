import { defineChain, parseAbi } from "viem";
import deployment from "./deployment.json";

// Values from https://docs.orbinum.network/build/get-started
export const orbinumTestnet = defineChain({
  id: 2700,
  name: "Orbinum Testnet",
  nativeCurrency: { name: "ORB", symbol: "ORB", decimals: 18 },
  rpcUrls: {
    default: {
      http: ["https://rpc-1.testnet.orbinum.io"],
      webSocket: ["wss://rpc-1.testnet.orbinum.io"],
    },
  },
  blockExplorers: { default: { name: "Orbinum Explorer", url: "https://explorer.testnet.orbinum.network" } },
  testnet: true,
});

export const OTC = deployment.otc as `0x${string}`;
export const QUOTE = deployment.quote as `0x${string}`;
export const DEPLOYED = OTC !== "0x0000000000000000000000000000000000000000";
export const QUOTE_DECIMALS = 6;
export const QUOTE_SYMBOL = "tUSD";

export const otcAbi = parseAbi([
  "function createSellOrder(uint256 price) payable returns (uint256)",
  "function createBuyOrder(uint256 price, uint256 orbAmount) returns (uint256)",
  "function fillSellOrder(uint256 id, uint256 orbAmount)",
  "function fillBuyOrder(uint256 id) payable",
  "function cancelOrder(uint256 id)",
  "function nextOrderId() view returns (uint256)",
  "function getOrders(uint256 from, uint256 limit) view returns (uint256[] ids, (address maker, bool isSell, bool open, uint256 price, uint256 remainingOrb, uint256 remainingQuote)[] list)",
]);

export const erc20Abi = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address,address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
  "function faucet()",
]);
