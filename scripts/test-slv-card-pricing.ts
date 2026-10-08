import { calculateVaultOraclePrices, fetchLiveOraclePrice } from "../src/services/oracle";
import { LiquidityVault } from "../src/types/index";

async function run() {
  console.log("Testing calculateVaultOraclePrices and fetchLiveOraclePrice...");

  const mockVault: LiquidityVault = {
    utxoRef: { txHash: "1111111111111111111111111111111111111111111111111111111111111111", outputIndex: 0 },
    ownerKey: "abcd",
    isUserVault: false,
    nftUnit: "policy.nft",
    nftTokenName: "nft",
    tokenA: {
      unit: "dda5fdb1002f7389b33e036b6afee82a8189becb6cba852e8b79b4fb0014df1047454e53",
      symbol: "GENS",
      name: "Genius",
      decimals: 6,
      policyId: "dda5fdb1002f7389b33e036b6afee82a8189becb6cba852e8b79b4fb0014df10",
      assetName: "47454e53"
    },
    tokenB: {
      unit: "lovelace",
      symbol: "ADA",
      name: "Cardano",
      decimals: 6,
      policyId: "",
      assetName: ""
    },
    amountA: 100_000_000n,
    amountB: 200_000_000n,
    formattedAmountA: "100",
    formattedAmountB: "200",
    pricingType: "delta_oracle",
    oracleDelta: {
      straightSpreadPercent: 2.0,
      straightOffset: 0,
      hasReverse: true,
      reverseSpreadPercent: 2.0,
      reverseOffset: 0,
      formattedStraight: "+2.0% spread",
      formattedReverse: "+2.0% spread"
    },
    canonicalPair: {
      base: {
        unit: "dda5fdb1002f7389b33e036b6afee82a8189becb6cba852e8b79b4fb0014df1047454e53",
        symbol: "GENS",
        name: "Genius",
        decimals: 6,
        policyId: "dda5fdb1002f7389b33e036b6afee82a8189becb6cba852e8b79b4fb0014df10",
        assetName: "47454e53"
      },
      quote: {
        unit: "lovelace",
        symbol: "ADA",
        name: "Cardano",
        decimals: 6,
        policyId: "",
        assetName: ""
      },
      pairKey: "GENS / ADA",
      isReversed: false
    }
  };

  const oracleRate = 0.000765;
  const derived = calculateVaultOraclePrices(mockVault, oracleRate);
  console.log("Derived prices:", derived);

  if (!derived) throw new Error("derived is null");
  if (!derived.priceBaseToQuote || Math.abs(derived.priceBaseToQuote - 0.000765 * 1.02) > 1e-9) {
    throw new Error(`Straight price mismatch: got ${derived.priceBaseToQuote}`);
  }
  const expectedReverse = 1 / (0.000765 * 0.98);
  if (!derived.priceQuoteToBase || Math.abs(derived.priceQuoteToBase - expectedReverse) > 1e-4) {
    throw new Error(`Reverse price mismatch: got ${derived.priceQuoteToBase}`);
  }

  console.log("Fetching live price via fetchLiveOraclePrice (Mainnet)...");
  const livePrice = await fetchLiveOraclePrice(
    "mainnet",
    mockVault.canonicalPair.base,
    mockVault.canonicalPair.quote
  );
  console.log("Live Oracle Price (Mainnet GENS in ADA):", livePrice);
  if (!livePrice || livePrice <= 0) {
    throw new Error("Failed to fetch live oracle price");
  }

  console.log("Fetching live price via fetchLiveOraclePrice (Preprod mapping)...");
  const tGensToken = {
    unit: "c6e65ba7878b2f8ea0ad39287d3e2fd256dc5c4160fc19bdf4c4d87e7447454e53",
    symbol: "tGENS",
    name: "Test GENS",
    decimals: 6,
    policyId: "c6e65ba7878b2f8ea0ad39287d3e2fd256dc5c4160fc19bdf4c4d87e",
    assetName: "7447454e53",
  };
  const tAdaToken = {
    unit: "lovelace",
    symbol: "tADA",
    name: "Test ADA",
    decimals: 6,
    policyId: "",
    assetName: "",
  };
  const preprodLivePrice = await fetchLiveOraclePrice("preprod", tGensToken, tAdaToken);
  console.log("Live Oracle Price (Preprod tGENS in tADA):", preprodLivePrice);
  if (!preprodLivePrice || preprodLivePrice <= 0) {
    throw new Error("Failed to fetch preprod live oracle price");
  }

  console.log("All SLV card pricing tests passed!");
}

run().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
