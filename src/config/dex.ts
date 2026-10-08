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
  slvScriptHash: string;
  slvAddr: string;
  slvNftPolicyId: string;
  blockfrostUrl: string;
  claimServiceUrl: string;
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
    feeConfigAddr: "addr1wxcqkdhe7qcfkqcnhlvepe7zmevdtsttv8vdfqlxrztaq2gge58rd",
    refNft: "fae686ea8f21d567841d703dea4d4221c2af071a6f2b433ff07c0af2682fd5d4b0d834a3aa219880fa193869b946ffb80dba5532abca0910c55ad5cd",
    fallbackRefNft: "fae686ea8f21d567841d703dea4d4221c2af071a6f2b433ff07c0af24aff78908ef2dce98bfe435fb3fd2529747b1c4564dff5adebedf4e46d0fc63d",
    stakingAddr: "addr1w8r99sv75y9tqfdzkzyqdqhedgnef47w4x7y0qnyts8pznq87e4wh",
    stakingScriptHash: "c652c19ea10ab025a2b0880682f96a2794d7cea9bc4782645c0e114c",
    rewardsAddr: "addr1vy38wnftcwrugm2umfyzr76rj9vqfp6rsc5vak22fakwfrq82zcx9",
    rewardsScriptHash: "22774d2bc387c46d5cda4821fb4391580487438628ced94a4f6ce48c",
    gensVaultNftPolicy: "dda5fdb1002f7389b33e036b6afee82a8189becb6cba852e8b79b4fb",
    gensxVaultNftPolicy: "fbae99b8679369079a7f6f0da14a2cf1c2d6bfd3afdf3a96a64ab67a",
    slvScriptHash: "0a32c7d1a45fa861c8a68812919ba3ba187f2da6d84ff684385b2064",
    slvAddr: "addr1wy9r93735306scwg56yp9yvm5wapsled5mvyla5y8pdjqeqndkcvh",
    slvNftPolicyId: "55c9ddbea5ebe40eb41b880a2c047227417c14ec1b8d81ad70afb8be",
    blockfrostUrl: "https://cardano-mainnet.blockfrost.io/api/v0",
    claimServiceUrl: "https://2.28.204.8.sslip.io",
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
    slvScriptHash: "",
    slvAddr: "",
    slvNftPolicyId: "",
    blockfrostUrl: "https://cardano-preprod.blockfrost.io/api/v0",
    claimServiceUrl: "https://2.28.204.8.sslip.io",
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

export const GENS_MAINNET_TOKEN: TokenInfo = {
  unit: "dda5fdb1002f7389b33e036b6afee82a8189becb6cba852e8b79b4fb0014df1047454e53",
  policyId: "dda5fdb1002f7389b33e036b6afee82a8189becb6cba852e8b79b4fb",
  assetName: "0014df1047454e53",
  symbol: "GENS",
  name: "Genius Yield",
  decimals: 6,
  icon: "https://raw.githubusercontent.com/cardano-foundation/cardano-token-registry/master/mappings/dda5fdb1002f7389b33e036b6a5cc41a4e410b33e8b5604dda49c8a947454e53.png",
};

export const GENSX_MAINNET_TOKEN: TokenInfo = {
  unit: "fbae99b8679369079a7f6f0da14a2cf1c2d6bfd3afdf3a96a64ab67a0014df1047454e5358",
  policyId: "fbae99b8679369079a7f6f0da14a2cf1c2d6bfd3afdf3a96a64ab67a",
  assetName: "0014df1047454e5358",
  symbol: "GENSX",
  name: "Genius X",
  decimals: 6,
  icon: "https://assets.coingecko.com/coins/images/28912/standard/GENS_200x200.png",
};

export const SNEK_MAINNET_TOKEN: TokenInfo = {
  unit: "279c909f348e533da5808898f87f9a14bb2c3dfbbacccd631d927a3f534e454b",
  policyId: "279c909f348e533da5808898f87f9a14bb2c3dfbbacccd631d927a3f",
  assetName: "534e454b",
  symbol: "SNEK",
  name: "Snek",
  decimals: 0,
  icon: "https://assets.coingecko.com/coins/images/30396/standard/snek.png",
};

export const USDM_MAINNET_TOKEN: TokenInfo = {
  unit: "c48cbb3d5e57ed56e276bc45f99ab39abe94e6cd7ac39fb402da47ad0014df105553444d",
  policyId: "c48cbb3d5e57ed56e276bc45f99ab39abe94e6cd7ac39fb402da47ad",
  assetName: "0014df105553444d",
  symbol: "USDM",
  name: "Moneta USDM",
  decimals: 6,
  icon: "https://assets.coingecko.com/coins/images/36224/standard/usdm.png",
};

export const HOSKY_MAINNET_TOKEN: TokenInfo = {
  unit: "a0028f350aaabe0545fdcb56b039bfb08e4bb4d8c4d7c3c7d481c235484f534b59",
  policyId: "a0028f350aaabe0545fdcb56b039bfb08e4bb4d8c4d7c3c7d481c235",
  assetName: "484f534b59",
  symbol: "HOSKY",
  name: "HOSKY Token",
  decimals: 0,
  icon: "https://assets.coingecko.com/coins/images/20427/standard/hosky.png",
};

export const DJED_MAINNET_TOKEN: TokenInfo = {
  unit: "8db269c3ec630e06ae29f74bc39edd1f87c819f1056206e879a1cd61446a65644d6963726f555344",
  policyId: "8db269c3ec630e06ae29f74bc39edd1f87c819f1056206e879a1cd61",
  assetName: "446a65644d6963726f555344",
  symbol: "DJED",
  name: "Djed USD",
  decimals: 6,
  icon: "https://assets.coingecko.com/coins/images/28905/standard/djed.png",
};

export const IAG_MAINNET_TOKEN: TokenInfo = {
  unit: "5d16cc1a177b5d9ba9cfa9793b07e60f1fb70fea1f8aef064415d114494147",
  policyId: "5d16cc1a177b5d9ba9cfa9793b07e60f1fb70fea1f8aef064415d114",
  assetName: "494147",
  symbol: "IAG",
  name: "Iagon",
  decimals: 6,
  icon: "https://assets.coingecko.com/coins/images/17342/standard/iagon.png",
};

export const NMKR_MAINNET_TOKEN: TokenInfo = {
  unit: "5dac8536653edc12f6f5e1045d8164b9f59998d3bdc300fc928434894e4d4b52",
  policyId: "5dac8536653edc12f6f5e1045d8164b9f59998d3bdc300fc92843489",
  assetName: "4e4d4b52",
  symbol: "NMKR",
  name: "NMKR",
  decimals: 6,
  icon: "https://assets.coingecko.com/coins/images/25895/standard/nmkr.png",
};

export const INDY_MAINNET_TOKEN: TokenInfo = {
  unit: "533bb94a88614e341565774319fe0b8388500a3276996868f4e55d65494e4459",
  policyId: "533bb94a88614e341565774319fe0b8388500a3276996868f4e55d65",
  assetName: "494e4459",
  symbol: "INDY",
  name: "Indigo Protocol",
  decimals: 6,
  icon: "https://assets.coingecko.com/coins/images/28271/standard/indigo.png",
};

export const IBTC_MAINNET_TOKEN: TokenInfo = {
  unit: "f66d78b4a3cb3d37afa0ec36461e51ecbde00f26c8f0a68f94b6988069425443",
  policyId: "f66d78b4a3cb3d37afa0ec36461e51ecbde00f26c8f0a68f94b69880",
  assetName: "69425443",
  symbol: "iBTC",
  name: "Indigo iBTC",
  decimals: 6,
  icon: "https://assets.coingecko.com/coins/images/28272/standard/iBTC.png",
};

export const USDCX_MAINNET_TOKEN: TokenInfo = {
  unit: "1ecb116ddd0b118b436325054c2e6d2bd803d8f2f801b8793736d5355553444358",
  policyId: "1ecb116ddd0b118b436325054c2e6d2bd803d8f2f801b8793736d535",
  assetName: "5553444358",
  symbol: "USDCX",
  name: "Wanchain Bridged USDC",
  decimals: 6,
  icon: "https://assets.coingecko.com/coins/images/6319/standard/usdc.png",
};

export const USDC_ANZENS_MAINNET_TOKEN: TokenInfo = {
  unit: "1f3aec8bfe7ea4fe14c5f121e2a92e301afe414147860d557cac7e345553444378",
  policyId: "1f3aec8bfe7ea4fe14c5f121e2a92e301afe414147860d557cac7e34",
  assetName: "5553444378",
  symbol: "USDCx",
  name: "Anzens USDCx",
  decimals: 6,
  icon: "https://assets.coingecko.com/coins/images/6319/standard/usdc.png",
};

export const NIGHT_MAINNET_TOKEN: TokenInfo = {
  unit: "0691b2fecca1ac4f53cb6dfb00b7013e561d1f34403b957cbb5af1fa4e49474854",
  policyId: "0691b2fecca1ac4f53cb6dfb00b7013e561d1f34403b957cbb5af1fa",
  assetName: "4e49474854",
  symbol: "NIGHT",
  name: "Midnight (NIGHT)",
  decimals: 6,
};

export const DEFAULT_MAINNET_TOKENS: TokenInfo[] = [
  ADA_TOKEN,
  GENS_MAINNET_TOKEN,
  GENSX_MAINNET_TOKEN,
  SNEK_MAINNET_TOKEN,
  USDM_MAINNET_TOKEN,
  HOSKY_MAINNET_TOKEN,
  DJED_MAINNET_TOKEN,
  IAG_MAINNET_TOKEN,
  NMKR_MAINNET_TOKEN,
  INDY_MAINNET_TOKEN,
  IBTC_MAINNET_TOKEN,
  USDCX_MAINNET_TOKEN,
  USDC_ANZENS_MAINNET_TOKEN,
  NIGHT_MAINNET_TOKEN,
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
    baseToken: GENS_MAINNET_TOKEN,
    quoteToken: ADA_TOKEN,
  },
  {
    id: "GENS-USDM",
    baseToken: GENS_MAINNET_TOKEN,
    quoteToken: USDM_MAINNET_TOKEN,
  },
  {
    id: "GENSX-ADA",
    baseToken: GENSX_MAINNET_TOKEN,
    quoteToken: ADA_TOKEN,
  },
  {
    id: "SNEK-ADA",
    baseToken: SNEK_MAINNET_TOKEN,
    quoteToken: ADA_TOKEN,
  },
  {
    id: "USDM-ADA",
    baseToken: USDM_MAINNET_TOKEN,
    quoteToken: ADA_TOKEN,
  },
  {
    id: "HOSKY-ADA",
    baseToken: HOSKY_MAINNET_TOKEN,
    quoteToken: ADA_TOKEN,
  },
  {
    id: "DJED-ADA",
    baseToken: DJED_MAINNET_TOKEN,
    quoteToken: ADA_TOKEN,
  },
  {
    id: "IAG-ADA",
    baseToken: IAG_MAINNET_TOKEN,
    quoteToken: ADA_TOKEN,
  },
  {
    id: "NMKR-ADA",
    baseToken: NMKR_MAINNET_TOKEN,
    quoteToken: ADA_TOKEN,
  },
  {
    id: "iBTC-ADA",
    baseToken: IBTC_MAINNET_TOKEN,
    quoteToken: ADA_TOKEN,
  },
  {
    id: "INDY-ADA",
    baseToken: INDY_MAINNET_TOKEN,
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
