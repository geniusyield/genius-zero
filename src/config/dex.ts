import { NetworkType, TokenInfo, TradingPair } from "../types";

export interface DexNetworkConstants {
  network: NetworkType;
  valCredHash: string; // Script hash of swap validator
  mintPolicyId: string; // Minting policy ID of order tracking NFT
  mintUTxO: {
    txHash: string;
    outputIndex: number;
  };
  valUTxO: {
    txHash: string;
    outputIndex: number;
  };
  feeConfigAddr: string;
  refNft: string;
  fallbackRefNft?: string;
  stakingAddr: string;
  stakingScriptHash: string;
  rewardsAddr: string;
  rewardsScriptHash: string;
  gensVaultNftPolicy: string;
  gensxVaultNftPolicy: string;
  blockfrostUrl: string;
}

export const DEX_CONSTANTS: Record<NetworkType, DexNetworkConstants> = {
  mainnet: {
    network: "mainnet",
    valCredHash: "a8d7ff5cf4c117270288372f9ac8e1ce5b758ae15a7851c41661a48c",
    mintPolicyId: "642c1f7bf79ca48c0f97239fcb2f3b42b92f2548184ab394e1e1e503",
    mintUTxO: {
      txHash: "c8adf3262d769f5692847501791c0245068ed5b6746e7699d23152e94858ada7",
      outputIndex: 1,
    },
    valUTxO: {
      txHash: "c8adf3262d769f5692847501791c0245068ed5b6746e7699d23152e94858ada7",
      outputIndex: 2,
    },
    feeConfigAddr: "addr1w9zr09hgj7z6vz3d7wnxw0u4x30arsp5k8avlcm84utptls8uqd0z",
    refNft: "fae686ea8f21d567841d703dea4d4221c2af071a6f2b433ff07c0af24aff78908ef2dce98bfe435fb3fd2529747b1c4564dff5adebedf4e46d0fc63d",
    fallbackRefNft: "fae686ea8f21d567841d703dea4d4221c2af071a6f2b433ff07c0af2682fd5d4b0d834a3aa219880fa193869b946ffb80dba5532abca0910c55ad5cd",
    stakingAddr: "addr1w8r99sv75y9tqfdzkzyqdqhedgnef47w4x7y0qnyts8pznq87e4wh",
    stakingScriptHash: "c652c19ea10ab025a2b0880682f96a2794d7cea9bc4782645c0e114c",
    rewardsAddr: "addr1vy38wnftcwrugm2umfyzr76rj9vqfp6rsc5vak22fakwfrq82zcx9",
    rewardsScriptHash: "22774d2bc387c46d5cda4821fb4391580487438628ced94a4f6ce48c",
    gensVaultNftPolicy: "dda5fdb1002f7389b33e036b6afee82a8189becb6cba852e8b79b4fb",
    gensxVaultNftPolicy: "fbae99b8679369079a7f6f0da14a2cf1c2d6bfd3afdf3a96a64ab67a",
    blockfrostUrl: "https://cardano-mainnet.blockfrost.io/api/v0",
  },
  preprod: {
    network: "preprod",
    valCredHash: "44376a5f63342097a4f20401088c62da272639e60644a9ec1d70f444",
    mintPolicyId: "53827a77e4ed3d5c211706708c0aa9b9a3be19db901b1cbf7fa515b8",
    mintUTxO: {
      txHash: "16647d6365020555d905d6e0edcf08b90a567886f875b40b3d7cec1c70482624",
      outputIndex: 1,
    },
    valUTxO: {
      txHash: "16647d6365020555d905d6e0edcf08b90a567886f875b40b3d7cec1c70482624",
      outputIndex: 2,
    },
    feeConfigAddr: "addr_test1wqzy2cay2twmcq68ypk4wjyppz6e4vjj4udhvkp7dfjet2quuh3la",
    refNft: "fae686ea8f21d567841d703dea4d4221c2af071a6f2b433ff07c0af2b5121487c7661f202bc1f95cbc16f0fce720a0a9d3dba63a9f128e617f2ddedc",
    fallbackRefNft: "fae686ea8f21d567841d703dea4d4221c2af071a6f2b433ff07c0af28309f9861928a55d37e84f6594b878941edce5e351f7904c2c63b559bde45c5c",
    stakingAddr: "addr_test1wrr99sv75y9tqfdzkzyqdqhedgnef47w4x7y0qnyts8pznqukdfpj",
    stakingScriptHash: "c652c19ea10ab025a2b0880682f96a2794d7cea9bc4782645c0e114c",
    rewardsAddr: "addr_test1qqgj9ntsufr5lhcnmymeq2vdvuumpdwlpfyqwqysdm7upgf43f8yzpwq3av7gauswp5ec7nj2e5fxve0nptaknn5904sahgmdd",
    rewardsScriptHash: "7665c40357deba19c8bad6d739d805e9287b30c0fa00f1a003dfcfa4",
    gensVaultNftPolicy: "c6e65ba7878b2f8ea0ad39287d3e2fd256dc5c4160fc19bdf4c4d87e",
    gensxVaultNftPolicy: "fbae99b8679369079a7f6f0da14a2cf1c2d6bfd3afdf3a96a64ab67a",
    blockfrostUrl: "https://cardano-preprod.blockfrost.io/api/v0",
  },
};

export const ADA_TOKEN: TokenInfo = {
  unit: "lovelace",
  symbol: "ADA",
  name: "Cardano ADA",
  decimals: 6,
  icon: "https://assets.coingecko.com/coins/images/975/standard/cardano.png",
};

export const TADA_TOKEN: TokenInfo = {
  unit: "lovelace",
  symbol: "tADA",
  name: "Testnet ADA",
  decimals: 6,
  icon: "https://assets.coingecko.com/coins/images/975/standard/cardano.png",
};

export const DEFAULT_MAINNET_TOKENS: TokenInfo[] = [
  ADA_TOKEN,
  {
    unit: "dda5fdb1002f7389b33e036b6a5cc41a4e410b33e8b5604dda49c8a947454e53",
    policyId: "dda5fdb1002f7389b33e036b6a5cc41a4e410b33e8b5604dda49c8a9",
    assetName: "47454e53",
    symbol: "GENS",
    name: "Genius Yield",
    decimals: 6,
    icon: "https://raw.githubusercontent.com/cardano-foundation/cardano-token-registry/master/mappings/dda5fdb1002f7389b33e036b6a5cc41a4e410b33e8b5604dda49c8a947454e53.png",
  },
  {
    unit: "279c909f348e533da5808898f87f5a14bbd2373aec8c23f5b7830003534e454b",
    policyId: "279c909f348e533da5808898f87f5a14bbd2373aec8c23f5b7830003",
    assetName: "534e454b",
    symbol: "SNEK",
    name: "Snek",
    decimals: 0,
    icon: "https://assets.coingecko.com/coins/images/30396/standard/snek.png",
  },
  {
    unit: "5dac8536653edc1c802113a017835dd88367656eb655d809312642bc4e4d4b52",
    policyId: "5dac8536653edc1c802113a017835dd88367656eb655d809312642bc",
    assetName: "4e4d4b52",
    symbol: "NMKR",
    name: "NMKR",
    decimals: 6,
    icon: "https://assets.coingecko.com/coins/images/25895/standard/nmkr.png",
  },
  {
    unit: "5d16cc1a177b5d9ba9cfa9793b07e60f1fb70fea1f8a23aaa61804aa494147",
    policyId: "5d16cc1a177b5d9ba9cfa9793b07e60f1fb70fea1f8a23aaa61804aa",
    assetName: "494147",
    symbol: "IAG",
    name: "Iagon",
    decimals: 6,
    icon: "https://assets.coingecko.com/coins/images/17342/standard/iagon.png",
  },
  {
    unit: "8db269c3ec63c412c40f60165218a654eee9a521497982f408eaa371444a4544",
    policyId: "8db269c3ec63c412c40f60165218a654eee9a521497982f408eaa371",
    assetName: "444a4544",
    symbol: "DJED",
    name: "Djed Stablecoin",
    decimals: 6,
    icon: "https://assets.coingecko.com/coins/images/28905/standard/djed.png",
  },
  {
    unit: "533bb94a88614e341565774319fe0b8388500a3276996868f4e55d65494e4459",
    policyId: "533bb94a88614e341565774319fe0b8388500a3276996868f4e55d65",
    assetName: "494e4459",
    symbol: "INDY",
    name: "Indigo Protocol",
    decimals: 6,
    icon: "https://assets.coingecko.com/coins/images/28271/standard/indigo.png",
  },
];

export const DEFAULT_PREPROD_TOKENS: TokenInfo[] = [
  TADA_TOKEN,
  {
    unit: "c6e65ba7878b2f8ea0ad39287d3e2fd256dc5c4160fc19bdf4c4d87e7447454e53",
    policyId: "c6e65ba7878b2f8ea0ad39287d3e2fd256dc5c4160fc19bdf4c4d87e",
    assetName: "7447454e53",
    symbol: "tGENS",
    name: "Test Genius Yield",
    decimals: 6,
    icon: "https://raw.githubusercontent.com/cardano-foundation/cardano-token-registry/master/mappings/dda5fdb1002f7389b33e036b6a5cc41a4e410b33e8b5604dda49c8a947454e53.png",
  },
];

export const DEFAULT_MAINNET_TRADING_PAIRS: TradingPair[] = [
  {
    id: "GENS-ADA",
    baseToken: DEFAULT_MAINNET_TOKENS[1], // GENS
    quoteToken: ADA_TOKEN,
  },
  {
    id: "SNEK-ADA",
    baseToken: DEFAULT_MAINNET_TOKENS[2], // SNEK
    quoteToken: ADA_TOKEN,
  },
  {
    id: "IAG-ADA",
    baseToken: DEFAULT_MAINNET_TOKENS[4], // IAG
    quoteToken: ADA_TOKEN,
  },
  {
    id: "DJED-ADA",
    baseToken: DEFAULT_MAINNET_TOKENS[5], // DJED
    quoteToken: ADA_TOKEN,
  },
  {
    id: "INDY-ADA",
    baseToken: DEFAULT_MAINNET_TOKENS[6], // INDY
    quoteToken: ADA_TOKEN,
  },
];

export const PREPROD_TRADING_PAIRS: TradingPair[] = [
  {
    id: "tGENS-tADA",
    baseToken: DEFAULT_PREPROD_TOKENS[1], // tGENS
    quoteToken: TADA_TOKEN, // tADA
  },
];

// Alias for backwards compatibility
export const DEFAULT_TRADING_PAIRS = DEFAULT_MAINNET_TRADING_PAIRS;

export function getTradingPairs(network: NetworkType): TradingPair[] {
  return network === "mainnet" ? DEFAULT_MAINNET_TRADING_PAIRS : PREPROD_TRADING_PAIRS;
}

export function getDefaultTokens(network: NetworkType): TokenInfo[] {
  return network === "mainnet" ? DEFAULT_MAINNET_TOKENS : DEFAULT_PREPROD_TOKENS;
}
