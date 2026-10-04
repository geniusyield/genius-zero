import { Blockfrost, Lucid } from "@lucid-evolution/lucid";
import { DEX_CONSTANTS, DEFAULT_MAINNET_TRADING_PAIRS } from "../src/config/dex";
import { fetchAllActiveParsedOrders, fetchAllOrdersForPair } from "../src/services/orderbook";

async function checkMainnet() {
  const key = "mainnetYourApiKeyHere";
  const lucid = await Lucid(new Blockfrost("https://cardano-mainnet.blockfrost.io/api/v0", key), "Mainnet");
  const constants = DEX_CONSTANTS.mainnet;
  const valCred = {
    type: "Script" as const,
    hash: constants.valCredHash,
  };
  console.log("Querying utxosAt(valCred)...");
  console.log("valCredHash:", constants.valCredHash);
  console.log("mintPolicyId:", constants.mintPolicyId);
  const utxos = await lucid.utxosAt(valCred);
  console.log("Total UTxOs at swap script:", utxos.length);

  const orderUtxos = utxos.filter((utxo) =>
    Object.keys(utxo.assets).some(
      (unit) =>
        unit.startsWith(constants.mintPolicyId) &&
        unit.length === constants.mintPolicyId.length + 64
    )
  );
  console.log("UTxOs containing tracking NFT:", orderUtxos.length);

  if (orderUtxos.length > 0) {
    console.log("First 3 order UTxOs:");
    for (let i = 0; i < Math.min(3, orderUtxos.length); i++) {
      console.log(`  [${i}]`, orderUtxos[i].txHash + "#" + orderUtxos[i].outputIndex, orderUtxos[i].assets);
    }
  }

  console.log("\nParsing active orders...");
  const parsed = await fetchAllActiveParsedOrders(lucid, "mainnet", (p) => {
    console.log(`  Progress: ${p.stage} (${p.current}/${p.total})`);
  });
  console.log(`Total successfully parsed active orders on Mainnet: ${parsed.length}`);

  // Check which pairs these orders belong to
  const pairsFound = new Map<string, number>();
  for (const o of parsed) {
    const key = `${o.offeredAsset} <-> ${o.askedAsset}`;
    pairsFound.set(key, (pairsFound.get(key) || 0) + 1);
  }
  console.log("\nOrders by asset pair:");
  for (const [p, count] of pairsFound) {
    console.log(`  • ${p}: ${count} order(s)`);
  }

  // Check default trading pairs in config
  console.log("\nDefault Mainnet pairs in config:");
  for (const dp of DEFAULT_MAINNET_TRADING_PAIRS) {
    console.log(`  • Pair: ${dp.id} (${dp.baseToken.symbol}/${dp.quoteToken.symbol})`);
    console.log(`    Base:  ${dp.baseToken.unit}`);
    console.log(`    Quote: ${dp.quoteToken.unit}`);
    const book = await fetchAllOrdersForPair(lucid, "mainnet", dp);
    console.log(`    Bids: ${book.bids.length}, Asks: ${book.asks.length}`);
  }
}

checkMainnet().catch((err) => {
  console.error("Error inspecting Mainnet:", err);
});
