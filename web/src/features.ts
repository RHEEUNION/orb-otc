import deployment from "./deployment.json";

const flags = (deployment as { features?: { multichainScan?: boolean } }).features ?? {};
const query = typeof location !== "undefined" ? new URLSearchParams(location.search) : new URLSearchParams();

/**
 * Feature switches. Everything prepared for mainnet stays off until turned on here or in deployment.json.
 * `?scan=1` lets the team preview the multichain scanner on testnet without shipping it to users.
 */
export const FEATURES = {
  /** Scan the connected wallet for USDT/USDC on other EVM networks (mainnet feature). */
  multichainScan: flags.multichainScan === true || query.get("scan") === "1",
};
