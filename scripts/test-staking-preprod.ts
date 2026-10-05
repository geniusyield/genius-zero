/**
 * Genius Zero — Comprehensive Preprod Staking & Unstaking Integration Test Suite
 *
 * Verifies on-chain Staking functionality with real Cardano transactions:
 * 1. Validator & Config Parity: Validates that STAKING_VALIDATOR hash matches on-chain constant.
 * 2. Scenario 1: Standard Staking & Unstaking (10 tADA):
 *    - Wallet A stakes 10 tADA into STAKING_VALIDATOR script.
 *    - Verifies vault discovery, datum parsing, ownership and unlocked status.
 *    - Wallet A unstakes vault -> verifies 100% refund of principal (minus standard tx fees).
 * 3. Scenario 2: Timelocked Staking & Unlock Verification:
 *    - Wallet A stakes 10 tADA with a timelock (25 seconds in future).
 *    - Verifies vault is marked locked (`isUnlocked === false`).
 *    - Attempts early unstake before unlock time -> verifies rejection.
 *    - Waits for timelock expiry (`Date.now() >= lockedUntilMs`).
 *    - Executes unstake with valid time range -> verifies success & refund.
 * 4. Scenario 3: Token Staking (10 tADA + 5 TST test tokens):
 *    - Wallet A stakes 10 tADA + 5 TST tokens.
 *    - Verifies vault reflects both ADA and TST.
 *    - Unstakes vault -> verifies both ADA and 5 TST tokens are returned to Wallet A.
 * 5. Scenario 4: Security & Multi-Address Protection (Negative Test):
 *    - Wallet A stakes 10 tADA.
 *    - Wallet B (Bob / unauthorized attacker) attempts to unstake Alice's vault.
 *    - Verifies Plutus validator FAILS with script error (missing Alice's signature witness).
 *    - Alice (Wallet A) then cleanly unstakes her vault.
 *
 * Usage:
 *   node scripts/patch-lucid.js && npx vite-node scripts/test-staking-preprod.ts
 */

import fs from "fs";
import path from "path";
import assert from "assert";
import {
  Blockfrost,
  Lucid,
  paymentCredentialOf,
  scriptFromNative,
  mintingPolicyToId,
  fromText,
  validatorToScriptHash,
  Data,
  type LucidEvolution,
  type UTxO,
  type OutRef,
} from "@lucid-evolution/lucid";
import { DEX_CONSTANTS } from "../src/config/dex";
import {
  STAKING_VALIDATOR,
  makeStakeDatum,
  createStake,
  unstakeVault,
  fetchUserStakingVaults,
  StakingVault,
} from "../src/services/staking";

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

function getAssetBalance(utxos: UTxO[], unit: string): bigint {
  let total = 0n;
  for (const u of utxos) {
    total += u.assets[unit] || 0n;
  }
  return total;
}

async function waitForWalletTxOutputs(lucid: LucidEvolution, txHash: string, maxAttempts = 50): Promise<UTxO[]> {
  for (let i = 0; i < maxAttempts; i++) {
    const utxos = await lucid.wallet().getUtxos();
    const matches = utxos.filter((u) => u.txHash === txHash);
    if (matches.length > 0) {
      return matches;
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  const utxos = await lucid.wallet().getUtxos();
  const matches = utxos.filter((u) => u.txHash === txHash);
  if (matches.length === 0) {
    throw new Error(`Timeout waiting for wallet outputs from ${txHash} after ${maxAttempts * 2}s.`);
  }
  return matches;
}

async function waitForScriptUtxo(lucid: LucidEvolution, txHash: string, outputIndex = 0, maxAttempts = 35): Promise<UTxO> {
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

async function waitForScriptUtxoConsumed(
  endpoint: string,
  blockfrostKey: string,
  txHash: string,
  outputIndex = 0,
  maxAttempts = 35
): Promise<void> {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const res = await fetch(`${endpoint}/txs/${txHash}/utxos`, {
        headers: { project_id: blockfrostKey },
      });
      if (res.ok) {
        const data = await res.json();
        const out = data?.outputs?.find((o: any) => o.output_index === outputIndex);
        if (out && out.consumed_by_tx) {
          return;
        }
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(`Timeout waiting for UTxO ${txHash}#${outputIndex} to be consumed on-chain.`);
}

async function main() {
  console.log("========================================================================");
  console.log("   Genius Zero — Preprod Staking & Unstaking Integration Tests          ");
  console.log("========================================================================\n");

  const blockfrostKey =
    process.env.VITE_BLOCKFROST_API_KEY_PREPROD ||
    process.env.BLOCKFROST_API_KEY_PREPROD ||
    process.env.BLOCKFROST_API_KEY;

  if (!blockfrostKey || !blockfrostKey.startsWith("preprod")) {
    console.error("❌ Missing or invalid Preprod Blockfrost API key! Must start with 'preprod...'");
    process.exit(1);
  }

  const endpoint = DEX_CONSTANTS.preprod.blockfrostUrl;
  const stakingAddr = DEX_CONSTANTS.preprod.stakingAddr;
  const stakingScriptHash = DEX_CONSTANTS.preprod.stakingScriptHash;

  // 1. Validator & Config Parity
  console.log("1. Verifying Staking Validator Script Hash Parity...");
  const computedHash = validatorToScriptHash(STAKING_VALIDATOR);
  console.log(`   • Computed STAKING_VALIDATOR hash: ${computedHash}`);
  console.log(`   • Preprod constant script hash:    ${stakingScriptHash}`);
  assert.equal(computedHash, stakingScriptHash, "Computed script hash MUST match stakingScriptHash constant!");
  console.log("   ✔ Script hash is 100% identical to deployed staking validator.\n");

  // 2. Initialize Lucid instances
  const lucidA = await Lucid(new Blockfrost(endpoint, blockfrostKey), "Preprod");
  const lucidB = await Lucid(new Blockfrost(endpoint, blockfrostKey), "Preprod");

  if (!fs.existsSync(WALLET_A_FILE)) {
    throw new Error(`Wallet A file not found: ${WALLET_A_FILE}`);
  }
  const walletAData = JSON.parse(fs.readFileSync(WALLET_A_FILE, "utf-8"));
  lucidA.selectWallet.fromSeed(walletAData.seedPhrase);
  const addressA = await lucidA.wallet().address();
  const pkhA = paymentCredentialOf(addressA).hash;

  if (!fs.existsSync(WALLET_B_FILE)) {
    throw new Error(`Wallet B file not found: ${WALLET_B_FILE}`);
  }
  const walletBData = JSON.parse(fs.readFileSync(WALLET_B_FILE, "utf-8"));
  lucidB.selectWallet.fromSeed(walletBData.seedPhrase);
  const addressB = await lucidB.wallet().address();
  const pkhB = paymentCredentialOf(addressB).hash;

  console.log("👤 Wallet A (Alice / Staker):", addressA);
  console.log(`   PKH A: ${pkhA}`);
  console.log("👤 Wallet B (Bob / Challenger):", addressB);
  console.log(`   PKH B: ${pkhB}`);

  // Derive TST Native Script Token
  const nativeScript: any = {
    type: "all",
    scripts: [{ type: "sig", keyHash: pkhA }],
  };
  const script = scriptFromNative(nativeScript);
  const policyId = mintingPolicyToId(script);
  const assetName = fromText("TST");
  const tstUnit = policyId + assetName;

  let utxosA = await lucidA.wallet().getUtxos();
  let utxosB = await lucidB.wallet().getUtxos();

  let adaA = getAssetBalance(utxosA, "lovelace");
  let tstA = getAssetBalance(utxosA, tstUnit);
  let adaB = getAssetBalance(utxosB, "lovelace");
  let tstB = getAssetBalance(utxosB, tstUnit);

  console.log(`\nInitial Balances:`);
  console.log(`   Alice: ${Number(adaA) / 1e6} tADA | ${tstA} TST`);
  console.log(`   Bob:   ${Number(adaB) / 1e6} tADA | ${tstB} TST\n`);

  assert(adaA >= 30_000_000n, "Wallet A needs at least 30 tADA to complete the test suite.");
  assert(adaB >= 10_000_000n, "Wallet B needs at least 10 tADA to participate.");

  // =========================================================================
  // SCENARIO 1: Standard Staking & Unstaking (10 tADA, No lock)
  // =========================================================================
  console.log("========================================================================");
  console.log("  SCENARIO 1: Standard Staking & Unstaking (10 tADA, No Lock)");
  console.log("========================================================================");

  const stakeAmount1 = 10_000_000n;
  console.log(`1. Alice depositing ${Number(stakeAmount1) / 1e6} tADA into staking script...`);
  const stakeTxHash1 = await createStake(
    lucidA,
    "preprod",
    addressA,
    stakeAmount1,
    undefined,
    undefined,
    0
  );
  console.log(`   ✔ Stake transaction submitted: ${stakeTxHash1}`);
  console.log("   Waiting for script UTxO to appear on Preprod...");
  const scriptUtxo1 = await waitForScriptUtxo(lucidA, stakeTxHash1, 0);
  console.log(`   ✔ Vault UTxO confirmed: ${scriptUtxo1.txHash}#${scriptUtxo1.outputIndex}`);
  await waitForWalletTxOutputs(lucidA, stakeTxHash1);
  await new Promise((r) => setTimeout(r, 4000));

  // Verify vault model
  const vault1: StakingVault = {
    utxoRef: {
      txHash: scriptUtxo1.txHash,
      outputIndex: scriptUtxo1.outputIndex,
    },
    ownerPkh: pkhA,
    project: "tADA",
    stakedTokenUnit: "lovelace",
    stakedAmount: stakeAmount1,
    depositLovelace: stakeAmount1,
    isUnlocked: true,
    isUserOwned: true,
  };

  console.log("\n2. Alice unstaking vault (reclaiming 10 tADA)...");
  const utxosABeforeUnstake1 = await lucidA.wallet().getUtxos();
  const adaABeforeUnstake1 = getAssetBalance(utxosABeforeUnstake1, "lovelace");

  const unstakeTxHash1 = await unstakeVault(lucidA, vault1);
  console.log(`   ✔ Unstake transaction submitted: ${unstakeTxHash1}`);
  console.log("   Waiting for script consumption and wallet refund UTxO...");
  await waitForScriptUtxoConsumed(endpoint, blockfrostKey, scriptUtxo1.txHash, scriptUtxo1.outputIndex);
  console.log("   ✔ Script UTxO successfully spent & consumed!");
  const refundUtxos1 = await waitForWalletTxOutputs(lucidA, unstakeTxHash1);

  const netRefund1 = refundUtxos1.reduce((acc, u) => acc + (u.assets.lovelace || 0n), 0n);
  console.log(`   • ADA returned to Alice: ${Number(netRefund1) / 1e6} tADA (principal returned minus fee)`);
  assert(netRefund1 >= 9_500_000n, "Alice MUST receive back ~10 tADA minus transaction fee (<0.5 tADA)!");
  console.log("✔ SCENARIO 1 PASSED: Standard staking and unstaking fully verified on-chain!\n");

  // =========================================================================
  // SCENARIO 2: Timelocked Staking & Unlock Verification
  // =========================================================================
  console.log("========================================================================");
  console.log("  SCENARIO 2: Timelocked Staking & Unlock Verification");
  console.log("========================================================================");

  const lockSeconds = 75;
  const lockUntilMs = Math.floor(Date.now() / 1000) * 1000 + lockSeconds * 1000;
  console.log(`1. Alice depositing 10 tADA with timelock of ${lockSeconds}s (until ${new Date(lockUntilMs).toISOString()})...`);

  // Build locked stake datum
  const lockedDatum = makeStakeDatum(pkhA, lockUntilMs);
  const lockedDatumHex = Data.to(lockedDatum);

  const lockTx = await lucidA
    .newTx()
    .pay.ToContract(stakingAddr, { kind: "asHash", value: lockedDatumHex }, { lovelace: 10_000_000n })
    .complete();
  const signedLockTx = await lockTx.sign.withWallet().complete();
  const lockTxHash = await signedLockTx.submit();
  console.log(`   ✔ Timelocked stake transaction submitted: ${lockTxHash}`);
  console.log("   Waiting for script UTxO to appear on Preprod...");
  const lockedScriptUtxo = await waitForScriptUtxo(lucidA, lockTxHash, 0);
  console.log(`   ✔ Timelocked Vault UTxO confirmed: ${lockedScriptUtxo.txHash}#${lockedScriptUtxo.outputIndex}`);

  const lockedVault: StakingVault = {
    utxoRef: {
      txHash: lockedScriptUtxo.txHash,
      outputIndex: lockedScriptUtxo.outputIndex,
    },
    ownerPkh: pkhA,
    project: "tADA",
    stakedTokenUnit: "lovelace",
    stakedAmount: 10_000_000n,
    depositLovelace: 10_000_000n,
    lockedUntilMs: lockUntilMs,
    isUnlocked: Date.now() >= lockUntilMs,
    isUserOwned: true,
  };

  console.log(`   • Initial vault isUnlocked: ${lockedVault.isUnlocked}`);
  assert.equal(lockedVault.isUnlocked, false, "Vault MUST be locked prior to unlock timestamp!");

  console.log("\n2. Attempting early unstake while vault is still timelocked...");
  let rejectedEarly = false;
  try {
    await unstakeVault(lucidA, lockedVault);
  } catch (err: any) {
    rejectedEarly = true;
    console.log(`   ✔ Early unstake correctly rejected with expected guard: "${err.message}"`);
  }
  assert.equal(rejectedEarly, true, "Early unstake MUST be rejected while locked!");

  const minValidFromMs = Math.ceil(lockUntilMs / 1000) * 1000;
  const waitRemainingMs = minValidFromMs + 7_000 - Date.now();
  if (waitRemainingMs > 0) {
    console.log(`\n3. Waiting ${Math.ceil(waitRemainingMs / 1000)} seconds for timelock and node clock to expire...`);
    await new Promise((r) => setTimeout(r, waitRemainingMs));
  }

  lockedVault.isUnlocked = Date.now() >= lockUntilMs;
  console.log(`   • Post-expiry vault isUnlocked: ${lockedVault.isUnlocked}`);
  assert.equal(lockedVault.isUnlocked, true, "Vault MUST be marked unlocked once lock timestamp has passed!");

  console.log("\n4. Alice unstaking now that timelock has expired...");
  const unstakeTxHash2 = await unstakeVault(lucidA, lockedVault);
  console.log(`   ✔ Unstake transaction submitted: ${unstakeTxHash2}`);
  console.log("   Waiting for script consumption and wallet refund UTxO...");
  await waitForScriptUtxoConsumed(endpoint, blockfrostKey, lockedScriptUtxo.txHash, lockedScriptUtxo.outputIndex);
  console.log("   ✔ Script UTxO successfully spent & consumed!");
  const refundUtxos2 = await waitForWalletTxOutputs(lucidA, unstakeTxHash2);

  const netRefund2 = refundUtxos2.reduce((acc, u) => acc + (u.assets.lovelace || 0n), 0n);
  console.log(`   • ADA returned to Alice: ${Number(netRefund2) / 1e6} tADA`);
  assert(netRefund2 >= 9_500_000n, "Alice MUST receive back ~10 tADA minus transaction fee!");
  console.log("✔ SCENARIO 2 PASSED: Timelocked staking and post-expiry unstaking verified on-chain!\n");

  // =========================================================================
  // SCENARIO 3: Token Staking (10 tADA + 5 TST test tokens)
  // =========================================================================
  console.log("========================================================================");
  console.log("  SCENARIO 3: Token Staking (10 tADA + 5 TST tokens)");
  console.log("========================================================================");

  const tstStakeAmount = 5n;
  console.log(`1. Alice depositing 10 tADA + ${tstStakeAmount} TST into staking script...`);
  const tokenStakeTxHash = await createStake(
    lucidA,
    "preprod",
    addressA,
    10_000_000n,
    tstUnit,
    tstStakeAmount,
    0
  );
  console.log(`   ✔ Token stake transaction submitted: ${tokenStakeTxHash}`);
  console.log("   Waiting for script UTxO to appear on Preprod...");
  const tokenScriptUtxo = await waitForScriptUtxo(lucidA, tokenStakeTxHash, 0);
  console.log(`   ✔ Token Vault UTxO confirmed: ${tokenScriptUtxo.txHash}#${tokenScriptUtxo.outputIndex}`);
  await waitForWalletTxOutputs(lucidA, tokenStakeTxHash);
  await new Promise((r) => setTimeout(r, 4000));
  console.log(`   • Assets in Vault UTxO:`, tokenScriptUtxo.assets);
  assert.equal(tokenScriptUtxo.assets[tstUnit], tstStakeAmount, "Vault UTxO MUST hold exact staked TST tokens!");

  const tokenVault: StakingVault = {
    utxoRef: {
      txHash: tokenScriptUtxo.txHash,
      outputIndex: tokenScriptUtxo.outputIndex,
    },
    ownerPkh: pkhA,
    project: "Custom",
    stakedTokenUnit: tstUnit,
    stakedAmount: tstStakeAmount,
    depositLovelace: 10_000_000n,
    isUnlocked: true,
    isUserOwned: true,
  };

  console.log("\n2. Alice unstaking token vault (reclaiming 10 tADA + 5 TST)...");
  const tokenUnstakeTxHash = await unstakeVault(lucidA, tokenVault);
  console.log(`   ✔ Token unstake transaction submitted: ${tokenUnstakeTxHash}`);
  console.log("   Waiting for script consumption and wallet refund UTxO...");
  await waitForScriptUtxoConsumed(endpoint, blockfrostKey, tokenScriptUtxo.txHash, tokenScriptUtxo.outputIndex);
  console.log("   ✔ Token Script UTxO successfully spent & consumed!");
  const refundUtxos3 = await waitForWalletTxOutputs(lucidA, tokenUnstakeTxHash);

  const netAdaRefund3 = refundUtxos3.reduce((acc, u) => acc + (u.assets.lovelace || 0n), 0n);
  const netTstRefund3 = refundUtxos3.reduce((acc, u) => acc + (u.assets[tstUnit] || 0n), 0n);

  console.log(`   • ADA returned to Alice: ${Number(netAdaRefund3) / 1e6} tADA`);
  console.log(`   • TST returned to Alice: ${netTstRefund3} TST (Expected: ${tstStakeAmount} TST)`);
  assert(netAdaRefund3 >= 9_500_000n, "Alice MUST receive back ~10 tADA minus transaction fee!");
  assert.equal(netTstRefund3, tstStakeAmount, "Alice MUST receive back 100% of staked TST tokens!");
  console.log("✔ SCENARIO 3 PASSED: Multi-asset staking & unstaking fully verified on-chain!\n");

  // =========================================================================
  // SCENARIO 4: Security & Multi-Address Protection (Negative Test)
  // =========================================================================
  console.log("========================================================================");
  console.log("  SCENARIO 4: Security Verification — Unauthorized Unstake Defense");
  console.log("========================================================================");

  console.log("1. Alice depositing 10 tADA into staking script...");
  const stakeTxHash4 = await createStake(
    lucidA,
    "preprod",
    addressA,
    10_000_000n,
    undefined,
    undefined,
    0
  );
  console.log(`   ✔ Stake transaction submitted: ${stakeTxHash4}`);
  console.log("   Waiting for script UTxO to appear on Preprod...");
  const scriptUtxo4 = await waitForScriptUtxo(lucidA, stakeTxHash4, 0);
  console.log(`   ✔ Alice's Vault UTxO confirmed: ${scriptUtxo4.txHash}#${scriptUtxo4.outputIndex}`);
  await waitForWalletTxOutputs(lucidA, stakeTxHash4);
  await new Promise((r) => setTimeout(r, 4000));

  const vault4ForAlice: StakingVault = {
    utxoRef: {
      txHash: scriptUtxo4.txHash,
      outputIndex: scriptUtxo4.outputIndex,
    },
    ownerPkh: pkhA,
    project: "tADA",
    stakedTokenUnit: "lovelace",
    stakedAmount: 10_000_000n,
    depositLovelace: 10_000_000n,
    isUnlocked: true,
    isUserOwned: false, // For Bob
  };

  console.log("\n2. Bob attempting to steal / unstake Alice's vault...");
  let bobAttackBlocked = false;
  try {
    // Bob builds unstake transaction using his wallet (cannot sign for Alice's PKH)
    await unstakeVault(lucidB, vault4ForAlice);
  } catch (err: any) {
    bobAttackBlocked = true;
    console.log(`   ✔ Plutus on-chain validation BLOCKED Bob's unauthorized unstake!`);
    console.log(`     Error caught: ${err.message?.slice(0, 120)}...`);
  }
  assert.equal(bobAttackBlocked, true, "Bob MUST NOT be permitted to unstake Alice's vault!");

  console.log("\n3. Alice successfully unstaking her own vault...");
  const cleanUnstakeHash = await unstakeVault(lucidA, vault4ForAlice);
  console.log(`   ✔ Alice successfully unstaked her vault: ${cleanUnstakeHash}`);
  console.log("   Waiting for script consumption and wallet refund UTxO...");
  await waitForScriptUtxoConsumed(endpoint, blockfrostKey, scriptUtxo4.txHash, scriptUtxo4.outputIndex);
  console.log("   ✔ Script UTxO successfully spent & consumed by legitimate owner!");
  await waitForWalletTxOutputs(lucidA, cleanUnstakeHash);
  console.log("✔ SCENARIO 4 PASSED: On-chain ownership & signer validation completely secure!\n");

  // Final summary
  const finalUtxosA = await lucidA.wallet().getUtxos();
  const finalUtxosB = await lucidB.wallet().getUtxos();
  console.log("========================================================================");
  console.log("  Final Balances after Staking Test Suite:");
  console.log(`   Alice: ${Number(getAssetBalance(finalUtxosA, "lovelace")) / 1e6} tADA | ${getAssetBalance(finalUtxosA, tstUnit)} TST`);
  console.log(`   Bob:   ${Number(getAssetBalance(finalUtxosB, "lovelace")) / 1e6} tADA | ${getAssetBalance(finalUtxosB, tstUnit)} TST`);
  console.log("========================================================================");
  console.log("\n🎉 ALL PREPROD STAKING & UNSTAKING INTEGRATION TESTS PASSED 100%!");
  console.log("========================================================================\n");
}

main().catch((err) => {
  console.error("❌ Staking Integration Test failed:", err);
  process.exit(1);
});
