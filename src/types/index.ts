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
