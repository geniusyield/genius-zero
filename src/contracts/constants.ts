import type {
  Address,
  Credential,
  PolicyId,
  UTxO,
  Unit,
  LucidEvolution,
  OutRef,
} from "@lucid-evolution/lucid";

export interface PartialOrderConstants {
  configAddr: Address;
  refNft: Unit;
  fallbackRefNft?: Unit;
  mintUTxO: UTxO;
  valUTxO: UTxO;
  valCred: Credential;
  mintPolicyId: PolicyId;
}

export const poConstants: {
  mainnet: PartialOrderConstants;
  preprod: PartialOrderConstants;
} = {
  preprod: {
    configAddr:
      "addr_test1wqzy2cay2twmcq68ypk4wjyppz6e4vjj4udhvkp7dfjet2quuh3la",
    refNft:
      "fae686ea8f21d567841d703dea4d4221c2af071a6f2b433ff07c0af2b5121487c7661f202bc1f95cbc16f0fce720a0a9d3dba63a9f128e617f2ddedc",
    fallbackRefNft:
      "fae686ea8f21d567841d703dea4d4221c2af071a6f2b433ff07c0af28309f9861928a55d37e84f6594b878941edce5e351f7904c2c63b559bde45c5c",
    mintUTxO: {
      txHash: "16647d6365020555d905d6e0edcf08b90a567886f875b40b3d7cec1c70482624",
      outputIndex: 1,
      assets: { lovelace: 20455430n },
      address:
        "addr_test1wqp6j289v99qwt9l34v4j9f3c7y9q7j5r3z9c6f2v4j9f3c7y9q7j",
      datumHash: undefined,
      datum: undefined,
      scriptRef: undefined,
    },
    valUTxO: {
      txHash: "16647d6365020555d905d6e0edcf08b90a567886f875b40b3d7cec1c70482624",
      outputIndex: 2,
      assets: { lovelace: 22351660n },
      address:
        "addr_test1wqp6j289v99qwt9l34v4j9f3c7y9q7j5r3z9c6f2v4j9f3c7y9q7j",
      datumHash: undefined,
      datum: undefined,
      scriptRef: undefined,
    },
    valCred: {
      type: "Script",
      hash: "44376a5f63342097a4f20401088c62da272639e60644a9ec1d70f444",
    },
    mintPolicyId: "53827a77e4ed3d5c211706708c0aa9b9a3be19db901b1cbf7fa515b8",
  },
  mainnet: {
    configAddr: "addr1w9zr09hgj7z6vz3d7wnxw0u4x30arsp5k8avlcm84utptls8uqd0z",
    refNft:
      "fae686ea8f21d567841d703dea4d4221c2af071a6f2b433ff07c0af24aff78908ef2dce98bfe435fb3fd2529747b1c4564dff5adebedf4e46d0fc63d",
    fallbackRefNft:
      "fae686ea8f21d567841d703dea4d4221c2af071a6f2b433ff07c0af2682fd5d4b0d834a3aa219880fa193869b946ffb80dba5532abca0910c55ad5cd",
    mintUTxO: {
      txHash: "c8adf3262d769f5692847501791c0245068ed5b6746e7699d23152e94858ada7",
      outputIndex: 1,
      assets: { lovelace: 20455430n },
      address:
        "addr1w9gexmeunzsykesf42d4eqet5yvzeap6trjnflxqtkcf66g5740fw",
      datumHash: undefined,
      datum: undefined,
      scriptRef: undefined,
    },
    valUTxO: {
      txHash: "c8adf3262d769f5692847501791c0245068ed5b6746e7699d23152e94858ada7",
      outputIndex: 2,
      assets: { lovelace: 22351660n },
      address:
        "addr1w9gexmeunzsykesf42d4eqet5yvzeap6trjnflxqtkcf66g5740fw",
      datumHash: undefined,
      datum: undefined,
      scriptRef: undefined,
    },
    valCred: {
      type: "Script",
      hash: "a8d7ff5cf4c117270288372f9ac8e1ce5b758ae15a7851c41661a48c",
    },
    mintPolicyId: "642c1f7bf79ca48c0f97239fcb2f3b42b92f2548184ab394e1e1e503",
  },
};

const refUTxOsCache = new Map<string, { mintUTxO: UTxO; valUTxO: UTxO }>();

export function resolvePOConstants(
  lucid: LucidEvolution
): PartialOrderConstants {
  const nid = lucid.config().network;
  if (nid === "Mainnet") {
    return poConstants.mainnet;
  } else if (nid === "Preprod") {
    return poConstants.preprod;
  } else {
    throw new Error(`Unsupported network: ${nid}`);
  }
}

/**
 * Resolves live reference script UTxOs from the blockchain.
 * Caches them in memory so they only need to be queried once per session.
 */
export async function fetchRefUTxOs(
  lucid: LucidEvolution
): Promise<{ mintUTxO: UTxO; valUTxO: UTxO }> {
  const nid = lucid.config().network;
  const cached = refUTxOsCache.get(nid);
  if (cached && cached.mintUTxO.scriptRef && cached.valUTxO.scriptRef) {
    return cached;
  }

  const po = resolvePOConstants(lucid);
  const outRefs: OutRef[] = [
    { txHash: po.mintUTxO.txHash, outputIndex: po.mintUTxO.outputIndex },
    { txHash: po.valUTxO.txHash, outputIndex: po.valUTxO.outputIndex },
  ];

  const fetched = await lucid.utxosByOutRef(outRefs);
  const mintUTxO = fetched.find(
    (u) =>
      u.txHash === po.mintUTxO.txHash &&
      u.outputIndex === po.mintUTxO.outputIndex
  );
  const valUTxO = fetched.find(
    (u) =>
      u.txHash === po.valUTxO.txHash &&
      u.outputIndex === po.valUTxO.outputIndex
  );

  if (!mintUTxO || !valUTxO) {
    throw new Error(
      `Failed to fetch reference script UTxOs for network ${nid}: mintUTxO=${!!mintUTxO}, valUTxO=${!!valUTxO}`
    );
  }

  // Update in-memory constants with live UTxOs
  po.mintUTxO = mintUTxO;
  po.valUTxO = valUTxO;

  const result = { mintUTxO, valUTxO };
  refUTxOsCache.set(nid, result);
  return result;
}

