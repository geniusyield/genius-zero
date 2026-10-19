import fs from "fs";
import path from "path";
import assert from "assert";
import {
  Blockfrost,
  Lucid,
  fromText,
  fromHex,
  toHex,
  paymentCredentialOf,
  scriptFromNative,
  mintingPolicyToId,
  Data,
  type LucidEvolution,
  type UTxO,
  type OutRef,
} from "@lucid-evolution/lucid";
import { DEX_CONSTANTS } from "../src/config/dex";
import {
  createLiquidityVault,
  fillLiquidityVault,
  cancelLiquidityVault,
} from "../src/contracts/slv";
import {
  createSignedOracleCertificate,
} from "../src/services/oracle";
import { LiquidityVault } from "../src/types/index";

function loadEnv() {
  const envFiles = [".env.test", ".env.local", ".env"];
  for (const file of envFiles) {
    const fullPath = path.resolve(process.cwd(), file);
    if (fs.existsSync(fullPath)) {
      const content = fs.readFileSync(fullPath, "utf-8");
      for (const line of content.split("\n")) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith("#") && trimmed.includes("=")) {
          const [key, ...rest] = trimmed.split("=");
          const val = rest.join("=").replace(/^["']|["']$/g, "").trim();
          if (!process.env[key.trim()]) {
            process.env[key.trim()] = val;
          }
        }
      }
    }
  }
}
loadEnv();

const WALLET_A_FILE = path.resolve(process.cwd(), "test-wallet-preprod.json");
const WALLET_B_FILE = path.resolve(process.cwd(), "test-wallet-b-preprod.json");
const ORACLE_SKEY_FILE =
  process.env.ORACLE_SKEY_PREPROD ||
  path.resolve(process.cwd(), "skeys/oracle-preprod.skey");

async function waitForScriptUtxo(
  lucid: LucidEvolution,
  txHash: string,
  outputIndex = 0,
  maxAttempts = 35
): Promise<UTxO> {
  const outRef: OutRef = { txHash, outputIndex };
  for (let i = 0; i < maxAttempts; i++) {
    const utxos = await lucid.utxosByOutRef([outRef]);
    if (utxos.length > 0 && utxos[0]) {
      return utxos[0];
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(`Timeout waiting for UTxO ${txHash}#${outputIndex} to appear on-chain.`);
}

async function run() {
  const blockfrostKey = process.env.BLOCKFROST_API_KEY_PREPROD;
  const endpoint = DEX_CONSTANTS.preprod.blockfrostUrl;
  const lucidA = await Lucid(new Blockfrost(endpoint, blockfrostKey), "Preprod");
  const lucidB = await Lucid(new Blockfrost(endpoint, blockfrostKey), "Preprod");

  const walletAData = JSON.parse(fs.readFileSync(WALLET_A_FILE, "utf-8"));
  lucidA.selectWallet.fromSeed(walletAData.seedPhrase);
  const addressA = await lucidA.wallet().address();

  const walletBData = JSON.parse(fs.readFileSync(WALLET_B_FILE, "utf-8"));
  lucidB.selectWallet.fromSeed(walletBData.seedPhrase);
  const addressB = await lucidB.wallet().address();

  const pkhA = paymentCredentialOf(addressA).hash;
  const nativeScript: any = {
    type: "all",
    scripts: [{ type: "sig", keyHash: pkhA }],
  };
  const script = scriptFromNative(nativeScript);
  const tstPolicyId = mintingPolicyToId(script);
  const tstAssetName = fromText("TST");
  const tstUnit = tstPolicyId + tstAssetName;

  const skeyContent = JSON.parse(fs.readFileSync(ORACLE_SKEY_FILE, "utf-8"));
  const oracleCertProbe = createSignedOracleCertificate({
    network: "preprod",
    baseAsset: { policyHex: "", tokenHex: "" },
    quoteAsset: { policyHex: "", tokenHex: "" },
    price: { numerator: 1n, denominator: 1n, approximateRate: 1.0 },
    oraclePrivateKeyHex: skeyContent.cborHex,
  });
  const oraclePubKey = oracleCertProbe.oraclePubKeyHex;

  console.log("Creating DeltaOracle SLV with both straight and reverse liquidity...");
  console.log("  Token A: 20 TST");
  console.log("  Token B: 10 tADA (10_000_000 lovelace)");
  console.log("  Oracle PubKey:", oraclePubKey);

  const createResult = await createLiquidityVault(lucidA, {
    ownerAddress: addressA,
    offeredAsset: {
      policyId: tstPolicyId,
      assetName: tstAssetName,
      amount: 20n,
    },
    askedAsset: {
      policyId: "",
      assetName: "",
      amount: 10_000_000n,
    },
    pricing: {
      type: "oracle",
      oraclePubKeyHex: oraclePubKey,
      offset: { numerator: 0n, denominator: 1n },
      spread: { numerator: 0n, denominator: 1n },
      reverseOffset: { numerator: 0n, denominator: 1n },
      reverseSpread: { numerator: 0n, denominator: 1n },
    },
  });

  console.log("✔ Vault created tx:", createResult.txHash);
  await lucidA.awaitTx(createResult.txHash);
  const vaultUtxo = await waitForScriptUtxo(lucidA, createResult.txHash, 1);
  console.log("✔ Vault UTxO confirmed at index 1!");

  const vaultObj: LiquidityVault = {
    utxoRef: { txHash: vaultUtxo.txHash, outputIndex: vaultUtxo.outputIndex },
    ownerKey: pkhA,
    ownerAddress: addressA,
    isUserVault: true,
    nftUnit: createResult.nftUnit,
    nftTokenName: createResult.nftTokenName,
    tokenA: { unit: tstUnit, policyId: tstPolicyId, name: "TST", ticker: "TST", decimals: 0 },
    tokenB: { unit: "lovelace", policyId: "", name: "ADA", ticker: "tADA", decimals: 6 },
    amountA: 20n,
    amountB: 10_000_000n,
    formattedAmountA: "20",
    formattedAmountB: "10",
    pricingType: "oracle",
    oracleDelta: {
      oracleKey: oraclePubKey,
      straightSpreadPercent: 0,
      straightOffset: 0,
      hasReverse: true,
      reverseSpreadPercent: 0,
      reverseOffset: 0,
    },
    canonicalPair: {
      base: { unit: tstUnit, policyId: tstPolicyId, name: "TST", ticker: "TST", decimals: 0 },
      quote: { unit: "lovelace", policyId: "", name: "ADA", ticker: "tADA", decimals: 6 },
      pairKey: "TST/ADA",
      isReversed: false,
    },
    rawDatumHex: vaultUtxo.datum,
  };

  // Now test reverse fill:
  // Bob wants to take 4 tADA (4_000_000 lovelace) from vault.
  // Oracle: 1 TST = 2 ADA (2_000_000 lovelace / 1 TST)
  // Bob should pay 2 TST.
  console.log("\nTesting Reverse Fill (Bob takes 4 ADA, pays 2 TST)...");
  
  // Try Certificate with baseAsset: TST, quoteAsset: ADA, price: 2_000_000 / 1
  const certNormal = createSignedOracleCertificate({
    network: "preprod",
    baseAsset: { policyHex: tstPolicyId, tokenHex: tstAssetName },
    quoteAsset: { policyHex: "", tokenHex: "" },
    price: { numerator: 2_000_000n, denominator: 1n, approximateRate: 2.0 },
    timestampMs: BigInt(Date.now()),
    oraclePrivateKeyHex: skeyContent.cborHex,
  });

  try {
    console.log("Attempt 1: fill with certNormal (baseAsset=TST, quoteAsset=ADA)...");
    const fillTx1 = await fillLiquidityVault(lucidB, {
      vault: vaultObj,
      fillAmount: 4_000_000n, // Bob consumes 4 ADA from vault
      direction: "reverse",
      oracleCertificate: certNormal,
      recipientAddress: addressB,
    });
    console.log("✔ Attempt 1 submitted:", fillTx1);
    await lucidB.awaitTx(fillTx1);
  } catch(e: any) {
    console.log("❌ Attempt 1 failed:", e.message || String(e));
  }

  // Cleanup: Cancel vault to reclaim funds
  console.log("\nCancelling vault to reclaim funds...");
  try {
    const cancelTx = await cancelLiquidityVault(lucidA, vaultObj);
    console.log("✔ Vault cancelled tx:", cancelTx);
    await lucidA.awaitTx(cancelTx);
  } catch(e: any) {
    console.log("Cancel error:", e.message || String(e));
  }
}

run().catch(console.error);
