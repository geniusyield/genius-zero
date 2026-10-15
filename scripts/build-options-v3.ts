import fs from "fs";
import path from "path";
import {
  applyParamsToScript,
  validatorToScriptHash,
  mintingPolicyToId,
  Constr,
  Data,
} from "@lucid-evolution/lucid";

function main() {
  const plutusJsonPath = path.resolve(
    "../options-contracts/aiken/plutus.json"
  );
  if (!fs.existsSync(plutusJsonPath)) {
    throw new Error(`plutus.json not found at ${plutusJsonPath}`);
  }

  const plutus = JSON.parse(fs.readFileSync(plutusJsonPath, "utf-8"));
  const validators = plutus.validators as Array<{
    title: string;
    compiledCode: string;
    hash: string;
  }>;

  const spendEntry = validators.find(
    (v) => v.title === "option.option_spend.spend"
  );
  const mintEntry = validators.find(
    (v) => v.title === "option.option_mint.mint"
  );

  if (!spendEntry || !mintEntry) {
    throw new Error("Could not find spend or mint validator in plutus.json");
  }

  const nftPolicyId =
    "fae686ea8f21d567841d703dea4d4221c2af071a6f2b433ff07c0af2";

  // Fee config NFT: ADA sentinel = Constr 0 [ "", "" ] (AssetClass)
  const feeConfigParam = new Constr(0, ["", ""]);

  console.log("Applying parameters to option_spend...");
  const spendAppliedCbor = applyParamsToScript(spendEntry.compiledCode, [
    nftPolicyId,
    feeConfigParam,
  ]);
  const spendHash = validatorToScriptHash({
    type: "PlutusV3",
    script: spendAppliedCbor,
  });

  console.log("Spend validator hash:", spendHash);

  console.log("Applying parameters to option_mint...");
  const mintAppliedCbor = applyParamsToScript(mintEntry.compiledCode, [
    nftPolicyId,
    spendHash,
  ]);
  const mintHash = mintingPolicyToId({
    type: "PlutusV3",
    script: mintAppliedCbor,
  });

  console.log("Mint policy hash:    ", mintHash);

  // Read existing NFT policy from genius-zero/src/contracts/options.v3.json
  const existingV3Path = path.resolve(
    "src/contracts/options.v3.json"
  );
  const existingV3 = JSON.parse(fs.readFileSync(existingV3Path, "utf-8"));

  const newV3 = {
    validator: {
      type: "PlutusV3",
      hash: spendHash,
      cbor: spendAppliedCbor,
    },
    optionPolicy: {
      type: "PlutusV3",
      hash: mintHash,
      cbor: mintAppliedCbor,
    },
    nftPolicy: existingV3.nftPolicy,
  };

  console.log("\nNew options.v3.json generated successfully:");
  console.log("- Validator Hash: ", spendHash);
  console.log("- Option Policy:  ", mintHash);
  console.log("- NFT Policy:     ", newV3.nftPolicy.hash);

  fs.writeFileSync(existingV3Path, JSON.stringify(newV3, null, 2), "utf-8");
  console.log(`\nWritten updated options.v3.json to ${existingV3Path}`);

  return newV3;
}

main();
