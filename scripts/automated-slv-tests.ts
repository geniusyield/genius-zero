import fs from "fs";
import {
  Lucid,
  Blockfrost,
  UTxO,
  type LucidEvolution,
} from "@lucid-evolution/lucid";
import { DEX_CONSTANTS } from "../src/config/dex";
import { fetchAllLiquidityVaults } from "../src/services/liquidity";
import {
  fillLiquidityVault,
  SignedOracleCertificate,
} from "../src/contracts/slv";
import { patchProviderEvaluation } from "../src/services/lucid";
import { LiquidityVault } from "../src/types";

const SOVEREIGN_ORACLE_KEY = "24207cde7ca2dc27431ff87b5324ab5b0d8c113f608f5143ff50a6bae60373c0";

interface TestResult {
  vaultIndex: number;
  utxoRef: string;
  pair: string;
  pricingType: string;
  direction: "straight" | "reverse";
  amount: string;
  status: "PASS" | "FAIL" | "SKIPPED";
  reason?: string;
}

const isAda = (p: string) => !p || p === "" || p === "lovelace";
const GENS_POLICY = "dda5fdb1002f7389b33e036b6afee82a8189becb6cba852e8b79b4fb";

async function testVaultTrade(
  lucid: LucidEvolution,
  walletAddress: string,
  walletAssets: Record<string, bigint>,
  vault: LiquidityVault,
  direction: "straight" | "reverse"
): Promise<{ status: "PASS" | "FAIL" | "SKIPPED"; reason?: string }> {
  const isStraight = direction === "straight";
  const boughtToken = isStraight ? vault.tokenA : vault.tokenB;
  const paymentToken = isStraight ? vault.tokenB : vault.tokenA;

  const availableLiquidity = isStraight ? vault.amountA : vault.amountB;
  if (availableLiquidity <= 0n) {
    return { status: "SKIPPED", reason: `No ${direction} liquidity available in vault` };
  }

  // Check reverse support
  if (!isStraight) {
    const hasReverse =
      vault.pricingType === "fixed"
        ? !!vault.fixedPrice?.hasReverse
        : !!vault.oracleDelta?.hasReverse;
    if (!hasReverse) {
      return { status: "SKIPPED", reason: "Reverse trading disabled in vault datum" };
    }
  }

  // Skip legacy company oracle key
  if (vault.pricingType !== "fixed") {
    const key = vault.oracleDelta?.oracleKey?.toLowerCase();
    if (key !== SOVEREIGN_ORACLE_KEY) {
      return { status: "SKIPPED", reason: `Legacy company oracle key (${key?.slice(0, 10)}...)` };
    }
  }

  // Check if test wallet has payment asset
  const isPaymentAda = isAda(paymentToken.policyId);
  const isPaymentGens = paymentToken.policyId === GENS_POLICY;

  if (!isPaymentAda && !isPaymentGens) {
    return {
      status: "SKIPPED",
      reason: `Test wallet lacks ${paymentToken.symbol} balance to fund payment`,
    };
  }

  // Size fill amount safely
  const decimals = boughtToken.decimals;
  let fillAmount = 100_000n; // 0.1 tokens if 6 decimals
  if (decimals === 0) fillAmount = 1n;

  if (isPaymentGens && vault.pricingType === "fixed" && vault.fixedPrice) {
    // If buying with GENS at a high rate (e.g. 31,250 GENS/ADA), size fillAmount to stay within wallet balance
    const rate = isStraight ? vault.fixedPrice.priceAtoB : (vault.fixedPrice.priceBtoA || 1);
    if (rate > 1) {
      fillAmount = 10_000_000n / BigInt(Math.ceil(rate)) || 1n;
    }
  }

  if (fillAmount > availableLiquidity) fillAmount = availableLiquidity / 2n || 1n;
  if (fillAmount <= 0n) fillAmount = 1n;

  // Fetch oracle certificate if DeltaOracle
  let oracleCert: SignedOracleCertificate | undefined = undefined;
  if (vault.pricingType !== "fixed") {
    try {
      const baseTok = isStraight ? vault.tokenA : vault.tokenB;
      const quoteTok = isStraight ? vault.tokenB : vault.tokenA;

      const res = await fetch("https://2.28.204.8.sslip.io/api/v1/oracle/certificate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          network: "mainnet",
          baseAsset: {
            policyHex: baseTok.policyId || "",
            tokenHex: baseTok.assetName || "",
            symbol: baseTok.symbol || "",
          },
          quoteAsset: {
            policyHex: quoteTok.policyId || "",
            tokenHex: quoteTok.assetName || "",
            symbol: quoteTok.symbol || "",
          },
          symbol: baseTok.symbol !== "ADA" && baseTok.symbol !== "tADA" ? baseTok.symbol : quoteTok.symbol,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.approved) {
        return {
          status: "FAIL",
          reason: `Oracle rejected certificate: ${data.rejectionReason || data.error}`,
        };
      }

      oracleCert = {
        network: data.network,
        baseAsset: data.baseAsset,
        quoteAsset: data.quoteAsset,
        price: {
          numerator: BigInt(data.price.numerator),
          denominator: BigInt(data.price.denominator),
          approximateRate: data.price.approximateRate,
        },
        timestampMs: BigInt(data.timestampMs),
        signatureHex: data.signatureHex,
        oraclePubKeyHex: data.oraclePubKeyHex,
        cborHex: data.cborHex || "",
        quotes: data.quotes,
        divergencePercent: data.divergencePercent,
      };
    } catch (e: any) {
      return { status: "FAIL", reason: `Oracle daemon error: ${e.message}` };
    }
  }

  // Execute fill with simulateOnly: true (evaluates on-chain UPLC via Blockfrost/Ogmios without submitting)
  try {
    const result = await fillLiquidityVault(lucid, {
      vault,
      fillAmount,
      direction,
      oracleCertificate: oracleCert,
      recipientAddress: walletAddress,
      simulateOnly: true,
    });

    if (result === "simulated_ok") {
      return { status: "PASS" };
    }
    return { status: "FAIL", reason: `Unexpected result: ${result}` };
  } catch (err: any) {
    const msg = err?.message || String(err);
    return { status: "FAIL", reason: msg.slice(0, 160) };
  }
}

async function main() {
  console.log("================================================================================");
  console.log("   Genius Zero — Automated Smart Liquidity Vault (SLV) Transaction Tester");
  console.log("================================================================================");

  let bfKey =
    process.env.VITE_BLOCKFROST_API_KEY_MAINNET ||
    process.env.BLOCKFROST_API_KEY_MAINNET;
  if (!bfKey && fs.existsSync(".env")) {
    const env = fs.readFileSync(".env", "utf-8");
    bfKey =
      env.match(/VITE_BLOCKFROST_API_KEY_MAINNET=(.*)/)?.[1]?.trim() ||
      env.match(/BLOCKFROST_API_KEY_MAINNET=(.*)/)?.[1]?.trim();
  }
  if (!bfKey) {
    throw new Error("Missing BLOCKFROST_API_KEY_MAINNET in environment or .env");
  }
  const lucid = await Lucid(
    new Blockfrost(DEX_CONSTANTS.mainnet.blockfrostUrl, bfKey),
    "Mainnet"
  );
  patchProviderEvaluation(lucid);

  const realAddress = "addr1v8gg5hurpxmde5wez2chxzdu73fnt5guql4wrv4g2zwylggmjqgw9";
  const realUtxos = await lucid.utxosAt(realAddress);
  lucid.selectWallet.fromAddress(realAddress, realUtxos);

  const walletAssets: Record<string, bigint> = {};
  for (const u of realUtxos) {
    for (const [unit, amt] of Object.entries(u.assets)) {
      walletAssets[unit] = (walletAssets[unit] || 0n) + BigInt(amt);
    }
  }

  console.log(`Loaded testing wallet: ${realAddress}`);
  console.log(`Available UTxOs: ${realUtxos.length}`);
  console.log(`Wallet ADA: ${(Number(walletAssets["lovelace"] || 0n) / 1_000_000).toFixed(2)} ADA`);

  const vaults = await fetchAllLiquidityVaults(lucid, "mainnet");
  console.log(`\nDiscovered ${vaults.length} total Smart Liquidity Vaults on Cardano Mainnet.`);
  console.log("Beginning automated trade transaction simulation on all active vaults...\n");

  const results: TestResult[] = [];

  for (let i = 0; i < vaults.length; i++) {
    const v = vaults[i];
    const pair = `${v.tokenA.symbol}/${v.tokenB.symbol}`;
    const shortRef = `${v.utxoRef.txHash.slice(0, 8)}...#${v.utxoRef.outputIndex}`;

    // Test Straight Direction (Buy Token A with Token B)
    if (v.amountA > 0n) {
      process.stdout.write(`[${i + 1}/${vaults.length}] ${shortRef} ${pair.padEnd(12)} Straight (Buy ${v.tokenA.symbol.slice(0, 6).padEnd(6)})... `);
      const res = await testVaultTrade(lucid, realAddress, walletAssets, v, "straight");
      console.log(res.status === "PASS" ? "✅ PASS" : res.status === "SKIPPED" ? `⏭️  SKIPPED (${res.reason})` : `❌ FAIL: ${res.reason}`);
      results.push({
        vaultIndex: i,
        utxoRef: shortRef,
        pair,
        pricingType: v.pricingType,
        direction: "straight",
        amount: v.formattedAmountA,
        status: res.status,
        reason: res.reason,
      });
    }

    // Test Reverse Direction (Buy Token B with Token A)
    const hasReverse =
      v.pricingType === "fixed"
        ? !!v.fixedPrice?.hasReverse
        : !!v.oracleDelta?.hasReverse;

    if (hasReverse && v.amountB > 0n) {
      process.stdout.write(`[${i + 1}/${vaults.length}] ${shortRef} ${pair.padEnd(12)} Reverse  (Buy ${v.tokenB.symbol.slice(0, 6).padEnd(6)})... `);
      const res = await testVaultTrade(lucid, realAddress, walletAssets, v, "reverse");
      console.log(res.status === "PASS" ? "✅ PASS" : res.status === "SKIPPED" ? `⏭️  SKIPPED (${res.reason})` : `❌ FAIL: ${res.reason}`);
      results.push({
        vaultIndex: i,
        utxoRef: shortRef,
        pair,
        pricingType: v.pricingType,
        direction: "reverse",
        amount: v.formattedAmountB,
        status: res.status,
        reason: res.reason,
      });
    }
  }

  console.log("\n================================================================================");
  console.log("   AUTOMATED TEST RUN SUMMARY");
  console.log("================================================================================");
  const passed = results.filter((r) => r.status === "PASS").length;
  const failed = results.filter((r) => r.status === "FAIL").length;
  const skipped = results.filter((r) => r.status === "SKIPPED").length;

  console.log(`Total Scenarios Tested: ${results.length}`);
  console.log(`  ✅ Passed:   ${passed}`);
  console.log(`  ❌ Failed:   ${failed}`);
  console.log(`  ⏭️  Skipped:  ${skipped} (legacy keys / unsupported test-wallet token)`);

  if (failed > 0) {
    console.log("\nFailures to Investigate:");
    for (const f of results.filter((r) => r.status === "FAIL")) {
      console.log(`- ${f.utxoRef} (${f.pair} ${f.direction}): ${f.reason}`);
    }
  }
}

main().catch(console.error);
