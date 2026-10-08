export type NetworkType = "mainnet" | "preprod";

export interface TokenInfo {
  unit: string; // 'lovelace' or policyId + assetNameHex
  symbol: string;
  name: string;
  decimals: number;
  policyId?: string;
  assetName?: string;
  icon?: string;
}

export interface TradingPair {
  id: string; // e.g. "GENS-ADA"
  baseToken: TokenInfo; // usually the traded token (e.g. GENS)
  quoteToken: TokenInfo; // usually ADA
}

export interface RationalPrice {
  numerator: bigint;
  denominator: bigint;
}

export interface DexOrder {
  utxoRef: {
    txHash: string;
    outputIndex: number;
  };
  ownerAddress: string;
  ownerKey: string;
  offeredAsset: string;
  offeredAmount: bigint;
  offeredOriginalAmount: bigint;
  askedAsset: string;
  price: RationalPrice;
  effectivePrice: number; // numeric price (quote / base)
  orderType: "bid" | "ask";
  nftUnit: string;
  depositLovelace: bigint;
  partialFills: bigint;
  start?: bigint | null;
  end?: bigint | null;
  isExpired?: boolean;
  isUserOrder?: boolean;
}

export interface OrderBook {
  bids: DexOrder[]; // Buy orders: sorted descending by price
  asks: DexOrder[]; // Sell orders: sorted ascending by price
  highestBid: number | null;
  lowestAsk: number | null;
  spread: number | null;
  spreadPercentage: number | null;
}

export interface WalletState {
  connected: boolean;
  connecting: boolean;
  walletName: string | null;
  address: string | null;
  usedAddresses?: string[];
  rewardAddress?: string | null;
  pkh: string | null;
  pkhs?: string[];
  balanceLovelace: bigint;
  tokenBalances: Record<string, bigint>;
  error: string | null;
}

export interface AppSettings {
  network: NetworkType;
  blockfrostApiKey: string;
  blockfrostApiKeyMainnet?: string;
  blockfrostApiKeyPreprod?: string;
  customTokens: TokenInfo[];
  autoRefreshInterval: number; // in seconds, 0 = disabled
}

export interface FetchProgress {
  current: number;
  total: number;
  stage: string;
  itemType?: string; // e.g. "UTxOs", "Orders", "Vaults", "Addresses"
}

export interface MinswapPriceInfo {
  available: boolean;
  baseSymbol: string;
  quoteSymbol: string;
  priceBaseInQuote: number; // 1 Base Token = X Quote Tokens (e.g. 1 GENS = 0.000774 ADA)
  priceQuoteInBase: number; // 1 Quote Token = Y Base Tokens (e.g. 1 ADA = 1,292.66 GENS)
  baseUsdPrice?: number;
  quoteUsdPrice?: number;
  lastUpdated: number;
  error?: string;
}

export type VaultPricingType = "fixed" | "delta_oracle" | "oracle_range";

export interface LiquidityVaultPrice {
  priceAtoB: number; // 1 Unit of Token A = X Units of Token B
  priceBtoA: number; // 1 Unit of Token B = Y Units of Token A
  formattedAtoB: string;
  formattedBtoA: string;
  hasReverse?: boolean;
  reversePriceAtoB?: number;
  reversePriceBtoA?: number;
  formattedReverseAtoB?: string;
  formattedReverseBtoA?: string;
}

export interface LiquidityVaultOracleDelta {
  oracleKey?: string;
  straightSpreadPercent: number; // e.g. 2.0 (%)
  straightOffset: number;
  hasReverse: boolean;
  reverseSpreadPercent?: number;
  reverseOffset?: number;
  formattedStraight: string; // e.g. "+2.0% spread"
  formattedReverse?: string;
}

export interface LiquidityVaultRange {
  minPriceBtoA: number;
  maxPriceBtoA: number;
  minPriceAtoB: number;
  maxPriceAtoB: number;
  formattedRangeBtoA: string;
  formattedRangeAtoB: string;
  oracleHash?: string;
}

export interface CanonicalPair {
  base: TokenInfo;
  quote: TokenInfo;
  pairKey: string;
  isReversed: boolean;
}

export interface LiquidityVault {
  utxoRef: {
    txHash: string;
    outputIndex: number;
  };
  ownerKey: string;
  ownerAddress?: string;
  isUserVault: boolean;
  nftUnit: string;
  nftTokenName: string;
  tokenA: TokenInfo;
  tokenB: TokenInfo;
  amountA: bigint;
  amountB: bigint;
  formattedAmountA: string;
  formattedAmountB: string;
  pricingType: VaultPricingType;
  fixedPrice?: LiquidityVaultPrice;
  oracleDelta?: LiquidityVaultOracleDelta;
  oracleRange?: LiquidityVaultRange;
  canonicalPair: CanonicalPair;
  containedFeeLovelace?: bigint;
  rawDatumHex?: string;
}


