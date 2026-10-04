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
  connectWalletById: (walletId: string, isAutoConnect?: boolean) => Promise<void>;
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
const CONNECTED_WALLET_STORAGE_KEY = "genius_zero_connected_wallet";

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
        const parsed = JSON.parse(saved);
        const merged: AppSettings = { ...defaultSettings, ...parsed };
        // Normalize keys if one was previously stored in blockfrostApiKey
        if (!merged.blockfrostApiKeyMainnet && merged.blockfrostApiKey?.startsWith("mainnet")) {
          merged.blockfrostApiKeyMainnet = merged.blockfrostApiKey;
        }
        if (!merged.blockfrostApiKeyPreprod && merged.blockfrostApiKey?.startsWith("preprod")) {
          merged.blockfrostApiKeyPreprod = merged.blockfrostApiKey;
        }
        // Ensure active key matches the current network
        merged.blockfrostApiKey =
          merged.network === "mainnet"
            ? (merged.blockfrostApiKeyMainnet || "")
            : (merged.blockfrostApiKeyPreprod || "");
        return merged;
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
      let updated: AppSettings = { ...prev, ...newSettings };

      // Handle explicit mainnet key updates
      if (newSettings.blockfrostApiKeyMainnet !== undefined) {
        updated.blockfrostApiKeyMainnet = newSettings.blockfrostApiKeyMainnet.trim();
      }
      // Handle explicit preprod key updates
      if (newSettings.blockfrostApiKeyPreprod !== undefined) {
        updated.blockfrostApiKeyPreprod = newSettings.blockfrostApiKeyPreprod.trim();
      }

      // Backwards compatibility: if legacy blockfrostApiKey was passed directly
      if (newSettings.blockfrostApiKey !== undefined) {
        const key = newSettings.blockfrostApiKey.trim();
        if (key.startsWith("mainnet")) {
          updated.blockfrostApiKeyMainnet = key;
        } else if (key.startsWith("preprod")) {
          updated.blockfrostApiKeyPreprod = key;
        }
      }

      // Ensure active blockfrostApiKey matches active network
      const activeNetwork = updated.network || "mainnet";
      updated.blockfrostApiKey =
        activeNetwork === "mainnet"
          ? (updated.blockfrostApiKeyMainnet || "")
          : (updated.blockfrostApiKeyPreprod || "");

      try {
        localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(updated));
      } catch {
        // ignore
      }
      return updated;
    });
  };

  // Check available CIP-30 wallets with immediate quick-poll for fast extension injections
  useEffect(() => {
    setAvailableWallets(getAvailableWallets());
    const t1 = setTimeout(() => setAvailableWallets(getAvailableWallets()), 250);
    const t2 = setTimeout(() => setAvailableWallets(getAvailableWallets()), 600);
    const t3 = setTimeout(() => setAvailableWallets(getAvailableWallets()), 1200);
    const interval = setInterval(() => {
      setAvailableWallets(getAvailableWallets());
    }, 2000);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
      clearInterval(interval);
    };
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
  const connectWalletById = async (walletId: string, isAutoConnect = false) => {
    if (!lucid) {
      if (!isAutoConnect) {
        setError("Please configure your Blockfrost API key in Settings first.");
      }
      return;
    }

    setWallet((prev) => ({ ...prev, connecting: true, error: null }));
    try {
      const details = await connectWallet(lucid, walletId);

      // Verify wallet network matches app settings network
      const isTestnetAddr = details.address.startsWith("addr_test1");
      const isMainnetAddr = details.address.startsWith("addr1");
      if (settings.network === "mainnet" && isTestnetAddr) {
        throw new Error(
          "Network mismatch: Your wallet is connected to Cardano Testnet, but Genius Zero is set to Mainnet. Please switch your wallet network to Mainnet."
        );
      } else if (settings.network === "preprod" && isMainnetAddr) {
        throw new Error(
          "Network mismatch: Your wallet is connected to Cardano Mainnet, but Genius Zero is set to Preprod Testnet. Please switch your wallet network/account to Preprod."
        );
      }

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

      try {
        localStorage.setItem(CONNECTED_WALLET_STORAGE_KEY, walletId);
      } catch {
        // ignore
      }
    } catch (err: any) {
      console.warn(`Failed to connect wallet (${walletId}):`, err);
      setWallet((prev) => ({
        ...prev,
        connecting: false,
        error: isAutoConnect ? null : err?.message || "Failed to connect wallet",
      }));
    }
  };

  const disconnectWallet = () => {
    try {
      localStorage.removeItem(CONNECTED_WALLET_STORAGE_KEY);
    } catch {
      // ignore
    }
    setWallet(initialWalletState);
  };

  // Auto-reconnect saved wallet on reload or when Lucid is reconfigured
  const prevLucidRef = useRef<LucidEvolution | null>(null);
  const autoConnectAttemptedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!lucid) {
      prevLucidRef.current = null;
      return;
    }

    const isNewLucid = prevLucidRef.current !== lucid;
    prevLucidRef.current = lucid;

    let savedWalletId: string | null = null;
    try {
      savedWalletId = localStorage.getItem(CONNECTED_WALLET_STORAGE_KEY);
    } catch {
      return;
    }

    if (!savedWalletId) return;

    // If already connected with this exact lucid instance and wallet, skip
    if (wallet.connected && wallet.walletName === savedWalletId && !isNewLucid) {
      return;
    }

    // If connecting right now, skip
    if (wallet.connecting) return;

    if (isNewLucid) {
      autoConnectAttemptedRef.current = null;
    }

    if (autoConnectAttemptedRef.current === savedWalletId && !isNewLucid) {
      return;
    }

    let cancelled = false;
    let attempts = 0;
    const maxAttempts = 20; // 20 * 150ms = 3.0s

    const checkAndConnect = async () => {
      if (cancelled) return;
      const cardano = (window as any).cardano;
      const targetWallet = cardano?.[savedWalletId!];

      if (targetWallet) {
        autoConnectAttemptedRef.current = savedWalletId;
        try {
          let isAuthorized = true;
          if (typeof targetWallet.isEnabled === "function") {
            try {
              isAuthorized = await targetWallet.isEnabled();
            } catch {
              isAuthorized = true;
            }
          }

          if (isAuthorized && !cancelled) {
            await connectWalletById(savedWalletId!, true);
          }
        } catch (err) {
          console.warn("Auto-reconnect error:", err);
        }
        return;
      }

      attempts++;
      if (attempts < maxAttempts && !cancelled) {
        setTimeout(checkAndConnect, 150);
      }
    };

    checkAndConnect();

    return () => {
      cancelled = true;
    };
  }, [lucid, wallet.connected, wallet.connecting, wallet.walletName]);

  // Re-sync wallet on window focus if already connected (e.g. account switched in Eternl)
  useEffect(() => {
    const handleFocus = async () => {
      if (!lucid || !wallet.connected || !wallet.walletName || wallet.connecting) return;
      try {
        const cardano = (window as any).cardano;
        const target = cardano?.[wallet.walletName];
        if (!target) return;
        if (typeof target.isEnabled === "function") {
          const enabled = await target.isEnabled();
          if (!enabled) {
            disconnectWallet();
            return;
          }
        }
        const currentAddr = await lucid.wallet().address();
        if (currentAddr !== wallet.address) {
          await connectWalletById(wallet.walletName, true);
        }
      } catch (err) {
        console.warn("Focus wallet check warning:", err);
      }
    };

    window.addEventListener("focus", handleFocus);
    return () => window.removeEventListener("focus", handleFocus);
  }, [lucid, wallet.connected, wallet.walletName, wallet.address, wallet.connecting]);

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
