import fs from "fs";
import path from "path";
import { Blockfrost, Lucid } from "@lucid-evolution/lucid";
import { fetchAllLiquidityVaults } from "../src/services/liquidity";

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

async function main() {
  const key =
    process.env.VITE_BLOCKFROST_API_KEY_MAINNET ||
    process.env.BLOCKFROST_API_KEY_MAINNET;
  if (!key) {
    throw new Error("Missing BLOCKFROST_API_KEY_MAINNET.");
  }

  const lucid = await Lucid(
    new Blockfrost("https://cardano-mainnet.blockfrost.io/api/v0", key),
    "Mainnet"
  );

  console.log("Fetching liquidity vaults via service...");
  const vaults = await fetchAllLiquidityVaults(lucid, "mainnet");
  console.log(`Fetched ${vaults.length} vaults!\n`);

  console.log("--- RAW PAIRS (Before Normalization) ---");
  const rawMap = new Map<string, number>();
  for (const v of vaults) {
    const raw = `${v.tokenA.symbol} / ${v.tokenB.symbol}`;
    rawMap.set(raw, (rawMap.get(raw) || 0) + 1);
  }
  for (const [pair, count] of Array.from(rawMap.entries()).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${pair}: ${count}`);
  }

  console.log("\n--- CANONICAL PAIRS (Normalized) ---");
  const canMap = new Map<string, number>();
  for (const v of vaults) {
    const can = v.canonicalPair.pairKey;
    canMap.set(can, (canMap.get(can) || 0) + 1);
  }
  for (const [pair, count] of Array.from(canMap.entries()).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${pair}: ${count}`);
  }

  for (let i = 0; i < Math.min(vaults.length, 5); i++) {
    const v = vaults[i];
    console.log(`\n--- Vault #${i + 1} Canonical: [${v.canonicalPair.pairKey}] (Raw: ${v.tokenA.symbol} / ${v.tokenB.symbol}, reversed: ${v.canonicalPair.isReversed}) ---`);
    console.log(`UTxO: ${v.utxoRef.txHash}#${v.utxoRef.outputIndex}`);
    console.log(`Owner: ${v.ownerKey}`);
    console.log(`Reserves: ${v.canonicalPair.isReversed ? v.formattedAmountB : v.formattedAmountA} ${v.canonicalPair.base.symbol} | ${v.canonicalPair.isReversed ? v.formattedAmountA : v.formattedAmountB} ${v.canonicalPair.quote.symbol}`);
    console.log(`Type: ${v.pricingType}`);
    if (v.fixedPrice) {
      console.log(`  Price (A to B): ${v.fixedPrice.formattedAtoB}`);
      console.log(`  Price (B to A): ${v.fixedPrice.formattedBtoA}`);
    }
    if (v.oracleDelta) {
      console.log(`  Oracle Straight: ${v.oracleDelta.formattedStraight}`);
      if (v.oracleDelta.hasReverse) {
        console.log(`  Oracle Reverse:  ${v.oracleDelta.formattedReverse}`);
      }
    }
  }
}

main().catch(console.error);
