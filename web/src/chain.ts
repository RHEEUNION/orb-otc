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

const ZERO = "0x0000000000000000000000000000000000000000";
const d = deployment as { otc: string; otcV2?: string; quote: string; features?: { multichainScan?: boolean } };

/** v2 (multi quote token, private receive, pause, blocklist, fees) when deployed, otherwise the v1 escrow. */
export const OTC = (d.otcV2 ?? d.otc) as `0x${string}`;
export const IS_V2 = !!d.otcV2;
/** The testnet test token. It has a public faucet; on mainnet this is replaced by whitelisted USDT and USDC. */
export const TEST_TOKEN = d.quote as `0x${string}`;
export const DEPLOYED = OTC !== ZERO;
export const PRIVATE_FILL_GAS = 1_500_000n; // the precompile call is not reliably gas-estimated

export const otcAbi = parseAbi([
  "function createSellOrder(address quote, uint256 price) payable returns (uint256)",
  "function createBuyOrder(address quote, uint256 price, uint256 orbAmount) returns (uint256)",
  "function fillSellOrder(uint256 id, uint256 orbAmount)",
  "function fillSellOrderPrivate(uint256 id, uint256 orbAmount, bytes32 commitment, bytes memo)",
  "function fillBuyOrder(uint256 id) payable",
  "function cancelOrder(uint256 id)",
  "function nextOrderId() view returns (uint256)",
  "function paused() view returns (bool)",
  "function blocked(address) view returns (bool)",
  "function makerFeeBps() view returns (uint16)",
  "function takerFeeBps() view returns (uint16)",
  "function feeRecipient() view returns (address)",
  "function getQuoteTokens() view returns (address[] tokens, bool[] enabled)",
  "function getOrders(uint256 from, uint256 limit) view returns (uint256[] ids, (address maker, bool isSell, bool open, uint16 makerFeeBps, address quote, uint256 price, uint256 remainingOrb, uint256 remainingQuote, uint256 remainingFee)[] list)",
]);

export const erc20Abi = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address,address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function faucet()",
]);
