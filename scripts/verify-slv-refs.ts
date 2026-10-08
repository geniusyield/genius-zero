import fs from "fs";
import path from "path";
import { Blockfrost, Lucid } from "@lucid-evolution/lucid";

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
          if (!process.env[key.trim()]) process.env[key.trim()] = val;
        }
      }
    }
  }
}
loadEnv();

async function main() {
  const key = process.env.VITE_BLOCKFROST_API_KEY_MAINNET || process.env.BLOCKFROST_API_KEY_MAINNET;
  const lucid = await Lucid(new Blockfrost("https://cardano-mainnet.blockfrost.io/api/v0", key), "Mainnet");

  const refs = [
    { name: "configRef", txHash: "2e39463cbaf97a99850fd5bfa9fc54efc9f0bd7f14f3b2c41dc59828bf1851cc", outputIndex: 0 },
    { name: "mintRef", txHash: "2e39463cbaf97a99850fd5bfa9fc54efc9f0bd7f14f3b2c41dc59828bf1851cc", outputIndex: 1 },
    { name: "cancelRef", txHash: "32a445746126f329c2f97e493ea89096c154ca4532c3707e29e92d65d6aa1602", outputIndex: 0 },
    { name: "spendRef", txHash: "c306121c43bdb35d211ecb18f1e5056a30e394a64e5c45402993a8c9ee306ae1", outputIndex: 0 },
  ];

  console.log("Checking reference UTxOs on Cardano Mainnet...");
  const utxos = await lucid.utxosByOutRef(refs);
  console.log(`Found ${utxos.length} of ${refs.length} reference UTxOs:`);
  for (const u of utxos) {
    const match = refs.find(r => r.txHash === u.txHash && r.outputIndex === u.outputIndex);
    console.log(`- [${match?.name}] ${u.txHash}#${u.outputIndex}`);
    console.log(`  Address: ${u.address}`);
    console.log(`  ScriptRef Hash: ${u.scriptRef?.script ? "Present" : "None"}`);
    if (u.assets) {
      console.log(`  Assets:`, Object.keys(u.assets));
    }
  }
}

main().catch(console.error);
