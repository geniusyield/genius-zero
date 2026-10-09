import { Lucid, Blockfrost } from "@lucid-evolution/lucid";
import { DEX_CONSTANTS } from "../src/config/dex";
import { fetchAllLiquidityVaults } from "../src/services/liquidity";

async function run() {
  const bfKey = "";
  const lucid = await Lucid(new Blockfrost(DEX_CONSTANTS.mainnet.blockfrostUrl, bfKey), "Mainnet");
  const allVaults = await fetchAllLiquidityVaults(lucid, "mainnet");
  console.log(`Found ${allVaults.length} vaults.`);
  for (const v of allVaults) {
    const amtA = Number(v.amountA) / 1e6;
    const amtB = Number(v.amountB) / 1e6;
    if (
      Math.abs(amtA - 3.01) < 0.2 ||
      Math.abs(amtB - 3.01) < 0.2 ||
      Math.abs(amtA - 0.03) < 0.02 ||
      Math.abs(amtB - 0.03) < 0.02 ||
      v.fixedPrice?.priceAtoB === 100 ||
      v.fixedPrice?.priceBtoA === 100
    ) {
      console.log(`\nMATCH: ${v.utxoRef.txHash}#${v.utxoRef.outputIndex}`);
      console.log(`  TokenA: ${v.tokenA.symbol} (${v.amountA} = ${amtA})`);
      console.log(`  TokenB: ${v.tokenB.symbol} (${v.amountB} = ${amtB})`);
      console.log(`  Pricing: ${v.pricingType}`);
      if (v.fixedPrice) console.log(`  Fixed:`, v.fixedPrice);
      if (v.oracleDelta) console.log(`  Oracle:`, v.oracleDelta);
    }
  }
}
run().catch(console.error);
