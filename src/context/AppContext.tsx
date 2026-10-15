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
  MinswapPriceInfo,
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
  fillDexOrder,
  PlaceOrderParams,
} from "../services/trade";
import { fetchMinswapPrice } from "../services/minswap";
import { fillLiquidityVault, cancelLiquidityVault } from "../contracts/slv";
import { SignedOracleCertificate } from "../services/oracle";

interface AppContextType {
  settings: AppSettings;
  updateSettings: (newSettings: Partial<AppSettings>) => void;
  wallet: WalletState;
  availableWallets: AvailableWallet[];
  connectWalletById: (walletId: string, isAutoConnect?: boolean) => Promise<boolean>;
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
  fillOrder: (order: DexOrder, fillAmount?: bigint) => Promise<string>;
  minswapPrice: MinswapPriceInfo | null;
  loadingMinswapPrice: boolean;
  refreshMinswapPrice: () => Promise<void>;
  refreshWalletBalances: () => Promise<void>;
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

const getEnvKey = (key: string): string => {
  try {
    return (import.meta as any).env?.[key] || "";
  } catch {
    return "";
  }
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
    const envPreprod = getEnvKey("BLOCKFROST_API_KEY_PREPROD") || getEnvKey("VITE_BLOCKFROST_API_KEY_PREPROD");
    const envMainnet = getEnvKey("BLOCKFROST_API_KEY_MAINNET") || getEnvKey("BLOCKFROST_API_KEY") || getEnvKey("VITE_BLOCKFROST_API_KEY_MAINNET");

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
        if (!merged.blockfrostApiKeyPreprod && envPreprod) {
          merged.blockfrostApiKeyPreprod = envPreprod;
        }
        if (!merged.blockfrostApiKeyMainnet && envMainnet) {
          merged.blockfrostApiKeyMainnet = envMainnet;
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
    return {
      ...defaultSettings,
      blockfrostApiKeyMainnet: envMainnet,
      blockfrostApiKeyPreprod: envPreprod,
      blockfrostApiKey: defaultSettings.network === "mainnet" ? envMainnet : envPreprod,
    };
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

  const [minswapPrice, setMinswapPrice] = useState<MinswapPriceInfo | null>(null);
  const minswapPriceRef = useRef<MinswapPriceInfo | null>(null);
  useEffect(() => {
    minswapPriceRef.current = minswapPrice;
  }, [minswapPrice]);
  const [loadingMinswapPrice, setLoadingMinswapPrice] = useState<boolean>(false);

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

      const envPreprod = getEnvKey("BLOCKFROST_API_KEY_PREPROD") || getEnvKey("VITE_BLOCKFROST_API_KEY_PREPROD");
      const envMainnet = getEnvKey("BLOCKFROST_API_KEY_MAINNET") || getEnvKey("BLOCKFROST_API_KEY") || getEnvKey("VITE_BLOCKFROST_API_KEY_MAINNET");

      if (!updated.blockfrostApiKeyPreprod && envPreprod) {
        updated.blockfrostApiKeyPreprod = envPreprod;
      }
      if (!updated.blockfrostApiKeyMainnet && envMainnet) {
        updated.blockfrostApiKeyMainnet = envMainnet;
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
  const connectWalletById = async (walletId: string, isAutoConnect = false): Promise<boolean> => {
    if (!lucid) {
      if (!isAutoConnect) {
        const netName = settings.network === "preprod" ? "Preprod Testnet" : "Mainnet";
        setError(`Please configure your ${netName} Blockfrost API key in Settings first.`);
      }
      return false;
    }

    setWallet((prev) => ({ ...prev, connecting: true, error: null }));
    try {
      const details = await connectWallet(lucid, walletId);

      // Verify wallet network matches app settings network
      const isTestnetAddr = details.address.startsWith("addr_test1");
      const isMainnetAddr = details.address.startsWith("addr1");
      const isTestnetId = details.networkId === 0;
      const isMainnetId = details.networkId === 1;

      const isWalletMainnet = isMainnetAddr || isMainnetId;
      const isWalletTestnet = isTestnetAddr || isTestnetId;

      if (settings.network === "mainnet" && isWalletTestnet) {
        throw new Error(
          "Network mismatch: Your wallet extension is currently connected to Cardano Testnet (addr_test1...). Please switch your wallet extension to Cardano Mainnet and try again."
        );
      } else if (settings.network === "preprod" && isWalletMainnet) {
        throw new Error(
          "Network mismatch: Your wallet extension is currently connected to Cardano Mainnet (addr1...). Please open your wallet extension (e.g. Eternl), switch to Preprod Testnet and select a Preprod account, then try connecting again."
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
      setError(null);
      return true;
    } catch (err: any) {
      console.warn(`Failed to connect wallet (${walletId}):`, err);
      const errorMsg = err?.message || "Failed to connect wallet";
      // Clear wallet state completely so no stale cross-network balance or address is kept
      setWallet({
        ...initialWalletState,
        error: errorMsg,
      });
      try {
        localStorage.removeItem(CONNECTED_WALLET_STORAGE_KEY);
      } catch {
        // ignore
      }
      if (!isAutoConnect || errorMsg.includes("Network mismatch")) {
        setError(errorMsg);
      }
      return false;
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

  // Switch default pair and enforce clean wallet disconnection when network changes
  useEffect(() => {
    const pairs = getTradingPairs(settings.network);
    setActivePair((current) => {
      const match = pairs.find((p) => p.id === current.id);
      return match || pairs[0];
    });
    setOrderBook(initialOrderBook);
    setUserOrders([]);

    // If a wallet was already connected, check whether its address matches the new network
    if (wallet.connected && wallet.address) {
      const isTestnetAddr = wallet.address.startsWith("addr_test1");
      const isMainnetAddr = wallet.address.startsWith("addr1");
      const mismatch =
        (settings.network === "mainnet" && isTestnetAddr) ||
        (settings.network === "preprod" && isMainnetAddr);

      if (mismatch) {
        setWallet(initialWalletState);
        try {
          localStorage.removeItem(CONNECTED_WALLET_STORAGE_KEY);
        } catch {
          // ignore
        }
        setError(
          `Switched to ${settings.network === "preprod" ? "Preprod Testnet" : "Cardano Mainnet"}. Connected wallet was disconnected because its address is on the other network. Please switch your wallet extension (Eternl/Lace) to ${settings.network === "preprod" ? "Preprod" : "Mainnet"} and reconnect.`
        );
      }
    }
  }, [settings.network, wallet.connected, wallet.address]);

  // Cancel OrderBook fetch
  const cancelRefreshOrderBook = useCallback(() => {
    orderBookAbortRef.current.aborted = true;
    setLoadingOrderBook(false);
    setOrderBookProgress(null);
  }, []);

  // Refresh wallet balances
  const refreshWalletBalances = useCallback(async () => {
    if (!lucid || !wallet.connected) return;
    try {
      const utxos = await lucid.wallet().getUtxos();
      let balanceLovelace = 0n;
      const tokenBalances: Record<string, bigint> = {};
      for (const utxo of utxos) {
        for (const [unit, amount] of Object.entries(utxo.assets)) {
          if (unit === "lovelace") {
            balanceLovelace += amount;
          } else {
            tokenBalances[unit] = (tokenBalances[unit] || 0n) + amount;
          }
        }
      }
      setWallet((prev) => ({
        ...prev,
        balanceLovelace,
        tokenBalances,
      }));
    } catch (err) {
      console.warn("Failed to refresh wallet balances:", err);
    }
  }, [lucid, wallet.connected]);

  // Refresh OrderBook
  const refreshOrderBook = useCallback(async () => {
    if (!lucid) return;

    setLoadingOrderBook(true);
    setOrderBookProgress(null);
    orderBookAbortRef.current = { aborted: false };

    try {
      const userKeys = wallet.pkhs && wallet.pkhs.length > 0 ? wallet.pkhs : wallet.pkh || undefined;
      const refPrice =
        minswapPriceRef.current?.available && minswapPriceRef.current.priceBaseInQuote > 0
          ? minswapPriceRef.current.priceBaseInQuote
          : undefined;

      const book = await fetchAllOrdersForPair(
        lucid,
        settings.network,
        activePair,
        userKeys,
        (p) => setOrderBookProgress(p),
        orderBookAbortRef.current,
        refPrice
      );
      setOrderBook(book);

      if (userKeys && !orderBookAbortRef.current.aborted) {
        const myOrders = await fetchUserOrders(
          lucid,
          settings.network,
          userKeys,
          (p) => setOrderBookProgress(p),
          orderBookAbortRef.current,
          activePair,
          refPrice
        );
        setUserOrders(myOrders);
      } else if (!userKeys) {
        setUserOrders([]);
      }

      refreshWalletBalances();
    } catch (err: any) {
      console.error("Order book refresh error:", err);
    } finally {
      setLoadingOrderBook(false);
      setOrderBookProgress(null);
    }
  }, [lucid, settings.network, activePair, wallet.pkh, wallet.pkhs, refreshWalletBalances]);

  // Minswap price fetching
  const refreshMinswapPrice = useCallback(async () => {
    setLoadingMinswapPrice(true);
    try {
      const price = await fetchMinswapPrice(activePair, settings.network);
      setMinswapPrice(price);
    } catch (err) {
      console.warn("Minswap price fetch failed:", err);
    } finally {
      setLoadingMinswapPrice(false);
    }
  }, [activePair, settings.network]);

  // Refresh Minswap price whenever pair or network changes
  useEffect(() => {
    refreshMinswapPrice();
  }, [refreshMinswapPrice]);

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
      refreshMinswapPrice();
    }, settings.autoRefreshInterval * 1000);
    return () => clearInterval(interval);
  }, [lucid, settings.autoRefreshInterval, refreshOrderBook, refreshMinswapPrice]);

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

      // Await on-chain block confirmation before refreshing so the newly minted UTxO is indexed
      lucid
        .awaitTx(txHash)
        .then(() => {
          refreshOrderBook();
          refreshWalletBalances();
        })
        .catch((err) => {
          console.warn("awaitTx warning:", err);
          setTimeout(() => {
            refreshOrderBook();
            refreshWalletBalances();
          }, 20000);
        });

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
    setActionMessage(
      order.isVault
        ? "Building vault cancellation transaction..."
        : "Building order cancellation transaction..."
    );
    try {
      let txHash: string;
      if (order.isVault && order.vaultData) {
        txHash = await cancelLiquidityVault(lucid, order.vaultData);
        setActionMessage(`Vault cancelled: ${txHash.slice(0, 16)}...`);
      } else {
        const res = await cancelLimitOrder(lucid, order);
        txHash = res.txHash;
        setActionMessage(`Order cancelled: ${txHash.slice(0, 16)}...`);
      }

      // Optimistically remove cancelled order immediately from order book and user orders
      const orderMatch = (o: DexOrder) =>
        o.utxoRef.txHash === order.utxoRef.txHash &&
        o.utxoRef.outputIndex === order.utxoRef.outputIndex;

      setOrderBook((prev) => ({
        ...prev,
        bids: prev.bids.filter((b) => !orderMatch(b)),
        asks: prev.asks.filter((a) => !orderMatch(a)),
      }));
      setUserOrders((prev) => prev.filter((o) => !orderMatch(o)));

      // Await on-chain block confirmation before final sync
      lucid
        .awaitTx(txHash)
        .then(() => {
          refreshOrderBook();
          refreshWalletBalances();
        })
        .catch((err) => {
          console.warn("awaitTx warning:", err);
          setTimeout(() => {
            refreshOrderBook();
            refreshWalletBalances();
          }, 20000);
        });

      return txHash;
    } catch (err: any) {
      const msg = err?.message || "Failed to cancel order";
      setError(msg);
      throw err;
    } finally {
      setActionPending(false);
    }
  };

  // Fill Order (Partial or Complete)
  const fillOrder = async (order: DexOrder, fillAmount?: bigint): Promise<string> => {
    if (!lucid || !wallet.connected) {
      throw new Error("Wallet not connected.");
    }

    setActionPending(true);
    setActionMessage(
      order.isVault
        ? "Preparing Smart Liquidity Vault fill..."
        : "Building order fill transaction..."
    );

    try {
      let txHash: string;

      if (order.isVault && order.vaultData) {
        let oracleCert: SignedOracleCertificate | undefined;

        if (order.isDynamicOracle) {
          const isReverse = order.vaultDirection === "reverse";
          const baseToken = isReverse ? order.vaultData.tokenB : order.vaultData.tokenA;
          const quoteToken = isReverse ? order.vaultData.tokenA : order.vaultData.tokenB;

          setActionMessage("Requesting dual-source oracle certificate from daemon...");
          const certRes = await fetch("https://2.28.204.8.sslip.io/api/v1/oracle/certificate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              network: settings.network.toLowerCase(),
              baseAsset: {
                policyHex: baseToken.policyId || "",
                tokenHex: baseToken.assetName || "",
                symbol: baseToken.symbol || "",
              },
              quoteAsset: {
                policyHex: quoteToken.policyId || "",
                tokenHex: quoteToken.assetName || "",
                symbol: quoteToken.symbol || "",
              },
              symbol: baseToken.symbol !== "ADA" && baseToken.symbol !== "tADA" ? baseToken.symbol : quoteToken.symbol,
            }),
          });

          const certData = await certRes.json();
          if (!certRes.ok || !certData.approved) {
            throw new Error(
              certData.rejectionReason ||
              certData.error ||
              "Oracle refused certificate (price divergence circuit-breaker or daemon unavailable)."
            );
          }

          oracleCert = {
            network: certData.network,
            baseAsset: certData.baseAsset,
            quoteAsset: certData.quoteAsset,
            price: {
              numerator: BigInt(certData.price.numerator),
              denominator: BigInt(certData.price.denominator),
              approximateRate: certData.price.approximateRate,
            },
            timestampMs: BigInt(certData.timestampMs),
            signatureHex: certData.signatureHex,
            oraclePubKeyHex: certData.oraclePubKeyHex,
            cborHex: certData.cborHex || "",
            quotes: certData.quotes,
            divergencePercent: certData.divergencePercent,
          };
        }

        setActionMessage("Building and signing vault fill transaction...");
        const fillAmt = fillAmount && fillAmount > 0n ? fillAmount : order.offeredAmount;
        txHash = await fillLiquidityVault(lucid, {
          vault: order.vaultData,
          fillAmount: fillAmt,
          direction: order.vaultDirection || "straight",
          oracleCertificate: oracleCert,
          recipientAddress: wallet.address || undefined,
        });
        setActionMessage(`Vault filled: ${txHash.slice(0, 16)}...`);
      } else {
        const { txHash: normalHash } = await fillDexOrder(lucid, {
          order,
          fillAmount,
        });
        txHash = normalHash;
        setActionMessage(`Order filled: ${txHash.slice(0, 16)}...`);
      }

      const orderMatch = (o: DexOrder) =>
        o.utxoRef.txHash === order.utxoRef.txHash &&
        o.utxoRef.outputIndex === order.utxoRef.outputIndex;

      const isCompleteFill = !fillAmount || fillAmount >= order.offeredAmount;

      if (isCompleteFill || order.isVault) {
        // Optimistically remove completely filled order or spent vault UTxO immediately
        setOrderBook((prev) => ({
          ...prev,
          bids: prev.bids.filter((b) => !orderMatch(b)),
          asks: prev.asks.filter((a) => !orderMatch(a)),
        }));
        setUserOrders((prev) => prev.filter((o) => !orderMatch(o)));
      } else {
        // Partial fill: decrement offered amount optimistically
        const remaining = order.offeredAmount - fillAmount;
        const updateOrder = (o: DexOrder): DexOrder =>
          orderMatch(o) ? { ...o, offeredAmount: remaining } : o;

        setOrderBook((prev) => ({
          ...prev,
          bids: prev.bids.map(updateOrder),
          asks: prev.asks.map(updateOrder),
        }));
        setUserOrders((prev) => prev.map(updateOrder));
      }

      // Await on-chain block confirmation before final sync
      lucid
        .awaitTx(txHash)
        .then(() => {
          refreshOrderBook();
          refreshWalletBalances();
        })
        .catch((err) => {
          console.warn("awaitTx warning:", err);
          setTimeout(() => {
            refreshOrderBook();
            refreshWalletBalances();
          }, 20000);
        });

      return txHash;
    } catch (err: any) {
      const msg = err?.message || "Failed to fill order";
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
        fillOrder,
        minswapPrice,
        loadingMinswapPrice,
        refreshMinswapPrice,
        refreshWalletBalances,
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
