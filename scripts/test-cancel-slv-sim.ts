import fs from "fs";
import path from "path";
import {
  Blockfrost,
  Lucid,
  generatePrivateKey,
  keyHashToCredential,
  credentialToAddress,
  type UTxO,
  type Assets,
  Constr,
  Data,
} from "@lucid-evolution/lucid";
import { DEX_CONSTANTS } from "../src/config/dex";
import { fetchSlvRefUTxOs, decodePlutusAddress } from "../src/contracts/slv";

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

async function run() {
  const key =
    process.env.VITE_BLOCKFROST_API_KEY_MAINNET ||
    process.env.BLOCKFROST_API_KEY_MAINNET;
  if (!key) throw new Error("Missing Blockfrost API key");

  try {
    console.log("=== SLV Cancellation Simulation Test ===");
  console.log("Connecting to Cardano Mainnet via Blockfrost...");
  const lucid = await Lucid(
    new Blockfrost("https://cardano-mainnet.blockfrost.io/api/v0", key),
    "Mainnet"
  );

  const constants = DEX_CONSTANTS.mainnet;

  console.log("1. Fetching live SLV UTxOs at script address...");
  const slvUtxos = await lucid.utxosAt({
    type: "Script",
    hash: constants.slvScriptHash,
  });
  console.log(`Found ${slvUtxos.length} total SLV UTxOs on Mainnet.`);

  // Pick one active vault UTxO that has the SLV tracking NFT
  const vaultUtxo = slvUtxos.find((u) =>
    Object.keys(u.assets).some((unit) => unit.startsWith(constants.slvNftPolicyId))
  );

  if (!vaultUtxo) {
    throw new Error("No active SLV UTxO found on Mainnet.");
  }

  console.log(`\n2. Selected target SLV UTxO: ${vaultUtxo.txHash}#${vaultUtxo.outputIndex}`);
  console.log("   Assets inside UTxO:", vaultUtxo.assets);

  // Parse datum
  const parsed = Data.from(vaultUtxo.datum!) as any;
  const ownerPkh = String(parsed.fields[0].fields[0][0]);
  const paymentAddr = decodePlutusAddress(parsed.fields[1], "Mainnet");
  const nftTokenName = String(parsed.fields[2]);
  const nftUnit = `${constants.slvNftPolicyId}${nftTokenName}`;

  console.log(`   Owner PKH: ${ownerPkh}`);
  console.log(`   Payment Destination Address: ${paymentAddr}`);
  console.log(`   Tracking NFT Unit: ${nftUnit}`);

  // Fetch the 4 reference UTxOs
  console.log("\n3. Fetching 4 reference UTxOs (Config, Mint, Spend, Cancel)...");
  const { configUtxo, mintRefUtxo, spendRefUtxo, cancelRefUtxo } =
    await fetchSlvRefUTxOs(lucid, constants);
  console.log(`   Config Ref: ${configUtxo.txHash}#${configUtxo.outputIndex}`);
  console.log(`   Mint Ref: ${mintRefUtxo.txHash}#${mintRefUtxo.outputIndex}`);
  console.log(`   Spend Ref: ${spendRefUtxo.txHash}#${spendRefUtxo.outputIndex}`);
  console.log(`   Cancel Ref: ${cancelRefUtxo.txHash}#${cancelRefUtxo.outputIndex}`);

  // Resolve cancel stake address
  const cancelStakeAddr = constants.slvCancelStakeAddr!;
  console.log(`   Cancel Stake Address: ${cancelStakeAddr}`);

  // Calculate payout assets
  const payoutAssets: Assets = { ...vaultUtxo.assets };
  delete payoutAssets[nftUnit];
  console.log("   Payout Assets to Owner:", payoutAssets);

  // Setup synthetic signer wallet matching owner to satisfy transaction building & balancing
  console.log("\n4. Setting up wallet context from owner address...");
  const realUtxos = await lucid.utxosAt(paymentAddr);
  console.log(`Found ${realUtxos.length} real UTxOs at owner address ${paymentAddr}.`);

  const pureAdaUtxos = realUtxos.filter(
    (u) => Object.keys(u.assets).length === 1 && u.assets["lovelace"] > 5_000_000n
  );
  console.log(`Found ${pureAdaUtxos.length} pure ADA UTxOs.`);

  if (pureAdaUtxos.length >= 2) {
    lucid.selectWallet.fromAddress(paymentAddr, pureAdaUtxos);
  } else {
    // If not enough pure ADA UTxOs, use whatever UTxOs exist or mock with proper CML format
    lucid.selectWallet.fromAddress(paymentAddr, realUtxos.slice(0, 3));
  }

  // Build the cancellation transaction
  console.log("\n5. Building cancellation transaction via Lucid Evolution...");
  const tx = lucid
    .newTx()
    .readFrom([configUtxo, mintRefUtxo, cancelRefUtxo, spendRefUtxo])
    .collectFrom([vaultUtxo], Data.to(new Constr(0, [])))
    .mintAssets({ [nftUnit]: -1n }, Data.to(new Constr(1, [])))
    .withdraw(cancelStakeAddr, 0n, Data.void())
    .pay.ToAddressWithData(
      paymentAddr,
      {
        kind: "inline",
        value: Data.to(nftTokenName),
      },
      payoutAssets
    )
    .addSignerKey(ownerPkh);

    console.log("   Evaluating Plutus scripts via provider (localUPLCEval: false)...");
    const completedTx = await tx.complete({ localUPLCEval: false });
    console.log("\n=== SUCCESS! Cancellation transaction successfully evaluated & completed ===");
    console.log("CBOR length:", completedTx.toCBOR().length);
  } catch (err: any) {
    console.error("\n❌ Simulation failed:");
    console.dir(err, { depth: 5 });
    process.exit(1);
  }
}

run();
