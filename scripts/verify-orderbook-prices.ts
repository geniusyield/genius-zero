import { Lucid, Blockfrost } from "@lucid-evolution/lucid";
import { DEX_CONSTANTS, DEFAULT_MAINNET_TRADING_PAIRS, PREPROD_TRADING_PAIRS } from "../src/config/dex";
import { fetchAllOrdersForPair } from "../src/services/orderbook";
import { calculateFillCost } from "../src/services/trade";
import fs from "fs";

async function verifyNetwork(network: "mainnet" | "preprod") {
  const env = fs.readFileSync(".env", "utf-8");
  const key = network === "mainnet"
    ? ""
    : env.match(/BLOCKFROST_API_KEY_PREPROD=(.*)/)?.[1]?.trim();

  const lucid = await Lucid(new Blockfrost(DEX_CONSTANTS[network].blockfrostUrl, key!), network === "mainnet" ? "Mainnet" : "Preprod");
  const pair = network === "mainnet" ? DEFAULT_MAINNET_TRADING_PAIRS[0] : PREPROD_TRADING_PAIRS[0];

  console.log(`\n==================================================`);
  console.log(`VERIFYING ${network.toUpperCase()} ORDER BOOK (${pair.baseToken.symbol} / ${pair.quoteToken.symbol})`);
  console.log(`==================================================`);

  const book = await fetchAllOrdersForPair(lucid, network, pair);
  console.log(`Found ${book.bids.length} bids, ${book.asks.length} asks.`);

  console.log("\n--- BIDS (User pays Base to get Quote) ---");
  for (const bid of book.bids) {
    if (bid.isVault) {
      const cost = calculateFillCost(bid, bid.offeredAmount);
      const getQuote = Number(cost.receiveAmount) / 1e6;
      const payBase = Number(cost.payAmount) / 1e6;
      const rate = getQuote > 0 ? payBase / getQuote : 0;
      console.log(`Vault Bid [${bid.vaultData?.pricingType}]: ${bid.utxoRef.txHash.slice(0, 10)}#${bid.utxoRef.outputIndex} dir=${bid.vaultDirection}`);
      console.log(`  Offered: ${getQuote.toFixed(4)} ${pair.quoteToken.symbol}`);
      console.log(`  Pay: ${payBase.toFixed(4)} ${pair.baseToken.symbol}`);
      console.log(`  Rate: 1 ${pair.quoteToken.symbol} = ${rate.toFixed(4)} ${pair.baseToken.symbol} (or 1 ${pair.baseToken.symbol} = ${(1/rate).toFixed(6)} ${pair.quoteToken.symbol})`);
      console.log(`  effPrice in book: ${bid.effectivePrice}`);
    }
  }

  console.log("\n--- ASKS (User pays Quote to get Base) ---");
  for (const ask of book.asks) {
    if (ask.isVault) {
      const cost = calculateFillCost(ask, ask.offeredAmount);
      const getBase = Number(cost.receiveAmount) / 1e6;
      const payQuote = Number(cost.payAmount) / 1e6;
      const rate = getBase > 0 ? payQuote / getBase : 0;
      console.log(`Vault Ask [${ask.vaultData?.pricingType}]: ${ask.utxoRef.txHash.slice(0, 10)}#${ask.utxoRef.outputIndex} dir=${ask.vaultDirection}`);
      console.log(`  Offered: ${getBase.toFixed(4)} ${pair.baseToken.symbol}`);
      console.log(`  Pay: ${payQuote.toFixed(4)} ${pair.quoteToken.symbol}`);
      console.log(`  Rate: 1 ${pair.baseToken.symbol} = ${rate.toFixed(6)} ${pair.quoteToken.symbol} (or 1 ${pair.quoteToken.symbol} = ${(1/rate).toFixed(4)} ${pair.baseToken.symbol})`);
      console.log(`  effPrice in book: ${ask.effectivePrice}`);
    }
  }
}

async function main() {
  await verifyNetwork("mainnet");
  await verifyNetwork("preprod");
}

main().catch(console.error);
