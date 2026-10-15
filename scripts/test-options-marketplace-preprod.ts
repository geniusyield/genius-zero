/**
 * Genius Zero — Option Marketplace End-to-End Preprod Integration Test
 *
 * Verifies on-chain integration between Options Protocol & Genius Yield DEX:
 * 1. Alice creates an Option Vault offering TST collateral.
 * 2. Alice lists option tokens on the DEX orderbook for sale in tADA (decoupled quote asset).
 * 3. On-chain DEX order indexing via fetchOptionMarketListings matches the position and calculates pricing.
 * 4. Bob buys option tokens directly from the DEX via fillDexOrder (paying tADA).
 * 5. Bob exercises the purchased option tokens on-chain (executeOption), claiming TST collateral.
 * 6. Alice cancels her remaining DEX listing (cancelLimitOrder), reclaiming option tokens & maker deposit.
 * 7. Alice cancels remaining unsold options (cancelEarlyOption), cleanly closing the option position.
 *
 * Usage:
 *   node scripts/patch-lucid.js && npx vite-node scripts/test-options-marketplace-preprod.ts
 */

import fs from "fs";
import path from "path";
import assert from "assert";
import {
  Blockfrost,
  Lucid,
  type LucidEvolution,
  type UTxO,
  type OutRef,
  paymentCredentialOf,
} from "@lucid-evolution/lucid";
import {
  createOption,
  executeOption,
  cancelEarlyOption,
  ADA_OPTION_ASSET,
  type OptionAsset,
  type Rational,
} from "../src/contracts/options";
import {
  fetchOptionMarketListings,
  createOptionTradingPair,
  fetchActiveOptions,
  OptionPosition,
} from "../src/services/options";
import {
  placeLimitOrder,
  fillDexOrder,
  cancelLimitOrder,
} from "../src/services/trade";
import { patchProviderEvaluation } from "../src/services/lucid";

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

const TST_ASSET: OptionAsset = {
  policyId: "79cb35ac4638bd5b493ee64a91b05d8de7ab0114b729a23f1bdfdce6",
  assetName: "545354", // "TST"
};
const TST_UNIT = TST_ASSET.policyId + TST_ASSET.assetName;

function getAssetBalance(utxos: UTxO[], unit: string): bigint {
  let total = 0n;
  for (const u of utxos) {
    total += u.assets[unit] || 0n;
  }
  return total;
}

async function waitForWalletUtxo(
  lucid: LucidEvolution,
  txHash: string,
  maxAttempts = 35
): Promise<UTxO[]> {
  for (let i = 0; i < maxAttempts; i++) {
    const utxos = await lucid.wallet().getUtxos();
    if (utxos.some((u) => u.txHash === txHash)) {
      return utxos;
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  return await lucid.wallet().getUtxos();
}

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
  throw new Error(`Timeout waiting for script UTxO ${txHash}#${outputIndex} to appear on-chain.`);
}

async function main() {
  console.log("========================================================================");
  console.log("  GENIUS ZERO: Option Marketplace Preprod Integration Test Suite");
  console.log("========================================================================\n");

  const blockfrostKey = process.env.BLOCKFROST_API_KEY_PREPROD;
  if (!blockfrostKey) {
    throw new Error("Missing BLOCKFROST_API_KEY_PREPROD in environment!");
  }

  const walletAData = JSON.parse(fs.readFileSync(WALLET_A_FILE, "utf-8"));
  const walletBData = JSON.parse(fs.readFileSync(WALLET_B_FILE, "utf-8"));

  const lucidA = await Lucid(
    new Blockfrost("https://cardano-preprod.blockfrost.io/api/v0", blockfrostKey),
    "Preprod"
  );
  patchProviderEvaluation(lucidA);
  lucidA.selectWallet.fromSeed(walletAData.seedPhrase);
  const addressA = await lucidA.wallet().address();
  const pkhA = paymentCredentialOf(addressA).hash;

  const lucidB = await Lucid(
    new Blockfrost("https://cardano-preprod.blockfrost.io/api/v0", blockfrostKey),
    "Preprod"
  );
  patchProviderEvaluation(lucidB);
  lucidB.selectWallet.fromSeed(walletBData.seedPhrase);
  const addressB = await lucidB.wallet().address();
  const pkhB = paymentCredentialOf(addressB).hash;

  console.log(`👤 Seller (Alice): ${addressA.slice(0, 15)}...${addressA.slice(-8)}`);
  console.log(`👤 Buyer  (Bob):   ${addressB.slice(0, 15)}...${addressB.slice(-8)}\n`);

  // ---------------------------------------------------------------------------
  // STEP 1: Alice creates an Option Vault
  // ---------------------------------------------------------------------------
  console.log("1. Alice creates American Option offering 4 TST for 1.0 tADA each...");
  const depositAmount = 4n;
  const strikePrice: Rational = { numerator: 1_000_000n, denominator: 1n }; // 1.0 ADA
  const now = Date.now();
  const expirationMs = now + 30 * 60_000; // 30 minutes

  const createRes = await createOption(lucidA, {
    depositAsset: TST_ASSET,
    paymentAsset: ADA_OPTION_ASSET,
    depositAmount,
    strikePrice,
    style: "American",
    expirationTimeMs: expirationMs,
    sellerAddress: addressA,
  });

  console.log(`   ✔ Option Mint Tx Submitted: ${createRes.txHash}`);
  console.log(`     Option Token: ${createRes.optionUnit}`);
  console.log(`     Position NFT: ${createRes.nftUnit}`);
  console.log("   Waiting for confirmation on-chain...");

  await lucidA.awaitTx(createRes.txHash);
  await waitForWalletUtxo(lucidA, createRes.txHash);
  let scriptUtxo = await waitForScriptUtxo(lucidA, createRes.txHash, 0);
  console.log(`   ✔ Option Script UTxO confirmed: ${scriptUtxo.txHash}#${scriptUtxo.outputIndex}`);

  let utxosA = await lucidA.wallet().getUtxos();
  const aliceOptBal = getAssetBalance(utxosA, createRes.optionUnit);
  assert.equal(aliceOptBal, 4n, "Alice must hold 4 Option tokens");
  console.log(`   ✔ Alice holds ${aliceOptBal} Option tokens in wallet\n`);

  // Build OptionPosition representation
  const position: OptionPosition = {
    utxoRef: { txHash: scriptUtxo.txHash, outputIndex: scriptUtxo.outputIndex },
    datum: createRes.datum,
    optionUnit: createRes.optionUnit,
    nftUnit: createRes.nftUnit,
    tokenNameHex: createRes.tokenName,
    tokenNameDisplay: "OPT-TST-ADA",
    depositUnit: TST_UNIT,
    depositSymbol: "TST",
    depositDecimals: 0,
    paymentUnit: "lovelace",
    paymentSymbol: "tADA",
    paymentDecimals: 6,
    totalMinted: 4n,
    remainingDeposit: 4n,
    strikePriceRational: strikePrice,
    strikePriceNumber: 1.0,
    strikePriceDisplay: "1.00 tADA / TST",
    startTimeMs: now,
    expirationTimeMs: expirationMs,
    cancelCutoffMs: expirationMs,
    style: "American",
    isExercisable: true,
    isExpired: false,
    canCancelEarly: true,
    isUserWriter: true,
    userOptionBalance: 4n,
    userUnsoldBalance: 4n,
    accumulatedStrikePayment: 0n,
    sellerPkh: pkhA,
    utxo: scriptUtxo,
  };

  // ---------------------------------------------------------------------------
  // STEP 2: Alice lists 2 Options on the Genius Yield DEX orderbook
  // ---------------------------------------------------------------------------
  console.log("2. Alice lists 2 Option tokens on Genius Yield DEX orderbook...");
  console.log("   - Quote Currency: tADA (decoupled from strike)");
  console.log("   - Asking Price:   2.5 tADA per option (total asking: 5.0 tADA)");

  const tradingPair = createOptionTradingPair(position, "preprod", "lovelace");
  assert.equal(tradingPair.quoteToken.symbol, "tADA", "Quote token must default to tADA");

  const listRes = await placeLimitOrder(lucidA, {
    pair: tradingPair,
    offerAsset: "base",
    offerAmount: 2, // 2 option tokens
    askAmount: 5.0, // 5.0 tADA total (2.5 tADA / opt)
  });

  console.log(`   ✔ DEX Limit Sell Order Submitted: ${listRes.txHash}`);
  console.log("   Waiting for confirmation on-chain...");

  await lucidA.awaitTx(listRes.txHash);
  await waitForWalletUtxo(lucidA, listRes.txHash);
  console.log("   ✔ DEX Order confirmed on-chain!\n");

  // ---------------------------------------------------------------------------
  // STEP 3: Verify Option Marketplace Indexing (fetchOptionMarketListings)
  // ---------------------------------------------------------------------------
  console.log("3. Querying Option Marketplace listings via fetchOptionMarketListings...");
  const listings = await fetchOptionMarketListings(lucidA, "preprod", [position], [pkhA]);
  const matchingListing = listings.find((l) => l.optionUnit.toLowerCase() === createRes.optionUnit.toLowerCase());

  assert.ok(matchingListing, "Must find DEX listing matching newly created option token");
  assert.equal(matchingListing.offeredAmount, 2n, "Listing must offer 2 option tokens");
  assert.equal(matchingListing.quoteSymbol, "tADA", "Listing quote currency must be tADA");
  assert.equal(matchingListing.pricePerOption, 2.5, "pricePerOption must equal 2.5 tADA");
  assert.equal(matchingListing.isUserSeller, true, "Alice must be identified as seller");
  assert.ok(matchingListing.matchingPosition, "Listing must link to matching OptionPosition");
  console.log(`   ✔ Found active listing for ${matchingListing.offeredAmount} options @ ${matchingListing.pricePerOption} ${matchingListing.quoteSymbol}/opt!`);
  console.log(`   ✔ Marketplace indexing and position matching verified!\n`);

  // ---------------------------------------------------------------------------
  // STEP 4: Bob buys 1 Option token from DEX (fillDexOrder)
  // ---------------------------------------------------------------------------
  console.log("4. Bob buys 1 Option token from Alice's DEX listing (fillDexOrder)...");
  console.log("   - Fill Amount: 1 option token");
  console.log("   - Cost:        2.5 tADA + 1.0 ADA DEX fee");

  const utxosBBegin = await lucidB.wallet().getUtxos();
  const bobOptBefore = getAssetBalance(utxosBBegin, createRes.optionUnit);

  const fillRes = await fillDexOrder(lucidB, {
    order: matchingListing.order,
    fillAmount: 1n, // Partial fill: 1 out of 2 options
  });

  console.log(`   ✔ Fill Order Tx Submitted: ${fillRes.txHash}`);
  console.log("   Waiting for confirmation on-chain...");

  await lucidB.awaitTx(fillRes.txHash);
  await waitForWalletUtxo(lucidB, fillRes.txHash);

  const utxosBAfter = await lucidB.wallet().getUtxos();
  const bobOptAfter = getAssetBalance(utxosBAfter, createRes.optionUnit);
  assert.equal(bobOptAfter, bobOptBefore + 1n, "Bob must receive 1 Option token from DEX");
  console.log(`   ✔ Bob received 1 Option token from DEX order fill!\n`);

  // ---------------------------------------------------------------------------
  // STEP 5: Bob exercises his purchased Option token on-chain (executeOption)
  // ---------------------------------------------------------------------------
  console.log("5. Bob exercises his purchased Option token on-chain...");
  const tstBBefore = getAssetBalance(utxosBAfter, TST_UNIT);

  const execRes = await executeOption(lucidB, {
    optionUtxo: scriptUtxo,
    amountToExecute: 1n,
    buyerAddress: addressB,
  });

  console.log(`   ✔ Execute Option Tx Submitted: ${execRes.txHash}`);
  console.log("   Waiting for confirmation on-chain...");

  await lucidB.awaitTx(execRes.txHash);
  await waitForWalletUtxo(lucidB, execRes.txHash);

  const utxosBFinal = await lucidB.wallet().getUtxos();
  const tstBFinal = getAssetBalance(utxosBFinal, TST_UNIT);
  assert.equal(tstBFinal, tstBBefore + 1n, "Bob must receive 1 TST collateral");
  console.log(`   ✔ Bob successfully exercised option and claimed 1 TST collateral!\n`);

  // ---------------------------------------------------------------------------
  // STEP 6: Alice cancels remaining DEX listing (cancelLimitOrder)
  // ---------------------------------------------------------------------------
  console.log("6. Alice cancels remaining DEX listing to reclaim unsold option token...");

  // Re-fetch remaining DEX order
  const updatedListings = await fetchOptionMarketListings(lucidA, "preprod", [position], [pkhA]);
  const remListing = updatedListings.find((l) => l.optionUnit.toLowerCase() === createRes.optionUnit.toLowerCase());
  assert.ok(remListing, "Must find partially filled remaining order on DEX");
  assert.equal(remListing.offeredAmount, 1n, "Remaining order must have 1 option token left");

  const cancelDexRes = await cancelLimitOrder(lucidA, remListing.order);
  console.log(`   ✔ DEX Cancel Tx Submitted: ${cancelDexRes.txHash}`);
  console.log("   Waiting for confirmation on-chain...");

  await lucidA.awaitTx(cancelDexRes.txHash);
  await waitForWalletUtxo(lucidA, cancelDexRes.txHash);

  utxosA = await lucidA.wallet().getUtxos();
  const aliceOptAfterDexCancel = getAssetBalance(utxosA, createRes.optionUnit);
  // Alice had 2 unlisted + 1 reclaimed from DEX = 3 option tokens
  assert.equal(aliceOptAfterDexCancel, 3n, "Alice must hold 3 Option tokens after DEX cancel");
  console.log(`   ✔ Alice reclaimed unsold option token and ~2.0 ADA maker deposit!\n`);

  // ---------------------------------------------------------------------------
  // STEP 7: Alice cancels remaining unsold options (cancelEarlyOption)
  // ---------------------------------------------------------------------------
  console.log("7. Alice cancels remaining 3 unsold options (cancelEarlyOption)...");

  // Get the latest continuing script UTxO (after Bob's execution)
  scriptUtxo = await waitForScriptUtxo(lucidA, execRes.txHash, 0);

  const cancelFinalRes = await cancelEarlyOption(lucidA, {
    optionUtxo: scriptUtxo,
    sellerAddress: addressA,
    amountToCancel: 3n,
  });

  console.log(`   ✔ Final Option Cancellation Tx Submitted: ${cancelFinalRes.txHash}`);
  console.log("   Waiting for confirmation on-chain...");

  await lucidA.awaitTx(cancelFinalRes.txHash);
  await waitForWalletUtxo(lucidA, cancelFinalRes.txHash);

  utxosA = await lucidA.wallet().getUtxos();
  const aliceOptFinal = getAssetBalance(utxosA, createRes.optionUnit);
  assert.equal(aliceOptFinal, 0n, "Alice must have 0 option tokens remaining");
  console.log(`   ✔ Alice successfully reclaimed remaining 3 TST deposit + 3 tADA minAda!`);
  console.log(`   ✔ Position NFT burned and position cleanly closed!`);

  console.log("\n========================================================================");
  console.log("  🎉 OPTION MARKETPLACE PREPROD INTEGRATION COMPLETED WITH 100% SUCCESS!");
  console.log("========================================================================\n");
}

main().catch((err) => {
  console.error("\n❌ Marketplace Preprod Integration Test Failed:", err);
  process.exit(1);
});
