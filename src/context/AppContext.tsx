import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from "react";
import { LucidEvolution } from "@lucid-evolution/lucid";
import {
  AppSettings,
  DexOrder,
  NetworkType,
  OrderBook,
  TradingPair,
  WalletState,
  FetchProgress,
} from "../types";
import {
  DEFAULT_TRADING_PAIRS,
  DEX_CONSTANTS,
  getTradingPairs,
} from "../config/dex";
import {
  connectWallet,
  getAvailableWallets,
  getLucid,
  AvailableWallet,
} from "../services/lucid";
import {
  fetchAllOrdersForPair,
  fetchUserOrders,
} from "../services/orderbook";
import {
  placeLimitOrder,
  cancelLimitOrder,
  PlaceOrderParams,
} from "../services/trade";

interface AppContextType {
  settings: AppSettings;
  updateSettings: (newSettings: Partial<AppSettings>) => void;
  wallet: WalletState;
  availableWallets: AvailableWallet[];
  connectWalletById: (walletId: string) => Promise<void>;
  disconnectWallet: () => void;
  activePair: TradingPair;
  setActivePair: (pair: TradingPair) => void;
  orderBook: OrderBook;
  userOrders: DexOrder[];
  loadingOrderBook: boolean;
  orderBookProgress: FetchProgress | null;
  refreshOrderBook: () => Promise<void>;
  cancelRefreshOrderBook: () => void;
  placeOrder: (params: Omit<PlaceOrderParams, "pair">) => Promise<string>;
  cancelOrder: (order: DexOrder) => Promise<string>;
  actionPending: boolean;
  actionMessage: string | null;
  error: string | null;
  clearError: () => void;
  lucid: LucidEvolution | null;
}

const SETTINGS_STORAGE_KEY = "genius_zero_settings";

const defaultSettings: AppSettings = {
  network: "mainnet",
  blockfrostApiKey: "",
  customTokens: [],
  autoRefreshInterval: 30,
};

const initialOrderBook: OrderBook = {
  bids: [],
  asks: [],
  highestBid: null,
  lowestAsk: null,
  spread: null,
  spreadPercentage: null,
};

const initialWalletState: WalletState = {
  connected: false,
  connecting: false,
  walletName: null,
  address: null,
  pkh: null,
  balanceLovelace: 0n,
  tokenBalances: {},
  error: null,
};

const AppContext = createContext<AppContextType | null>(null);

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [settings, setSettings] = useState<AppSettings>(() => {
    try {
      const saved = localStorage.getItem(SETTINGS_STORAGE_KEY);
      if (saved) {
        return { ...defaultSettings, ...JSON.parse(saved) };
      }
    } catch {
      // ignore
    }
    return defaultSettings;
  });

  const [wallet, setWallet] = useState<WalletState>(initialWalletState);
  const [availableWallets, setAvailableWallets] = useState<AvailableWallet[]>([]);
  const [activePair, setActivePair] = useState<TradingPair>(DEFAULT_TRADING_PAIRS[0]);
  const [orderBook, setOrderBook] = useState<OrderBook>(initialOrderBook);
  const [userOrders, setUserOrders] = useState<DexOrder[]>([]);
  const [loadingOrderBook, setLoadingOrderBook] = useState<boolean>(false);
  const [orderBookProgress, setOrderBookProgress] = useState<FetchProgress | null>(null);
  const orderBookAbortRef = useRef<{ aborted: boolean }>({ aborted: false });
  const [actionPending, setActionPending] = useState<boolean>(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [lucid, setLucid] = useState<LucidEvolution | null>(null);

  // Save settings on update
  const updateSettings = (newSettings: Partial<AppSettings>) => {
    setSettings((prev) => {
      let updated = { ...prev, ...newSettings };

      // If blockfrostApiKey was provided, save into the network-specific slot
      if (newSettings.blockfrostApiKey !== undefined) {
        const key = newSettings.blockfrostApiKey.trim();
        if (key.startsWith("mainnet")) {
          updated.blockfrostApiKeyMainnet = key;
        } else if (key.startsWith("preprod")) {
          updated.blockfrostApiKeyPreprod = key;
        }
      }

      // If switching network, auto-populate active key from network-specific slot if present
      if (newSettings.network && newSettings.network !== prev.network) {
        if (newSettings.network === "mainnet") {
          updated.blockfrostApiKey =
            updated.blockfrostApiKeyMainnet ||
            (updated.blockfrostApiKey.startsWith("mainnet")
              ? updated.blockfrostApiKey
              : "");
        } else if (newSettings.network === "preprod") {
          updated.blockfrostApiKey =
            updated.blockfrostApiKeyPreprod ||
            (updated.blockfrostApiKey.startsWith("preprod")
              ? updated.blockfrostApiKey
              : "");
        }
      }

      try {
        localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(updated));
      } catch {
        // ignore
      }
      return updated;
    });
  };

  // Check available CIP-30 wallets
  useEffect(() => {
    setAvailableWallets(getAvailableWallets());
    const interval = setInterval(() => {
      setAvailableWallets(getAvailableWallets());
    }, 2000);
    return () => clearInterval(interval);
  }, []);

  // Initialize or reconfigure Lucid when apiKey or network changes
  useEffect(() => {
    if (!settings.blockfrostApiKey) {
      setLucid(null);
      return;
    }

    let isMounted = true;
    getLucid(settings.blockfrostApiKey, settings.network)
      .then((instance) => {
        if (isMounted) {
          setLucid(instance);
          setError(null);
        }
      })
      .catch((err) => {
        if (isMounted) {
          setError(
            `Failed to initialize Blockfrost connection: ${err?.message || "Invalid API key or network mismatch"}`
          );
        }
      });

    return () => {
      isMounted = false;
    };
  }, [settings.blockfrostApiKey, settings.network]);

  // Connect wallet
  const connectWalletById = async (walletId: string) => {
    if (!lucid) {
      setError("Please configure your Blockfrost API key in Settings first.");
      return;
    }

    setWallet((prev) => ({ ...prev, connecting: true, error: null }));
    try {
      const details = await connectWallet(lucid, walletId);
      setWallet({
        connected: true,
        connecting: false,
        walletName: walletId,
        address: details.address,
        usedAddresses: details.usedAddresses,
        rewardAddress: details.rewardAddress,
        pkh: details.pkh,
        pkhs: details.pkhs,
        balanceLovelace: details.balanceLovelace,
        tokenBalances: details.tokenBalances,
        error: null,
      });
    } catch (err: any) {
      setWallet((prev) => ({
        ...prev,
        connecting: false,
        error: err?.message || "Failed to connect wallet",
      }));
    }
  };

  const disconnectWallet = () => {
    setWallet(initialWalletState);
  };

  // Switch default pair when network changes
  useEffect(() => {
    const pairs = getTradingPairs(settings.network);
    setActivePair((current) => {
      const match = pairs.find((p) => p.id === current.id);
      return match || pairs[0];
    });
    setOrderBook(initialOrderBook);
  }, [settings.network]);

  // Cancel OrderBook fetch
  const cancelRefreshOrderBook = useCallback(() => {
    orderBookAbortRef.current.aborted = true;
    setLoadingOrderBook(false);
    setOrderBookProgress(null);
  }, []);

  // Refresh OrderBook
  const refreshOrderBook = useCallback(async () => {
    if (!lucid) return;

    setLoadingOrderBook(true);
    setOrderBookProgress(null);
    orderBookAbortRef.current = { aborted: false };

    try {
      const userKeys = wallet.pkhs && wallet.pkhs.length > 0 ? wallet.pkhs : wallet.pkh || undefined;
      const book = await fetchAllOrdersForPair(
        lucid,
        settings.network,
        activePair,
        userKeys,
        (p) => setOrderBookProgress(p),
        orderBookAbortRef.current
      );
      setOrderBook(book);

      if (userKeys && !orderBookAbortRef.current.aborted) {
        const myOrders = await fetchUserOrders(
          lucid,
          settings.network,
          userKeys,
          (p) => setOrderBookProgress(p),
          orderBookAbortRef.current
        );
        setUserOrders(myOrders);
      } else if (!userKeys) {
        setUserOrders([]);
      }
    } catch (err: any) {
      console.error("Order book refresh error:", err);
    } finally {
      setLoadingOrderBook(false);
      setOrderBookProgress(null);
    }
  }, [lucid, settings.network, activePair, wallet.pkh, wallet.pkhs]);

  // Trigger refresh when pair, network, or lucid changes
  useEffect(() => {
    if (lucid) {
      refreshOrderBook();
    }
  }, [lucid, activePair, refreshOrderBook]);

  // Auto-refresh timer
  useEffect(() => {
    if (!lucid || settings.autoRefreshInterval <= 0) return;
    const interval = setInterval(() => {
      refreshOrderBook();
    }, settings.autoRefreshInterval * 1000);
    return () => clearInterval(interval);
  }, [lucid, settings.autoRefreshInterval, refreshOrderBook]);

  // Place Limit Order
  const placeOrder = async (params: Omit<PlaceOrderParams, "pair">): Promise<string> => {
    if (!lucid || !wallet.connected) {
      throw new Error("Wallet not connected or Blockfrost key missing.");
    }

    setActionPending(true);
    setActionMessage("Building and signing order transaction...");
    try {
      const { txHash } = await placeLimitOrder(lucid, {
        ...params,
        pair: activePair,
      });
      setActionMessage(`Transaction submitted: ${txHash.slice(0, 16)}...`);
      // Trigger orderbook refresh after short delay
      setTimeout(() => refreshOrderBook(), 4000);
      return txHash;
    } catch (err: any) {
      const msg = err?.message || "Failed to place order";
      setError(msg);
      throw err;
    } finally {
      setActionPending(false);
    }
  };

  // Cancel Order
  const cancelOrder = async (order: DexOrder): Promise<string> => {
    if (!lucid || !wallet.connected) {
      throw new Error("Wallet not connected.");
    }

    setActionPending(true);
    setActionMessage("Building order cancellation transaction...");
    try {
      const { txHash } = await cancelLimitOrder(lucid, order);
      setActionMessage(`Order cancelled: ${txHash.slice(0, 16)}...`);
      setTimeout(() => refreshOrderBook(), 4000);
      return txHash;
    } catch (err: any) {
      const msg = err?.message || "Failed to cancel order";
      setError(msg);
      throw err;
    } finally {
      setActionPending(false);
    }
  };

  const clearError = () => setError(null);

  return (
    <AppContext.Provider
      value={{
        settings,
        updateSettings,
        wallet,
        availableWallets,
        connectWalletById,
        disconnectWallet,
        activePair,
        setActivePair,
        orderBook,
        userOrders,
        loadingOrderBook,
        orderBookProgress,
        refreshOrderBook,
        cancelRefreshOrderBook,
        placeOrder,
        cancelOrder,
        actionPending,
        actionMessage,
        error,
        clearError,
        lucid,
      }}
    >
      {children}
    </AppContext.Provider>
  );
};

export const useApp = () => {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error("useApp must be used within an AppProvider");
  }
  return context;
};
