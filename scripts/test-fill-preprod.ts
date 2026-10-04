import {
  Lucid,
  Blockfrost,
  fromText,
  paymentCredentialOf,
  scriptFromNative,
  mintingPolicyToId,
  Data,
  UTxO,
  OutRef,
} from "@lucid-evolution/lucid";
import fs from "fs";
import {
  createOrder,
  cancelOrders,
  fetchPartialOrderConfig,
  myDatumOf,
} from "../src/contracts/api";
import {
  PartialOrderDatum,
  PartialOrderRedeemer,
  PartialOrderFeeOutput,
  OutputReferenceD,
  PONftPolicyRedeemer,
} from "../src/contracts/contract.types";
import {
  resolvePOConstants,
  fetchRefUTxOs,
} from "../src/contracts/constants";
import {
  assetClassDToUnit,
  containedFeeToAssets,
  expectedPaymentWithDeposit,
  mappendAssets,
  partialOrderPrice,
  toAddress,
  fromAssets,
} from "../src/contracts/utils";

async function run() {
  console.log("========================================================");
  console.log("   Genius Zero — Preprod Order Fill Test Suite          ");
  console.log("========================================================");

  const envContent = fs.readFileSync(".env", "utf8");
  const match = envContent.match(/BLOCKFROST_API_KEY_PREPROD=([^\s]+)/);
  const key = match ? match[1] : "";

  const lucid = await Lucid(
    new Blockfrost("https://cardano-preprod.blockfrost.io/api/v0", key),
    "Preprod"
  );
  const walletJson = JSON.parse(fs.readFileSync("test-wallet-preprod.json", "utf8"));
  lucid.selectWallet.fromSeed(walletJson.seedPhrase);

  const testAddress = await lucid.wallet().address();
  console.log("✔ Wallet Address:", testAddress);

  const pkh = paymentCredentialOf(testAddress).hash;
  const nativeScript: any = {
    type: "all",
    scripts: [{ type: "sig", keyHash: pkh }],
  };
  const script = scriptFromNative(nativeScript);
  const policyId = mintingPolicyToId(script);
  const assetName = fromText("TST");
  const tstUnit = policyId + assetName;

  console.log("\n--- [Step 1] Checking/Minting Test Token ---");
  const utxos = await lucid.wallet().getUtxos();
  let tstBalance = 0n;
  for (const u of utxos) {
    tstBalance += u.assets[tstUnit] || 0n;
  }

  if (tstBalance < 500n) {
    console.log("Minting 1,000 TST tokens for order filling tests...");
    const mintTx = await lucid
      .newTx()
      .attach.MintingPolicy(script)
      .mintAssets({ [tstUnit]: 1000n })
      .complete();
    const signedMintTx = await mintTx.sign.withWallet().complete();
    const mintHash = await signedMintTx.submit();
    console.log("Mint Tx submitted:", mintHash);
    await lucid.awaitTx(mintHash);
    console.log("✔ 1,000 TST tokens minted!");
    // Wait for Blockfrost to index
    await new Promise((r) => setTimeout(r, 6000));
  } else {
    console.log(`✔ Test wallet already holds ${tstBalance} TST tokens.`);
  }

  // 2. Place a Sell Order: Offer 100 TST asking for 10 tADA (0.10 tADA / TST)
  console.log("\n--- [Step 2] Placing Sell Order (100 TST for 10 tADA) ---");
    const freshUtxos = await lucid.wallet().getUtxos();
    const anUTxO = freshUtxos.find((u) => (u.assets["lovelace"] || 0n) >= 5_000_000n)!;

    const offerAmt = 100n; // 100 TST
    const offerAC = tstUnit;
    const priceAC = "lovelace"; // asking tADA
    const rationalPrice = { numerator: 100_000n, denominator: 1n };

    const [, createTxBuilder] = await createOrder(
      lucid,
      lucid.newTx(),
      anUTxO,
      testAddress,
      offerAmt,
      offerAC,
      priceAC,
      rationalPrice,
      true
    );

    const completedCreate = await createTxBuilder.complete();
    const signedCreate = await completedCreate.sign.withWallet().complete();
    const orderTxHash = await signedCreate.submit();
    console.log("✔ Order Tx submitted:", orderTxHash);
    await lucid.awaitTx(orderTxHash);
    console.log("✔ Order confirmed on-chain!");

    console.log("   Waiting for Blockfrost indexing...");
    for (let i = 0; i < 30; i++) {
      const wUtxos = await lucid.wallet().getUtxos();
      if (wUtxos.some((u) => u.txHash === orderTxHash)) {
        break;
      }
      await new Promise((r) => setTimeout(r, 2000));
    }

    const orderOutRef: OutRef = { txHash: orderTxHash, outputIndex: 0 };
    const [fetched] = await lucid.utxosByOutRef([orderOutRef]);
    targetOrderUTxO = fetched;

    console.log("✔ Found Order UTxO:", targetOrderUTxO.txHash + "#" + targetOrderUTxO.outputIndex);
    const orderDatum = await myDatumOf(lucid, targetOrderUTxO);
    console.log("   Remaining offered:", orderDatum.podOfferedAmount, "TST");

    // Test PARTIAL FILL: Fill 40 TST (out of 100 TST)
    console.log("\n--- [Step 3] Testing Partial Fill (40 TST out of 100 TST) ---");
    const partialFillAmt = 40n;
    const [pocDatum, pocUTxO] = await fetchPartialOrderConfig(lucid);
    const { valUTxO } = await fetchRefUTxOs(lucid);

    const askedUnit = assetClassDToUnit(orderDatum.podAskedAsset);
    const offeredUnit = assetClassDToUnit(orderDatum.podOfferedAsset);
    const priceObj = partialOrderPrice(orderDatum, partialFillAmt);
    const priceAmt = priceObj[askedUnit] || 0n;
    console.log(`   Filling: ${partialFillAmt} TST -> Cost: ${Number(priceAmt) / 1_000_000} tADA + 1 tADA taker fee`);

    const updatedDatum: PartialOrderDatum = {
      ...orderDatum,
      podOfferedAmount: orderDatum.podOfferedAmount - partialFillAmt,
      podPartialFills: orderDatum.podPartialFills + 1n,
      podContainedFee: {
        pocfLovelaces: orderDatum.podContainedFee.pocfLovelaces + orderDatum.podTakerLovelaceFlatFee,
        pocfOfferedTokens: orderDatum.podContainedFee.pocfOfferedTokens,
        pocfAskedTokens: orderDatum.podContainedFee.pocfAskedTokens,
      },
      podContainedPayment: orderDatum.podContainedPayment + priceAmt,
    };

    let continuingAssets = { ...targetOrderUTxO.assets };
    continuingAssets = mappendAssets(continuingAssets, { [askedUnit]: priceAmt });
    continuingAssets = mappendAssets(continuingAssets, { lovelace: orderDatum.podTakerLovelaceFlatFee });
    continuingAssets = mappendAssets(continuingAssets, { [offeredUnit]: -partialFillAmt });

    const partialTx = await lucid
      .newTx()
      .readFrom([pocUTxO, valUTxO])
      .collectFrom([targetOrderUTxO], Data.to({ PartialFill: [partialFillAmt] }, PartialOrderRedeemer))
      .pay.ToAddressWithData(
        targetOrderUTxO.address,
        { kind: "inline", value: Data.to(updatedDatum, PartialOrderDatum) },
        continuingAssets
      )
      .validTo(Date.now() + 2 * 60 * 60 * 1000)
      .complete();

    const signedPartial = await partialTx.sign.withWallet().complete();
    const partialTxHash = await signedPartial.submit();
    console.log("✔ Partial Fill Tx submitted! TxHash:", partialTxHash);
    console.log(`   View on Cexplorer: https://preprod.cexplorer.io/tx/${partialTxHash}`);
    await lucid.awaitTx(partialTxHash);
    console.log("✔ Partial Fill confirmed on-chain!");

    console.log("   Waiting for Blockfrost indexing...");
    for (let i = 0; i < 30; i++) {
      const wUtxos = await lucid.wallet().getUtxos();
      if (wUtxos.some((u) => u.txHash === partialTxHash)) {
        break;
      }
      await new Promise((r) => setTimeout(r, 2000));
    }

    const continuingOutRef: OutRef = { txHash: partialTxHash, outputIndex: 0 };
    const [cUTxO] = await lucid.utxosByOutRef([continuingOutRef]);
    const targetOrderUTxO = cUTxO;

  // 5. Test COMPLETE FILL
  console.log("\n--- [Step 4] Testing Complete Fill ---");
  const continuingUTxO = targetOrderUTxO;
  console.log("✔ Target Order UTxO:", continuingUTxO.txHash + "#" + continuingUTxO.outputIndex);
  const currentDatum = await myDatumOf(lucid, continuingUTxO);
  console.log("   Remaining offered:", currentDatum.podOfferedAmount, "TST");

  const [pocDatum, pocUTxO] = await fetchPartialOrderConfig(lucid);
  const { mintUTxO, valUTxO } = await fetchRefUTxOs(lucid);

  const poConstants = resolvePOConstants(lucid);
  const outputRef: OutputReferenceD = {
    txHash: { hash: continuingUTxO.txHash },
    outputIndex: BigInt(continuingUTxO.outputIndex),
  };

  const containedFeeValue = containedFeeToAssets(currentDatum);
  const feeValue = mappendAssets(containedFeeValue, {
    lovelace: currentDatum.podTakerLovelaceFlatFee,
  });

  const feeOutputDatum: PartialOrderFeeOutput = {
    pofdMentionedFees: new Map([[outputRef, fromAssets(containedFeeValue)]]),
    pofdReservedValue: fromAssets({}),
    pofdSpentUTxORef: null,
  };

  const makerPaymentValue = expectedPaymentWithDeposit(
    poConstants,
    continuingUTxO.assets,
    currentDatum,
    true
  );
  console.log("   Maker payment value:", makerPaymentValue);
  console.log("   Fee output value:", feeValue);

  let completeTxBuilder = lucid
    .newTx()
    .readFrom([pocUTxO, mintUTxO, valUTxO])
    .collectFrom([continuingUTxO], Data.to("CompleteFill", PartialOrderRedeemer))
    .pay.ToAddressWithData(
      toAddress(currentDatum.podOwnerAddr, lucid),
      { kind: "inline", value: Data.to(outputRef, OutputReferenceD) },
      makerPaymentValue
    )
    .mintAssets(
      { [poConstants.mintPolicyId + currentDatum.podNFT]: -1n },
      Data.to(null, PONftPolicyRedeemer)
    );

  if (Object.keys(feeValue).length > 0) {
    completeTxBuilder = completeTxBuilder.pay.ToAddressWithData(
      toAddress(pocDatum.pocdFeeAddr, lucid),
      {
        kind: "asHash",
        value: Data.to(feeOutputDatum, PartialOrderFeeOutput),
      },
      feeValue
    );
  }

  completeTxBuilder = completeTxBuilder.validTo(Date.now() + 2 * 60 * 60 * 1000);

  const completedFill = await completeTxBuilder.complete();
  const signedComplete = await completedFill.sign.withWallet().complete();
  const completeTxHash = await signedComplete.submit();
  console.log("✔ Complete Fill Tx submitted! TxHash:", completeTxHash);
  console.log(`   View on Cexplorer: https://preprod.cexplorer.io/tx/${completeTxHash}`);
  await lucid.awaitTx(completeTxHash);
  console.log("✔ Complete Fill confirmed on-chain! Order NFT burned!");

  console.log("\n========================================================");
  console.log("  🎉 BOTH PARTIAL FILL & COMPLETE FILL PASSED ON-CHAIN! ");
  console.log("========================================================");
}

run().catch(console.error);
