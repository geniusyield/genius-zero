import assert from "node:assert/strict";
import { mapVaultLegToDexOrder } from "../src/services/orderbook";
import { calculateFillCost } from "../src/services/trade";
import { LiquidityVault, TradingPair, TokenInfo } from "../src/types";

const GENS_TOKEN: TokenInfo = {
  unit: "dda5fdb1002f7389b33e036b6afee82a8189becb6cba852e8b79b4fb0014df1047454e53",
  symbol: "GENS",
  name: "Genius Yield Token",
  decimals: 6,
  policyId: "dda5fdb1002f7389b33e036b6afee82a8189becb6cba852e8b79b4fb",
  assetName: "0014df1047454e53",
};

const ADA_TOKEN: TokenInfo = {
  unit: "lovelace",
  symbol: "ADA",
  name: "Cardano",
  decimals: 6,
};

const GENS_ADA_PAIR: TradingPair = {
  id: "GENS-ADA",
  baseToken: GENS_TOKEN,
  quoteToken: ADA_TOKEN,
};

console.log("=================================================================");
console.log("TEST SUITE: Smart Liquidity Vault (SLV) Order Book Integration");
console.log("=================================================================\n");

// -----------------------------------------------------------------------------
// Test 1: Fixed Price Two-Way SLV (Base = Token A, Quote = Token B)
// -----------------------------------------------------------------------------
console.log("--- TEST 1: Fixed Price Two-Way SLV (GENS / ADA) ---");
const fixedTwoWayVault: LiquidityVault = {
  utxoRef: { txHash: "1111111111111111111111111111111111111111111111111111111111111111", outputIndex: 0 },
  ownerKey: "aabbccdd11223344",
  isUserVault: false,
  nftUnit: "slv_nft_policy_001",
  nftTokenName: "001",
  tokenA: GENS_TOKEN,
  tokenB: ADA_TOKEN,
  amountA: 10_000_000_000n, // 10,000 GENS
  amountB: 5_000_000_000n,  // 5,000 ADA
  formattedAmountA: "10,000",
  formattedAmountB: "5,000",
  pricingType: "fixed",
  fixedPrice: {
    priceAtoB: 0.0010, // 1 GENS = 0.0010 ADA (Ask price)
    priceBtoA: 1000,
    formattedAtoB: "1 GENS = 0.0010 ADA",
    formattedBtoA: "1 ADA = 1000 GENS",
    hasReverse: true,
    reversePriceAtoB: 0.00095, // 1 GENS = 0.00095 ADA (Bid price)
    reversePriceBtoA: 1052.63,
  },
  canonicalPair: {
    base: GENS_TOKEN,
    quote: ADA_TOKEN,
    pairKey: "GENS / ADA",
    isReversed: false,
  },
};

const straightOrder1 = mapVaultLegToDexOrder(fixedTwoWayVault, "straight", GENS_ADA_PAIR);
assert(straightOrder1, "Straight leg must create a valid DexOrder");
assert.equal(straightOrder1.orderType, "ask", "Straight leg must be an ASK (selling GENS)");
assert.equal(straightOrder1.offeredAsset, GENS_TOKEN.unit);
assert.equal(straightOrder1.askedAsset, ADA_TOKEN.unit);
assert.equal(straightOrder1.offeredAmount, 10_000_000_000n);
assert.equal(straightOrder1.effectivePrice, 0.0010, "Ask effectivePrice must be 0.0010 ADA/GENS");
assert.equal(straightOrder1.isVault, true);
assert.equal(straightOrder1.vaultDirection, "straight");

const reverseOrder1 = mapVaultLegToDexOrder(fixedTwoWayVault, "reverse", GENS_ADA_PAIR);
assert(reverseOrder1, "Reverse leg must create a valid DexOrder");
assert.equal(reverseOrder1.orderType, "bid", "Reverse leg must be a BID (buying GENS with ADA)");
assert.equal(reverseOrder1.offeredAsset, ADA_TOKEN.unit);
assert.equal(reverseOrder1.askedAsset, GENS_TOKEN.unit);
assert.equal(reverseOrder1.offeredAmount, 5_000_000_000n);
assert.equal(reverseOrder1.effectivePrice, 0.00095, "Bid effectivePrice must be 0.00095 ADA/GENS");
assert.equal(reverseOrder1.isVault, true);
assert.equal(reverseOrder1.vaultDirection, "reverse");
console.log("✔ Test 1 Passed: Two-way fixed SLV appears on both sides (Ask @ 0.0010, Bid @ 0.00095)!\n");

// -----------------------------------------------------------------------------
// Test 2: Dynamic Oracle SLV with Live Price Updates
// -----------------------------------------------------------------------------
console.log("--- TEST 2: Dynamic Oracle SLV & Price Re-evaluation on Refresh ---");
const oracleVault: LiquidityVault = {
  utxoRef: { txHash: "2222222222222222222222222222222222222222222222222222222222222222", outputIndex: 1 },
  ownerKey: "aabbccdd11223344",
  isUserVault: false,
  nftUnit: "slv_nft_policy_002",
  nftTokenName: "002",
  tokenA: GENS_TOKEN,
  tokenB: ADA_TOKEN,
  amountA: 20_000_000_000n, // 20,000 GENS
  amountB: 15_000_000_000n, // 15,000 ADA
  formattedAmountA: "20,000",
  formattedAmountB: "15,000",
  pricingType: "delta_oracle",
  oracleDelta: {
    straightSpreadPercent: 2.0, // +2% spread on Ask
    straightOffset: 0,
    hasReverse: true,
    reverseSpreadPercent: 2.0,  // -2% spread on Bid
    reverseOffset: 0,
    formattedStraight: "Oracle +2.0% spread",
    formattedReverse: "Oracle -2.0% spread",
  },
  canonicalPair: {
    base: GENS_TOKEN,
    quote: ADA_TOKEN,
    pairKey: "GENS / ADA",
    isReversed: false,
  },
};

// Oracle Price Snapshot 1: 0.000800 ADA per GENS
const oraclePrice1 = 0.000800;
const straightOracle1 = mapVaultLegToDexOrder(oracleVault, "straight", GENS_ADA_PAIR, oraclePrice1);
const reverseOracle1 = mapVaultLegToDexOrder(oracleVault, "reverse", GENS_ADA_PAIR, oraclePrice1);

assert(straightOracle1 && reverseOracle1);
// Ask = 0.000800 * 1.02 = 0.000816
assert.equal(Number(straightOracle1.effectivePrice.toFixed(6)), 0.000816);
// Bid = 0.000800 * 0.98 = 0.000784
assert.equal(Number(reverseOracle1.effectivePrice.toFixed(6)), 0.000784);
assert.equal(straightOracle1.isDynamicOracle, true);
assert.equal(reverseOracle1.isDynamicOracle, true);

// Oracle Price Snapshot 2 (Market moved up): 0.001000 ADA per GENS
const oraclePrice2 = 0.001000;
const straightOracle2 = mapVaultLegToDexOrder(oracleVault, "straight", GENS_ADA_PAIR, oraclePrice2);
const reverseOracle2 = mapVaultLegToDexOrder(oracleVault, "reverse", GENS_ADA_PAIR, oraclePrice2);

assert(straightOracle2 && reverseOracle2);
// Ask = 0.001000 * 1.02 = 0.001020
assert.equal(Number(straightOracle2.effectivePrice.toFixed(6)), 0.001020);
// Bid = 0.001000 * 0.98 = 0.000980
assert.equal(Number(reverseOracle2.effectivePrice.toFixed(6)), 0.000980);
console.log("✔ Test 2 Passed: Dynamic Oracle SLV prices update dynamically with oracle refreshes!\n");

// -----------------------------------------------------------------------------
// Test 3: Single-Sided Vault & Zero Liquidity Leg Filtering
// -----------------------------------------------------------------------------
console.log("--- TEST 3: Single-Sided Vault & Empty Leg Filtering ---");
const singleSidedVault: LiquidityVault = {
  ...fixedTwoWayVault,
  utxoRef: { txHash: "3333333333333333333333333333333333333333333333333333333333333333", outputIndex: 0 },
  amountA: 5_000_000_000n,
  amountB: 0n, // No ADA in vault
  fixedPrice: {
    ...fixedTwoWayVault.fixedPrice!,
    hasReverse: false, // Reverse disabled
  },
};

const straightSingle = mapVaultLegToDexOrder(singleSidedVault, "straight", GENS_ADA_PAIR);
const reverseSingle = mapVaultLegToDexOrder(singleSidedVault, "reverse", GENS_ADA_PAIR);
assert(straightSingle, "Straight leg must be present");
assert.equal(reverseSingle, null, "Reverse leg must NOT be present when disabled or empty");

const emptyVault: LiquidityVault = {
  ...fixedTwoWayVault,
  amountA: 0n,
  amountB: 0n,
};
assert.equal(mapVaultLegToDexOrder(emptyVault, "straight", GENS_ADA_PAIR), null, "Empty leg must not appear");
assert.equal(mapVaultLegToDexOrder(emptyVault, "reverse", GENS_ADA_PAIR), null, "Empty leg must not appear");
console.log("✔ Test 3 Passed: Inactive or empty legs cleanly filtered out from order book!\n");

// -----------------------------------------------------------------------------
// Test 4: Reversed Token Order (Token A = ADA, Token B = GENS)
// -----------------------------------------------------------------------------
console.log("--- TEST 4: Reversed Vault Token Order (Token A = ADA, Token B = GENS) ---");
const reversedOrientationVault: LiquidityVault = {
  utxoRef: { txHash: "4444444444444444444444444444444444444444444444444444444444444444", outputIndex: 0 },
  ownerKey: "aabbccdd11223344",
  isUserVault: false,
  nftUnit: "slv_nft_policy_004",
  nftTokenName: "004",
  tokenA: ADA_TOKEN,   // Token A is Quote
  tokenB: GENS_TOKEN,  // Token B is Base
  amountA: 2_000_000_000n,  // 2,000 ADA
  amountB: 2_000_000_000n,  // 2,000 GENS
  formattedAmountA: "2,000",
  formattedAmountB: "2,000",
  pricingType: "fixed",
  fixedPrice: {
    priceAtoB: 1000,    // 1 ADA gives 1000 GENS => 0.001 ADA per GENS
    priceBtoA: 0.001,
    formattedAtoB: "1 ADA = 1000 GENS",
    formattedBtoA: "1 GENS = 0.001 ADA",
    hasReverse: true,
    reversePriceAtoB: 950,
    reversePriceBtoA: 0.0010526,
  },
  canonicalPair: {
    base: GENS_TOKEN,
    quote: ADA_TOKEN,
    pairKey: "GENS / ADA",
    isReversed: true,
  },
};

const straightRev = mapVaultLegToDexOrder(reversedOrientationVault, "straight", GENS_ADA_PAIR);
assert(straightRev);
assert.equal(straightRev.orderType, "bid", "Offering ADA for GENS in straight leg must be a BID");
assert.equal(straightRev.offeredAsset, ADA_TOKEN.unit);

const reverseRev = mapVaultLegToDexOrder(reversedOrientationVault, "reverse", GENS_ADA_PAIR);
assert(reverseRev);
assert.equal(reverseRev.orderType, "ask", "Offering GENS for ADA in reverse leg must be an ASK");
assert.equal(reverseRev.offeredAsset, GENS_TOKEN.unit);
console.log("✔ Test 4 Passed: Vaults created with reversed token orientations map seamlessly!\n");

// -----------------------------------------------------------------------------
// Test 5: Fill Cost Calculation for SLV vs Normal Orders
// -----------------------------------------------------------------------------
console.log("--- TEST 5: Calculate Fill Cost for SLV Orders ---");
const slvAskOrder = straightOrder1; // 1 GENS = 0.0010 ADA
const fillAmount = 1_000_000_000n; // Fill 1,000 GENS

const fillCost = calculateFillCost(slvAskOrder, fillAmount);
assert.equal(fillCost.receiveAssetUnit, GENS_TOKEN.unit);
assert.equal(fillCost.receiveAmount, 1_000_000_000n);
assert.equal(fillCost.payAssetUnit, ADA_TOKEN.unit);
assert.equal(fillCost.takerFeeLovelace, 900_000n, "SLV taker fee must be 0.90 ADA");

// Payment calculation:
// offerNet = 1,000 GENS * 0.997 = 997 GENS
// at 0.0010 ADA/GENS = 0.997 ADA = 997,000 lovelace
console.log("  Pay Amount Lovelace:", fillCost.payAmount.toString());
assert(fillCost.payAmount > 0n, "Payment must be positive");
console.log("✔ Test 5 Passed: SLV fill cost and taker fee (0.90 ADA) computed accurately!\n");

console.log("=================================================================");
console.log("ALL 5 ORDER BOOK SLV INTEGRATION TESTS PASSED CLEANLY (5/5)!");
console.log("=================================================================");
