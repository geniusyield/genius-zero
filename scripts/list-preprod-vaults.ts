import { Lucid, Blockfrost } from "@lucid-evolution/lucid";
import { DEX_CONSTANTS } from "../src/config/dex";
import { fetchAllLiquidityVaults } from "../src/services/liquidity";

async function main() {
  const bfKey = ""; // or get from .env
  const env = (await import("fs")).readFileSync(".env", "utf-8");
  const key = env.match(/BLOCKFROST_API_KEY_PREPROD=(.*)/)?.[1]?.trim();
  const lucid = await Lucid(new Blockfrost(DEX_CONSTANTS.preprod.blockfrostUrl, key!), "Preprod");
  const allVaults = await fetchAllLiquidityVaults(lucid, "preprod");

  console.log(`Found ${allVaults.length} vaults on Preprod.`);
  for (const v of allVaults) {
    const amtA = Number(v.amountA) / 1e6;
    const amtB = Number(v.amountB) / 1e6;
    console.log(`\nVault: ${v.utxoRef.txHash}#${v.utxoRef.outputIndex}`);
    console.log(`  TokenA: ${v.tokenA.symbol} (${v.amountA} = ${amtA})`);
    console.log(`  TokenB: ${v.tokenB.symbol} (${v.amountB} = ${amtB})`);
    console.log(`  Pricing: ${v.pricingType}`);
    if (v.fixedPrice) console.log(`  Fixed:`, v.fixedPrice);
    if (v.oracleDelta) console.log(`  Oracle:`, v.oracleDelta);
  }
}

main().catch(console.error);
