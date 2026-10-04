import fs from "fs";
import path from "path";

function findFiles(dir, matchFile) {
  let results = [];
  if (!fs.existsSync(dir)) return results;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results = results.concat(findFiles(fullPath, matchFile));
    } else if (entry.name === matchFile) {
      results.push(fullPath);
    }
  }
  return results;
}

const targetUtils = `var largestFirst = (a, b) => {
  const lovelaceA = Number(a.assets["lovelace"]);
  const lovelaceB = Number(b.assets["lovelace"]);
  if (lovelaceA === lovelaceB) {
    return Object.keys(a.assets).length - Object.keys(b.assets).length;
  }
  return -1 * (lovelaceA - lovelaceB);
};`;

const patchedUtils = `var largestFirst = (a, b) => {
  const aPure = Object.keys(a.assets).length === 1 && a.assets["lovelace"] ? 1 : 0;
  const bPure = Object.keys(b.assets).length === 1 && b.assets["lovelace"] ? 1 : 0;
  if (aPure !== bPure) {
    return bPure - aPure;
  }
  const lovelaceA = Number(a.assets["lovelace"]);
  const lovelaceB = Number(b.assets["lovelace"]);
  if (lovelaceA === lovelaceB) {
    return Object.keys(a.assets).length - Object.keys(b.assets).length;
  }
  return -1 * (lovelaceA - lovelaceB);
};`;

const targetApplyCollateral = `var applyCollateral = (config, setCollateral, collateralInputs, changeAddress) => {
  for (const utxo of collateralInputs) {`;

const patchedApplyCollateral = `var applyCollateral = (config, setCollateral, collateralInputs, changeAddress) => {
  config.collateralInputs = collateralInputs;
  for (const utxo of collateralInputs) {`;

const targetSelEval = `const availableInputs = _Array.differenceWith(isEqualUTxO)(
    walletInfo.inputs,
    config.collectedInputs
  );`;

const patchedSelEval = `const availableInputs = _Array.differenceWith(isEqualUTxO)(
    walletInfo.inputs,
    config.collateralInputs ? [...config.collectedInputs, ...config.collateralInputs] : config.collectedInputs
  );`;

const targetSelEvalCjs = `const availableInputs = import_effect17.Array.differenceWith(import_utils11.isEqualUTxO)(
    walletInfo.inputs,
    config.collectedInputs
  );`;

const patchedSelEvalCjs = `const availableInputs = import_effect17.Array.differenceWith(import_utils11.isEqualUTxO)(
    walletInfo.inputs,
    config.collateralInputs ? [...config.collectedInputs, ...config.collateralInputs] : config.collectedInputs
  );`;

function patchAll() {
  const nodeModules = path.resolve(process.cwd(), "node_modules");
  const jsFiles = findFiles(nodeModules, "index.js");
  const cjsFiles = findFiles(nodeModules, "index.cjs");
  const allFiles = [...jsFiles, ...cjsFiles].filter((f) => f.includes("@lucid-evolution"));

  let patchedCount = 0;
  for (const file of allFiles) {
    let content = fs.readFileSync(file, "utf-8");
    let changed = false;

    if (content.includes(targetUtils)) {
      content = content.replace(targetUtils, patchedUtils);
      changed = true;
    }
    if (content.includes(targetApplyCollateral)) {
      content = content.replace(targetApplyCollateral, patchedApplyCollateral);
      changed = true;
    }
    if (content.includes(targetSelEval)) {
      content = content.replace(targetSelEval, patchedSelEval);
      changed = true;
    }
    if (content.includes(targetSelEvalCjs)) {
      content = content.replace(targetSelEvalCjs, patchedSelEvalCjs);
      changed = true;
    }

    if (changed) {
      fs.writeFileSync(file, content, "utf-8");
      console.log(`[patch-lucid] Patched: ${file}`);
      patchedCount++;
    }
  }
  console.log(`[patch-lucid] Done. Total files patched: ${patchedCount}`);
}

patchAll();
