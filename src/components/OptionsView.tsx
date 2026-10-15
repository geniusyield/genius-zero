import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { paymentCredentialOf } from "@lucid-evolution/lucid";
import {
  TrendingUp,
  ShieldCheck,
  AlertTriangle,
  ExternalLink,
  Loader2,
  RefreshCw,
  Wallet,
  CheckCircle2,
  Clock,
  Coins,
  Zap,
  Flame,
  ArrowRight,
  ArrowUpDown,
  Search,
  Filter,
  PlusCircle,
  Info,
  Calendar,
  Layers,
  ChevronDown,
  Globe,
  Store,
  ShoppingCart,
  Tag,
  DollarSign,
  XCircle,
  SlidersHorizontal,
  AlertCircle,
  X,
} from "lucide-react";
import { useApp } from "../context/AppContext";
import {
  fetchActiveOptions,
  createOptionTradingPair,
  addStoredSpentOption,
  OptionPosition,
  OptionMarketListing,
  fetchOptionMarketListings,
  formatDateTimeDual,
  FormattedDateTimeDual,
  calculateMakerFeeTokens,
  calculateTotalRequiredTokens,
  calculateMaxSellableOptions,
  formatFriendlyError,
} from "../services/options";
import { placeLimitOrder, fillDexOrder, cancelLimitOrder } from "../services/trade";
import {
  createOption,
  executeOption,
  cancelEarlyOption,
  retrieveOption,
  ADA_OPTION_ASSET,
  OptionAsset,
  Rational,
  OptionStyle,
  calculateRequiredPayment,
  isAdaAsset,
} from "../contracts/options";
import { getDefaultTokens, DEX_CONSTANTS } from "../config/dex";
import { FetchProgress, TokenInfo, TradingPair } from "../types";
import { ProgressBar } from "./ProgressBar";

const formatDatetimeInputValue = (ms: number, mode: "local" | "utc"): string => {
  if (!ms || isNaN(ms)) return "";
  const d = new Date(ms);
  const pad = (n: number) => n.toString().padStart(2, "0");
  if (mode === "utc") {
    const y = d.getUTCFullYear();
    const m = pad(d.getUTCMonth() + 1);
    const day = pad(d.getUTCDate());
    const h = pad(d.getUTCHours());
    const min = pad(d.getUTCMinutes());
    return `${y}-${m}-${day}T${h}:${min}`;
  } else {
    const y = d.getFullYear();
    const m = pad(d.getMonth() + 1);
    const day = pad(d.getDate());
    const h = pad(d.getHours());
    const min = pad(d.getMinutes());
    return `${y}-${m}-${day}T${h}:${min}`;
  }
};

const parseDatetimeInputValue = (val: string, mode: "local" | "utc"): number => {
  if (!val) return 0;
  if (mode === "utc") {
    return new Date(`${val}:00Z`).getTime();
  } else {
    const [datePart, timePart] = val.split("T");
    if (!datePart || !timePart) return 0;
    const [year, month, day] = datePart.split("-").map(Number);
    const [hours, minutes] = timePart.split(":").map(Number);
    return new Date(year, month - 1, day, hours, minutes, 0, 0).getTime();
  }
};

const EXPIRATION_PRESETS = [
  { label: "+1 Day", days: 1 },
  { label: "+3 Days", days: 3 },
  { label: "+7 Days", days: 7 },
  { label: "+14 Days", days: 14 },
  { label: "+30 Days", days: 30 },
  { label: "+90 Days", days: 90 },
  { label: "+180 Days", days: 180 },
];

const START_PRESETS = [
  { label: "Immediately (Now)", ms: 0 },
  { label: "+1 Hour", ms: 3_600_000 },
  { label: "+1 Day", ms: 86_400_000 },
  { label: "+3 Days", ms: 3 * 86_400_000 },
  { label: "+7 Days", ms: 7 * 86_400_000 },
];

interface OptionsViewProps {
  onOpenWallet: () => void;
  onOpenSettings: () => void;
  onSelectDexPair?: (pair: TradingPair) => void;
}

export const OptionsView: React.FC<OptionsViewProps> = ({
  onOpenWallet,
  onOpenSettings,
  onSelectDexPair,
}) => {
  const { wallet, settings, lucid, setActivePair, refreshWalletBalances } = useApp();
  const [positions, setPositions] = useState<OptionPosition[]>([]);
  const [listings, setListings] = useState<OptionMarketListing[]>([]);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<FetchProgress | null>(null);
  const abortRef = useRef<{ aborted: boolean }>({ aborted: false });

  // View Mode: Marketplace (default), All Contracts, My Portfolio
  const [viewMode, setViewMode] = useState<"MARKETPLACE" | "ALL_CONTRACTS" | "MY_PORTFOLIO">("MARKETPLACE");

  // Multi-Dimension Filtering & Search
  const [searchQuery, setSearchQuery] = useState("");
  const [tabFilter, setTabFilter] = useState<
    "ALL" | "MY_POSITIONS" | "MY_WRITTEN" | "EXERCISABLE" | "EXPIRED"
  >("ALL");
  const [filterUnderlying, setFilterUnderlying] = useState<string>("ALL");
  const [filterStrikeAsset, setFilterStrikeAsset] = useState<string>("ALL");
  const [filterQuoteCurrency, setFilterQuoteCurrency] = useState<string>("ALL");
  const [styleFilter, setStyleFilter] = useState<"ALL" | "American" | "European" | "Custom">("ALL");
  const [filterStatus, setFilterStatus] = useState<"ALL" | "FOR_SALE" | "ACTIVE" | "EXPIRED">("ALL");

  // Modals state
  const [showWriteModal, setShowWriteModal] = useState(false);
  const [executingPosition, setExecutingPosition] = useState<OptionPosition | null>(null);
  const [executeAmount, setExecuteAmount] = useState<string>("1");
  const [cancelingPosition, setCancelingPosition] = useState<OptionPosition | null>(null);
  const [cancelAmount, setCancelAmount] = useState<string>("1");
  const [retrievingPosition, setRetrievingPosition] = useState<OptionPosition | null>(null);

  // Marketplace Modals:
  const [listingPosition, setListingPosition] = useState<OptionPosition | null>(null);
  const [listingAmount, setListingAmount] = useState<string>("1");
  const [listingQuoteUnit, setListingQuoteUnit] = useState<string>("lovelace");
  const [listingPricePerOption, setListingPricePerOption] = useState<string>("2.0");

  const [buyingListing, setBuyingListing] = useState<OptionMarketListing | null>(null);
  const [buyQuantity, setBuyQuantity] = useState<string>("1");

  // Action status state
  const [actionPending, setActionPending] = useState(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [latestTxHash, setLatestTxHash] = useState<string | null>(null);

  // Write Option form state
  const [writeStyle, setWriteStyle] = useState<OptionStyle>("American");
  const [writeDepositAssetUnit, setWriteDepositAssetUnit] = useState<string>("");
  const [writePaymentAssetUnit, setWritePaymentAssetUnit] = useState<string>("lovelace");
  const [writeDepositAmount, setWriteDepositAmount] = useState<string>("10");
  const [writeStrikePrice, setWriteStrikePrice] = useState<string>("1.0");

  // Timezone & DateTime state
  const [writeTimezoneMode, setWriteTimezoneMode] = useState<"local" | "utc">("local");
  const [writeExpirationMs, setWriteExpirationMs] = useState<number>(() => {
    const d = new Date(Date.now() + 7 * 86_400_000);
    d.setMinutes(Math.ceil(d.getMinutes() / 10) * 10, 0, 0);
    return d.getTime();
  });
  const [writeStartMs, setWriteStartMs] = useState<number>(Date.now());
  const [writeCutoffMs, setWriteCutoffMs] = useState<number | null>(null);

  const [writeExpirationInput, setWriteExpirationInput] = useState<string>(() =>
    formatDatetimeInputValue(Date.now() + 7 * 86_400_000, "local")
  );
  const [writeStartInput, setWriteStartInput] = useState<string>(() =>
    formatDatetimeInputValue(Date.now(), "local")
  );
  const [writeCutoffInput, setWriteCutoffInput] = useState<string>("");
  const [showCustomCutoff, setShowCustomCutoff] = useState<boolean>(false);

  const handleToggleTimezoneMode = (mode: "local" | "utc") => {
    setWriteTimezoneMode(mode);
    setWriteExpirationInput(formatDatetimeInputValue(writeExpirationMs, mode));
    setWriteStartInput(formatDatetimeInputValue(writeStartMs, mode));
    if (writeCutoffMs) {
      setWriteCutoffInput(formatDatetimeInputValue(writeCutoffMs, mode));
    }
  };

  const handleApplyExpirationPreset = (days: number) => {
    const targetMs = Date.now() + days * 86_400_000;
    setWriteExpirationMs(targetMs);
    setWriteExpirationInput(formatDatetimeInputValue(targetMs, writeTimezoneMode));
  };

  const handleSetUtcHour = (hour: number) => {
    const d = new Date(writeExpirationMs);
    d.setUTCHours(hour, 0, 0, 0);
    if (d.getTime() <= Date.now()) {
      d.setUTCDate(d.getUTCDate() + 1);
    }
    const targetMs = d.getTime();
    setWriteExpirationMs(targetMs);
    setWriteExpirationInput(formatDatetimeInputValue(targetMs, writeTimezoneMode));
  };

  const handleApplyStartPreset = (offsetMs: number) => {
    const targetMs = Date.now() + offsetMs;
    setWriteStartMs(targetMs);
    setWriteStartInput(formatDatetimeInputValue(targetMs, writeTimezoneMode));
  };

  const handleExpirationInputChange = (val: string) => {
    setWriteExpirationInput(val);
    const ms = parseDatetimeInputValue(val, writeTimezoneMode);
    if (ms && !isNaN(ms)) {
      setWriteExpirationMs(ms);
    }
  };

  const handleStartInputChange = (val: string) => {
    setWriteStartInput(val);
    const ms = parseDatetimeInputValue(val, writeTimezoneMode);
    if (ms && !isNaN(ms)) {
      setWriteStartMs(ms);
    }
  };

  const handleCutoffInputChange = (val: string) => {
    setWriteCutoffInput(val);
    const ms = parseDatetimeInputValue(val, writeTimezoneMode);
    if (ms && !isNaN(ms)) {
      setWriteCutoffMs(ms);
    }
  };

  const defaultTokens = getDefaultTokens(settings.network);

  const isSameToken =
    Boolean(writeDepositAssetUnit) &&
    Boolean(writePaymentAssetUnit) &&
    writeDepositAssetUnit.toLowerCase() === writePaymentAssetUnit.toLowerCase();

  const handleDepositAssetChange = (newDep: string) => {
    const prevDep = writeDepositAssetUnit;
    setWriteDepositAssetUnit(newDep);
    if (newDep.toLowerCase() === writePaymentAssetUnit.toLowerCase()) {
      setWritePaymentAssetUnit(prevDep || "lovelace");
    }
  };

  const handlePaymentAssetChange = (newPay: string) => {
    const prevPay = writePaymentAssetUnit;
    setWritePaymentAssetUnit(newPay);
    if (newPay.toLowerCase() === writeDepositAssetUnit.toLowerCase()) {
      setWriteDepositAssetUnit(prevPay || "lovelace");
    }
  };

  const handleSwapAssets = () => {
    const tempDep = writeDepositAssetUnit;
    setWriteDepositAssetUnit(writePaymentAssetUnit);
    setWritePaymentAssetUnit(tempDep);
  };

  const handleOpenWriteModal = () => {
    const defaultExp = Date.now() + 7 * 86_400_000;
    const defaultStart = Date.now();
    setWriteExpirationMs(defaultExp);
    setWriteStartMs(defaultStart);
    setWriteCutoffMs(null);
    setShowCustomCutoff(false);
    setWriteExpirationInput(formatDatetimeInputValue(defaultExp, writeTimezoneMode));
    setWriteStartInput(formatDatetimeInputValue(defaultStart, writeTimezoneMode));
    setWriteCutoffInput("");

    // Ensure distinct default tokens for deposit and payment
    if (defaultTokens.length > 1) {
      if (!writeDepositAssetUnit || writeDepositAssetUnit.toLowerCase() === writePaymentAssetUnit.toLowerCase()) {
        const nonAda = defaultTokens.find((t) => t.unit !== "lovelace") || defaultTokens[1];
        setWriteDepositAssetUnit(nonAda.unit);
        setWritePaymentAssetUnit("lovelace");
      }
    }

    setActionError(null);
    setActionSuccess(null);
    setShowWriteModal(true);
  };

  // Default deposit asset to first non-ADA token or GENS/TST
  useEffect(() => {
    if (!writeDepositAssetUnit && defaultTokens.length > 1) {
      const nonAda = defaultTokens.find((t) => t.unit !== "lovelace");
      if (nonAda) setWriteDepositAssetUnit(nonAda.unit);
    }
  }, [defaultTokens, writeDepositAssetUnit]);

  // Derived user credentials for reactive, zero-delay position augmentation
  const userPkhSet = useMemo(() => {
    const set = new Set<string>();
    if (wallet.address) {
      try {
        set.add(paymentCredentialOf(wallet.address).hash.toLowerCase());
      } catch {}
    }
    if (wallet.pkhs && Array.isArray(wallet.pkhs)) {
      for (const p of wallet.pkhs) {
        if (p) set.add(p.toLowerCase());
      }
    }
    return set;
  }, [wallet.address, wallet.pkhs]);

  // Case-insensitive token balance lookup from wallet
  const getTokenBalance = useCallback(
    (unit: string): bigint => {
      if (!wallet.tokenBalances) return 0n;
      if (wallet.tokenBalances[unit] !== undefined) {
        return wallet.tokenBalances[unit];
      }
      const lower = unit.toLowerCase();
      const match = Object.entries(wallet.tokenBalances).find(
        ([u]) => u.toLowerCase() === lower
      );
      return match ? match[1] : 0n;
    },
    [wallet.tokenBalances]
  );

  const listingMap = useMemo(() => {
    const map = new Map<string, OptionMarketListing>();
    for (const l of listings) {
      map.set(l.optionUnit.toLowerCase(), l);
    }
    return map;
  }, [listings]);

  // Augment on-chain option positions dynamically with the live connected wallet state & DEX listings
  const enrichedPositions = useMemo(() => {
    return positions.map((pos) => {
      const isUserWriter = userPkhSet.has(pos.sellerPkh.toLowerCase());
      const userOptionBalance = getTokenBalance(pos.optionUnit);
      const userUnsoldBalance = isUserWriter ? userOptionBalance : 0n;
      const listing = listingMap.get(pos.optionUnit.toLowerCase());
      return {
        ...pos,
        isUserWriter,
        userOptionBalance,
        userUnsoldBalance,
        listing,
      };
    });
  }, [positions, userPkhSet, getTokenBalance, listingMap]);

  const underlyingAssets = useMemo(() => {
    const set = new Set<string>();
    for (const p of enrichedPositions) {
      if (p.depositSymbol) set.add(p.depositSymbol);
    }
    return Array.from(set).sort();
  }, [enrichedPositions]);

  const strikeAssets = useMemo(() => {
    const set = new Set<string>();
    for (const p of enrichedPositions) {
      if (p.paymentSymbol) set.add(p.paymentSymbol);
    }
    return Array.from(set).sort();
  }, [enrichedPositions]);

  const quoteCurrencies = useMemo(() => {
    const set = new Set<string>();
    set.add(settings.network === "mainnet" ? "ADA" : "tADA");
    for (const l of listings) {
      if (l.quoteSymbol) set.add(l.quoteSymbol);
    }
    return Array.from(set).sort();
  }, [listings, settings.network]);

  const reloadPendingRef = useRef(false);
  const loadingRef = useRef(false);
  loadingRef.current = loading;
  const actionPendingRef = useRef(false);
  actionPendingRef.current = actionPending;

  const loadOptions = async (force = false) => {
    if (!lucid) return;
    if (loadingRef.current && !force) {
      reloadPendingRef.current = true;
      return;
    }
    setLoading(true);
    setProgress(null);
    setActionError(null);
    abortRef.current = { aborted: false };

    try {
      const active = await fetchActiveOptions(
        lucid,
        settings.network,
        wallet.address,
        wallet.tokenBalances,
        (p) => setProgress(p),
        () => abortRef.current.aborted,
        wallet.pkhs
      );

      try {
        const activeListings = await fetchOptionMarketListings(
          lucid,
          settings.network,
          active,
          wallet.pkhs || []
        );
        setListings(activeListings);
      } catch (listErr) {
        console.warn("Failed to index DEX option listings:", listErr);
      }

      setPositions(active);
    } catch (err: any) {
      console.error("Error loading options:", err);
      setActionError(err?.message || "Failed to query on-chain options");
    } finally {
      setLoading(false);
      setProgress(null);
      if (reloadPendingRef.current) {
        reloadPendingRef.current = false;
        setTimeout(() => loadOptions(true), 200);
      }
    }
  };

  const scheduleReloads = () => {
    // Cardano blocks take 15-25s. Poll progressively so on-chain indexing is caught smoothly.
    setTimeout(() => {
      loadOptions(true);
      refreshWalletBalances?.();
    }, 3000);
    setTimeout(() => {
      loadOptions(true);
      refreshWalletBalances?.();
    }, 10000);
    setTimeout(() => {
      loadOptions(true);
      refreshWalletBalances?.();
    }, 22000);
  };

  const pkhsKey = (wallet.pkhs || []).join(",");
  const tokenBalancesKey = Object.keys(wallet.tokenBalances || {}).length;

  useEffect(() => {
    loadOptions();
    const interval = setInterval(() => {
      if (
        typeof document !== "undefined" &&
        document.visibilityState === "visible" &&
        !actionPendingRef.current &&
        !loadingRef.current
      ) {
        loadOptions();
      }
    }, 30_000);
    return () => {
      clearInterval(interval);
      abortRef.current.aborted = true;
    };
  }, [lucid, settings.network, wallet.address, pkhsKey, tokenBalancesKey]);

  // Format Helpers
  const formatTimeRemaining = (expirationMs: number): string => {
    const diff = expirationMs - Date.now();
    if (diff <= 0) return "Expired";
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const mins = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    if (days > 0) return `${days}d ${hours}h remaining`;
    if (hours > 0) return `${hours}h ${mins}m remaining`;
    return `${mins}m remaining`;
  };

  // Cardanoscan Link
  const getCardanoscanUrl = (txHash: string) => {
    return settings.network === "mainnet"
      ? `https://cardanoscan.io/transaction/${txHash}`
      : `https://preprod.cardanoscan.io/transaction/${txHash}`;
  };

  // Handle Trade on DEX
  const handleTradeOnDex = (position: OptionPosition) => {
    const pair = createOptionTradingPair(position, settings.network);
    setActivePair(pair);
    if (onSelectDexPair) {
      onSelectDexPair(pair);
    }
  };

  // -------------------------------------------------------------
  // Action Handlers
  // -------------------------------------------------------------

  const handleExecute = async () => {
    if (!lucid || !executingPosition || !wallet.address) return;
    const amount = BigInt(executeAmount);
    if (amount <= 0n) return;

    setActionPending(true);
    setActionMessage(`Executing ${amount} ${executingPosition.tokenNameDisplay} option(s)...`);
    setActionError(null);
    setActionSuccess(null);

    try {
      const res = await executeOption(lucid, {
        optionUtxo: executingPosition.utxo,
        amountToExecute: amount,
        buyerAddress: wallet.address,
      });

      setLatestTxHash(res.txHash);
      const humanCollateral = Number(amount) / Math.pow(10, executingPosition.depositDecimals);
      setActionSuccess(
        `Successfully executed ${Number(amount).toLocaleString()} options! Received ${humanCollateral.toLocaleString(undefined, { maximumFractionDigits: executingPosition.depositDecimals })} ${executingPosition.depositSymbol}.`
      );
      addStoredSpentOption(
        `${executingPosition.utxoRef.txHash}#${executingPosition.utxoRef.outputIndex}`
      );
      if (amount < executingPosition.remainingDeposit) {
        const updatedDeposit = executingPosition.remainingDeposit - amount;
        const updatedUserBalance =
          executingPosition.userOptionBalance > amount
            ? executingPosition.userOptionBalance - amount
            : 0n;

        setPositions((prev) =>
          prev.map((p) =>
            p.utxoRef.txHash === executingPosition.utxoRef.txHash &&
            p.utxoRef.outputIndex === executingPosition.utxoRef.outputIndex
              ? {
                  ...p,
                  utxoRef: { txHash: res.txHash, outputIndex: 0 },
                  remainingDeposit: updatedDeposit,
                  userOptionBalance: updatedUserBalance,
                  isExercisable:
                    updatedDeposit > 0n &&
                    Date.now() >= p.startTimeMs &&
                    Date.now() <= p.expirationTimeMs,
                  utxo: {
                    ...p.utxo,
                    txHash: res.txHash,
                    outputIndex: 0,
                    assets: {
                      ...p.utxo.assets,
                      ...(isAdaAsset(p.datum.opdDeposit)
                        ? { lovelace: (p.utxo.assets["lovelace"] || 0n) - amount }
                        : { [p.depositUnit]: updatedDeposit }),
                    },
                  },
                }
              : p
          )
        );
      } else {
        setPositions((prev) =>
          prev.filter(
            (p) =>
              !(
                p.utxoRef.txHash === executingPosition.utxoRef.txHash &&
                p.utxoRef.outputIndex === executingPosition.utxoRef.outputIndex
              )
          )
        );
      }
      setExecutingPosition(null);
      scheduleReloads();
    } catch (err: any) {
      console.error("Execution failed:", err);
      setActionError(formatFriendlyError(err, { tokenName: executingPosition.tokenNameDisplay }));
    } finally {
      setActionPending(false);
      setActionMessage(null);
    }
  };

  const handleCancelEarly = async () => {
    if (!lucid || !cancelingPosition || !wallet.address) return;
    const amount = BigInt(cancelAmount);
    if (amount <= 0n) return;

    const humanCollateral = Number(amount) / Math.pow(10, cancelingPosition.depositDecimals);
    setActionPending(true);
    setActionMessage(`Canceling ${Number(amount).toLocaleString()} unsold option(s)...`);
    setActionError(null);
    setActionSuccess(null);

    try {
      const res = await cancelEarlyOption(lucid, {
        optionUtxo: cancelingPosition.utxo,
        sellerAddress: wallet.address,
        amountToCancel: amount,
        userPkhs: wallet.pkhs,
      });

      setLatestTxHash(res.txHash);
      setActionSuccess(
        `Successfully cancelled ${Number(amount).toLocaleString()} unsold options! Refunded ${humanCollateral.toLocaleString(undefined, { maximumFractionDigits: cancelingPosition.depositDecimals })} ${cancelingPosition.depositSymbol} to your wallet.`
      );
      addStoredSpentOption(
        `${cancelingPosition.utxoRef.txHash}#${cancelingPosition.utxoRef.outputIndex}`
      );
      if (amount < cancelingPosition.remainingDeposit) {
        const updatedDeposit = cancelingPosition.remainingDeposit - amount;
        const updatedUnsold =
          cancelingPosition.userUnsoldBalance > amount
            ? cancelingPosition.userUnsoldBalance - amount
            : 0n;
        const updatedUserBalance =
          cancelingPosition.userOptionBalance > amount
            ? cancelingPosition.userOptionBalance - amount
            : 0n;

        setPositions((prev) =>
          prev.map((p) =>
            p.utxoRef.txHash === cancelingPosition.utxoRef.txHash &&
            p.utxoRef.outputIndex === cancelingPosition.utxoRef.outputIndex
              ? {
                  ...p,
                  utxoRef: { txHash: res.txHash, outputIndex: 0 },
                  remainingDeposit: updatedDeposit,
                  userUnsoldBalance: updatedUnsold,
                  userOptionBalance: updatedUserBalance,
                  canCancelEarly: updatedDeposit > 0n && Date.now() < p.cancelCutoffMs,
                  utxo: {
                    ...p.utxo,
                    txHash: res.txHash,
                    outputIndex: 0,
                    assets: {
                      ...p.utxo.assets,
                      ...(isAdaAsset(p.datum.opdDeposit)
                        ? { lovelace: (p.utxo.assets["lovelace"] || 0n) - amount }
                        : { [p.depositUnit]: updatedDeposit }),
                    },
                  },
                }
              : p
          )
        );
      } else {
        setPositions((prev) =>
          prev.filter(
            (p) =>
              !(
                p.utxoRef.txHash === cancelingPosition.utxoRef.txHash &&
                p.utxoRef.outputIndex === cancelingPosition.utxoRef.outputIndex
              )
          )
        );
      }
      setCancelingPosition(null);
      scheduleReloads();
    } catch (err: any) {
      console.error("Early cancel failed:", err);
      setActionError(formatFriendlyError(err, { tokenName: cancelingPosition.tokenNameDisplay }));
    } finally {
      setActionPending(false);
      setActionMessage(null);
    }
  };

  const handleRetrieve = async () => {
    if (!lucid || !retrievingPosition || !wallet.address) return;

    setActionPending(true);
    setActionMessage("Retrieving expired collateral and strike proceeds...");
    setActionError(null);
    setActionSuccess(null);

    try {
      const res = await retrieveOption(lucid, {
        optionUtxo: retrievingPosition.utxo,
        sellerAddress: wallet.address,
        userPkhs: wallet.pkhs,
      });

      setLatestTxHash(res.txHash);
      setActionSuccess(
        "Successfully retrieved remaining collateral! Position NFT burned and position closed."
      );
      addStoredSpentOption(
        `${retrievingPosition.utxoRef.txHash}#${retrievingPosition.utxoRef.outputIndex}`
      );
      setPositions((prev) =>
        prev.filter(
          (p) =>
            !(
              p.utxoRef.txHash === retrievingPosition.utxoRef.txHash &&
              p.utxoRef.outputIndex === retrievingPosition.utxoRef.outputIndex
            )
        )
      );
      setRetrievingPosition(null);
      scheduleReloads();
    } catch (err: any) {
      console.error("Retrieve failed:", err);
      setActionError(formatFriendlyError(err, { tokenName: retrievingPosition?.tokenNameDisplay }));
    } finally {
      setActionPending(false);
      setActionMessage(null);
    }
  };

  const handleWriteOption = async () => {
    if (!lucid || !wallet.address) return;

    const depToken = defaultTokens.find((t) => t.unit === writeDepositAssetUnit) || {
      unit: writeDepositAssetUnit,
      policyId: writeDepositAssetUnit.slice(0, 56),
      assetName: writeDepositAssetUnit.slice(56),
      decimals: 0,
      symbol: "TOKEN",
    };

    const payToken =
      writePaymentAssetUnit === "lovelace"
        ? { unit: "lovelace", policyId: "", assetName: "", decimals: 6, symbol: "ADA" }
        : defaultTokens.find((t) => t.unit === writePaymentAssetUnit) || {
            unit: writePaymentAssetUnit,
            policyId: writePaymentAssetUnit.slice(0, 56),
            assetName: writePaymentAssetUnit.slice(56),
            decimals: 0,
            symbol: "TOKEN",
          };

    if (writeDepositAssetUnit.toLowerCase() === writePaymentAssetUnit.toLowerCase()) {
      setActionError("Deposit asset and payment asset cannot be the same token. Please choose two distinct assets.");
      return;
    }

    const depositAmountBig = BigInt(
      Math.floor(parseFloat(writeDepositAmount) * Math.pow(10, depToken.decimals))
    );

    if (depositAmountBig <= 0n) {
      setActionError("Deposit amount must be greater than zero");
      return;
    }

    const priceNum = parseFloat(writeStrikePrice);
    if (isNaN(priceNum) || priceNum <= 0) {
      setActionError("Strike price must be a valid positive number");
      return;
    }

    // Convert decimal-adjusted strike price to on-chain integer Rational
    const decimalRatio = Math.pow(10, payToken.decimals - depToken.decimals);
    const rawPriceRatio = priceNum * decimalRatio;
    const precision = 1_000_000n;
    const numerator = BigInt(Math.round(rawPriceRatio * Number(precision)));
    const denominator = precision;

    const now = Date.now();
    const expirationMs = writeExpirationMs;

    if (isNaN(expirationMs) || expirationMs <= now + 60_000) {
      setActionError("Expiration date must be at least 1 minute in the future");
      return;
    }

    let startMs: number;
    if (writeStyle === "European") {
      startMs = Math.max(now, expirationMs - 86_400_000);
    } else if (writeStyle === "American") {
      startMs = Math.max(now - 10_000, 0);
    } else {
      // Custom style
      startMs = writeStartMs;
      if (isNaN(startMs)) {
        setActionError("Please specify a valid exercise start date and time");
        return;
      }
      if (startMs >= expirationMs) {
        setActionError("Exercise start date/time must be strictly before expiration date/time");
        return;
      }
    }

    const cancelCutoffMs = showCustomCutoff && writeCutoffMs
      ? Math.min(writeCutoffMs, expirationMs)
      : expirationMs;

    setActionPending(true);
    setActionMessage(
      `Minting ${writeDepositAmount} ${depToken.symbol} ${writeStyle} Option position...`
    );
    setActionError(null);
    setActionSuccess(null);

    try {
      const res = await createOption(lucid, {
        depositAsset: {
          policyId: depToken.policyId || "",
          assetName: depToken.assetName || "",
        },
        paymentAsset: {
          policyId: payToken.policyId || "",
          assetName: payToken.assetName || "",
        },
        depositAmount: depositAmountBig,
        strikePrice: { numerator, denominator },
        style: writeStyle,
        expirationTimeMs: expirationMs,
        startTimeMs: startMs,
        cancelCutoffMs,
        sellerAddress: wallet.address,
      });

      setLatestTxHash(res.txHash);
      setActionSuccess(
        `Option minted successfully! Option tokens and position NFT created (Tx: ${res.txHash.slice(0, 10)}...).`
      );
      setShowWriteModal(false);
      scheduleReloads();
    } catch (err: any) {
      console.error("Write option failed:", err);
      setActionError(formatFriendlyError(err));
    } finally {
      setActionPending(false);
      setActionMessage(null);
    }
  };

  // Marketplace: List for Sale on DEX
  const handleOpenListModal = (pos: OptionPosition) => {
    setListingPosition(pos);
    const maxSellable = calculateMaxSellableOptions(pos.userOptionBalance);
    const defaultQty = maxSellable > 0n ? maxSellable.toString() : "1";
    setListingAmount(defaultQty);
    setListingQuoteUnit("lovelace");
    setListingPricePerOption("2.0");
    setActionError(null);
    setActionSuccess(null);
  };

  const handleCreateListing = async () => {
    if (!lucid || !wallet.connected || !listingPosition) return;
    const amountNum = parseInt(listingAmount, 10);
    if (isNaN(amountNum) || amountNum <= 0) {
      setActionError("Please specify a valid quantity of options to sell");
      return;
    }
    const amountBig = BigInt(amountNum);
    const feeTokens = calculateMakerFeeTokens(amountBig);
    const totalRequiredTokens = amountBig + feeTokens;
    if (totalRequiredTokens > listingPosition.userOptionBalance) {
      const maxSellable = calculateMaxSellableOptions(listingPosition.userOptionBalance);
      setActionError(
        `Insufficient balance for DEX listing: Offering ${amountBig.toLocaleString()} options requires ${totalRequiredTokens.toLocaleString()} option tokens (including the 0.3% DEX protocol maker fee of ${feeTokens.toLocaleString()} options). Your wallet holds ${listingPosition.userOptionBalance.toLocaleString()} options. The maximum you can list is ${maxSellable.toLocaleString()} options.`
      );
      return;
    }
    const priceNum = parseFloat(listingPricePerOption);
    if (isNaN(priceNum) || priceNum <= 0) {
      setActionError("Please specify a valid price per option");
      return;
    }

    setActionPending(true);
    setActionMessage("Submitting option sell order to DEX...");
    setActionError(null);
    setActionSuccess(null);

    try {
      const quoteToken =
        listingQuoteUnit === "lovelace"
          ? { unit: "lovelace", decimals: 6, symbol: settings.network === "mainnet" ? "ADA" : "tADA" }
          : defaultTokens.find((t) => t.unit === listingQuoteUnit) || {
              unit: listingQuoteUnit,
              decimals: 0,
              symbol: "TOKEN",
            };

      const totalAsk = amountNum * priceNum;
      const pair = createOptionTradingPair(listingPosition, settings.network, listingQuoteUnit);

      const res = await placeLimitOrder(lucid, {
        pair,
        offerAsset: "base",
        offerAmount: amountNum,
        askAmount: totalAsk,
      });

      setLatestTxHash(res.txHash);
      setActionSuccess(`Successfully listed ${amountNum} option(s) on the DEX for ${totalAsk} ${quoteToken.symbol}!`);
      setListingPosition(null);
      scheduleReloads();
    } catch (err: any) {
      console.error("Failed to list option:", err);
      setActionError(formatFriendlyError(err, { tokenName: listingPosition.tokenNameDisplay }));
    } finally {
      setActionPending(false);
      setActionMessage(null);
    }
  };

  // Marketplace: Buy Option from DEX
  const handleOpenBuyModal = (listing: OptionMarketListing) => {
    setBuyingListing(listing);
    setBuyQuantity(listing.offeredAmount > 1n ? "1" : "1");
    setActionError(null);
    setActionSuccess(null);
  };

  const handleBuyOption = async () => {
    if (!lucid || !wallet.connected || !buyingListing) return;
    const qty = parseInt(buyQuantity, 10);
    if (isNaN(qty) || qty <= 0) {
      setActionError("Please specify a valid quantity to buy");
      return;
    }
    if (BigInt(qty) > buyingListing.offeredAmount) {
      setActionError("Quantity exceeds available options on the DEX");
      return;
    }

    setActionPending(true);
    setActionMessage("Filling DEX option order...");
    setActionError(null);
    setActionSuccess(null);

    try {
      const fillBig = BigInt(qty);
      const res = await fillDexOrder(lucid, {
        order: buyingListing.order,
        fillAmount: fillBig >= buyingListing.offeredAmount ? undefined : fillBig,
      });

      setLatestTxHash(res.txHash);
      setActionSuccess(`Successfully bought ${qty} option(s) from the DEX!`);
      setBuyingListing(null);
      scheduleReloads();
    } catch (err: any) {
      console.error("Failed to buy option:", err);
      setActionError(formatFriendlyError(err, { tokenName: buyingListing.optionUnit }));
    } finally {
      setActionPending(false);
      setActionMessage(null);
    }
  };

  // Marketplace: Cancel Listing from DEX
  const handleCancelListing = async (listing: OptionMarketListing) => {
    if (!lucid || !wallet.connected) return;
    setActionPending(true);
    setActionMessage("Cancelling DEX listing and reclaiming tokens...");
    setActionError(null);
    setActionSuccess(null);

    try {
      const res = await cancelLimitOrder(lucid, listing.order);
      setLatestTxHash(res.txHash);
      setActionSuccess("Listing cancelled successfully! Option tokens and deposit returned to your wallet.");
      scheduleReloads();
    } catch (err: any) {
      console.error("Failed to cancel listing:", err);
      setActionError(formatFriendlyError(err));
    } finally {
      setActionPending(false);
      setActionMessage(null);
    }
  };

  // Filtered positions
  const filteredPositions = enrichedPositions.filter((p) => {
    // View Mode filter
    if (viewMode === "MY_PORTFOLIO") {
      const isUserListing = p.listing?.isUserSeller;
      if (!p.isUserWriter && p.userOptionBalance <= 0n && !isUserListing) return false;
    }

    // Category / Tab filter
    if (tabFilter === "MY_POSITIONS") {
      if (!p.isUserWriter && p.userOptionBalance <= 0n) return false;
    } else if (tabFilter === "MY_WRITTEN") {
      if (!p.isUserWriter) return false;
    } else if (tabFilter === "EXERCISABLE") {
      if (!p.isExercisable) return false;
    } else if (tabFilter === "EXPIRED") {
      if (!p.isExpired) return false;
    }

    // Multi-Dimension Filters:
    // Underlying Collateral
    if (filterUnderlying !== "ALL" && p.depositSymbol.toLowerCase() !== filterUnderlying.toLowerCase()) {
      return false;
    }

    // Strike Payment Asset
    if (filterStrikeAsset !== "ALL" && p.paymentSymbol.toLowerCase() !== filterStrikeAsset.toLowerCase()) {
      return false;
    }

    // Pricing / Quotation Currency
    if (filterQuoteCurrency !== "ALL") {
      if (!p.listing || p.listing.quoteSymbol.toLowerCase() !== filterQuoteCurrency.toLowerCase()) {
        return false;
      }
    }

    // Status Filter
    if (filterStatus === "FOR_SALE") {
      if (!p.listing) return false;
    } else if (filterStatus === "ACTIVE") {
      if (p.isExpired) return false;
    } else if (filterStatus === "EXPIRED") {
      if (!p.isExpired) return false;
    }

    // Style filter
    if (styleFilter !== "ALL" && p.style !== styleFilter) return false;

    // Search query
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchName = p.tokenNameDisplay.toLowerCase().includes(q);
      const matchDep = p.depositSymbol.toLowerCase().includes(q);
      const matchPay = p.paymentSymbol.toLowerCase().includes(q);
      const matchStrike = p.strikePriceDisplay.toLowerCase().includes(q);
      const matchPkh = p.sellerPkh.toLowerCase().includes(q);
      const matchQuote = p.listing?.quoteSymbol.toLowerCase().includes(q);
      return matchName || matchDep || matchPay || matchStrike || matchPkh || !!matchQuote;
    }

    return true;
  });

  const totalCollateralCount = enrichedPositions.filter((p) => !p.isExpired).length;
  const listedCount = listings.length;
  const userHeldCount = enrichedPositions.filter((p) => p.userOptionBalance > 0n).length;
  const userWrittenCount = enrichedPositions.filter((p) => p.isUserWriter).length;

  return (
    <div className="space-y-6">
      {/* Hero Header */}
      <div className="rounded-3xl bg-gradient-to-br from-[#121824] via-[#101520] to-[#0c0f17] border border-[#1f2d44] p-5 sm:p-7 relative overflow-hidden shadow-2xl">
        <div className="absolute top-0 right-0 w-96 h-96 bg-emerald-500/5 rounded-full blur-3xl pointer-events-none -mr-20 -mt-20"></div>
        <div className="absolute bottom-0 left-0 w-96 h-96 bg-sky-500/5 rounded-full blur-3xl pointer-events-none -ml-20 -mb-20"></div>

        <div className="relative z-10 flex flex-col md:flex-row items-start md:items-center justify-between gap-5">
          <div className="space-y-2 max-w-2xl">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs font-semibold tracking-wide">
              <Zap className="w-3.5 h-3.5" />
              <span>Cardano Plutus V3 • Zero Protocol Fees</span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
              Options Protocol
            </h1>
            <p className="text-slate-300 text-xs sm:text-sm leading-relaxed">
              Decentralized, sovereign covered call & put options on Cardano. Fully backed by
              immutable smart contracts with early cancellation for unsold tokens and direct
              Genius Yield DEX orderbook trading.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3 w-full sm:w-auto">
            <button
              onClick={handleOpenWriteModal}
              className="flex-1 sm:flex-initial inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-600 hover:to-teal-600 text-slate-950 font-bold text-xs sm:text-sm transition-all shadow-lg shadow-emerald-500/20 active:scale-95"
            >
              <PlusCircle className="w-4 h-4" />
              <span>Write New Option</span>
            </button>

            <button
              onClick={() => loadOptions(true)}
              disabled={loading}
              title="Refresh on-chain options"
              className="p-2.5 rounded-xl bg-[#182234] border border-[#1f2d44] text-slate-300 hover:text-white hover:border-slate-600 transition-colors shrink-0"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin text-emerald-400" : ""}`} />
            </button>
          </div>
        </div>

        {/* Protocol Metric Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4 mt-6 pt-6 border-t border-[#1f2d44]/70">
          <div className="p-3.5 rounded-2xl bg-[#0b0e14]/60 border border-[#1f2d44]">
            <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
              Active Contracts
            </div>
            <div className="text-xl sm:text-2xl font-black text-white mt-1">
              {totalCollateralCount}
            </div>
            <div className="text-[10px] text-emerald-400 mt-0.5">Live on {settings.network}</div>
          </div>

          <div className="p-3.5 rounded-2xl bg-[#0b0e14]/60 border border-emerald-500/30">
            <div className="text-[11px] font-semibold text-emerald-400 uppercase tracking-wider flex items-center gap-1.5">
              <Store className="w-3.5 h-3.5" />
              <span>Listed on DEX</span>
            </div>
            <div className="text-xl sm:text-2xl font-black text-emerald-400 mt-1">
              {listedCount}
            </div>
            <div className="text-[10px] text-slate-400 mt-0.5">Buy Now orders available</div>
          </div>

          <div className="p-3.5 rounded-2xl bg-[#0b0e14]/60 border border-[#1f2d44]">
            <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
              Options in Wallet
            </div>
            <div className="text-xl sm:text-2xl font-black text-sky-400 mt-1">
              {userHeldCount}
            </div>
            <div className="text-[10px] text-slate-400 mt-0.5">Available to exercise / list</div>
          </div>

          <div className="p-3.5 rounded-2xl bg-[#0b0e14]/60 border border-[#1f2d44]">
            <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
              Written Vaults
            </div>
            <div className="text-xl sm:text-2xl font-black text-purple-400 mt-1">
              {userWrittenCount}
            </div>
            <div className="text-[10px] text-slate-400 mt-0.5">Created by your wallet</div>
          </div>
        </div>
      </div>

      {/* Action Notification Banner */}
      {actionSuccess && (
        <div className="flex items-center justify-between gap-3 p-4 rounded-2xl bg-emerald-950/40 border border-emerald-800/50 text-emerald-200 shadow-lg">
          <div className="flex items-center gap-3">
            <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
            <div className="text-xs">
              <span className="font-bold block text-sm text-white">Success</span>
              {actionSuccess}
            </div>
          </div>
          {latestTxHash && (
            <a
              href={getCardanoscanUrl(latestTxHash)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-900/50 hover:bg-emerald-900/80 text-emerald-200 text-xs font-semibold shrink-0 transition-colors"
            >
              <span>Cardanoscan</span>
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          )}
        </div>
      )}

      {actionError && (
        <div className="flex items-center justify-between gap-3 p-4 rounded-2xl bg-rose-950/40 border border-rose-800/50 text-rose-200 shadow-lg">
          <div className="flex items-center gap-3">
            <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0" />
            <div className="text-xs">
              <span className="font-bold block text-sm text-white">Transaction Error</span>
              {actionError}
            </div>
          </div>
          <button
            onClick={() => setActionError(null)}
            className="px-3 py-1.5 rounded-lg bg-rose-900/40 hover:bg-rose-900/60 text-rose-200 text-xs font-semibold shrink-0 transition-colors"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Progress Bar during loading */}
      {progress && <ProgressBar progress={progress} />}

      {/* View Mode Bar: Marketplace vs All Contracts vs My Portfolio */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-[#121824] p-1.5 rounded-2xl border border-[#1f2d44]">
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            onClick={() => {
              setViewMode("MARKETPLACE");
              setTabFilter("ALL");
            }}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all ${
              viewMode === "MARKETPLACE"
                ? "bg-gradient-to-r from-emerald-500/20 to-teal-500/20 text-emerald-300 border border-emerald-500/40 shadow-sm"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            <Store className="w-3.5 h-3.5 text-emerald-400" />
            <span>Option Marketplace</span>
            {listedCount > 0 && (
              <span className="px-1.5 py-0.5 rounded-full bg-emerald-500/30 text-emerald-300 text-[10px]">
                {listedCount} for sale
              </span>
            )}
          </button>

          <button
            onClick={() => setViewMode("ALL_CONTRACTS")}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all ${
              viewMode === "ALL_CONTRACTS"
                ? "bg-[#182234] text-white shadow-sm border border-[#1f2d44]"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            <Layers className="w-3.5 h-3.5 text-slate-400" />
            <span>All Contracts ({totalCollateralCount})</span>
          </button>

          <button
            onClick={() => setViewMode("MY_PORTFOLIO")}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all ${
              viewMode === "MY_PORTFOLIO"
                ? "bg-purple-500/20 text-purple-300 border border-purple-500/40 shadow-sm"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            <Wallet className="w-3.5 h-3.5 text-purple-400" />
            <span>My Portfolio ({userHeldCount + userWrittenCount})</span>
          </button>
        </div>

        {/* Reset Filters button if any active filter */}
        {(filterUnderlying !== "ALL" ||
          filterStrikeAsset !== "ALL" ||
          filterQuoteCurrency !== "ALL" ||
          filterStatus !== "ALL" ||
          styleFilter !== "ALL" ||
          searchQuery.trim() !== "") && (
          <button
            onClick={() => {
              setFilterUnderlying("ALL");
              setFilterStrikeAsset("ALL");
              setFilterQuoteCurrency("ALL");
              setFilterStatus("ALL");
              setStyleFilter("ALL");
              setSearchQuery("");
            }}
            className="text-[11px] font-semibold text-rose-400 hover:text-rose-300 px-3 py-1 rounded-lg hover:bg-rose-500/10 transition-colors self-end sm:self-auto"
          >
            Reset Filters
          </button>
        )}
      </div>

      {/* Multi-Dimensional Filter Toolbar */}
      <div className="bg-[#121824] p-3.5 rounded-2xl border border-[#1f2d44] space-y-3">
        <div className="flex items-center justify-between gap-2 text-xs font-semibold text-slate-400">
          <div className="flex items-center gap-1.5">
            <SlidersHorizontal className="w-3.5 h-3.5 text-emerald-400" />
            <span>Filter by 3-Token Dimensions & Parameters</span>
          </div>
          <div className="text-[11px] text-slate-500">
            Showing {filteredPositions.length} of {enrichedPositions.length} position(s)
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
          {/* 1. Underlying Asset */}
          <div>
            <label className="block text-[10px] uppercase font-bold text-slate-400 mb-1">
              Underlying Asset
            </label>
            <select
              value={filterUnderlying}
              onChange={(e) => setFilterUnderlying(e.target.value)}
              className="w-full bg-[#182234] border border-[#1f2d44] rounded-xl px-2.5 py-1.5 text-xs text-white font-medium focus:outline-none focus:border-emerald-500/50"
            >
              <option value="ALL">All Underlyings</option>
              {underlyingAssets.map((sym) => (
                <option key={sym} value={sym}>
                  {sym}
                </option>
              ))}
            </select>
          </div>

          {/* 2. Strike Payment Asset */}
          <div>
            <label className="block text-[10px] uppercase font-bold text-slate-400 mb-1">
              Strike Asset
            </label>
            <select
              value={filterStrikeAsset}
              onChange={(e) => setFilterStrikeAsset(e.target.value)}
              className="w-full bg-[#182234] border border-[#1f2d44] rounded-xl px-2.5 py-1.5 text-xs text-white font-medium focus:outline-none focus:border-emerald-500/50"
            >
              <option value="ALL">All Strikes</option>
              {strikeAssets.map((sym) => (
                <option key={sym} value={sym}>
                  {sym}
                </option>
              ))}
            </select>
          </div>

          {/* 3. DEX Quote Currency */}
          <div>
            <label className="block text-[10px] uppercase font-bold text-slate-400 mb-1">
              Trading Currency
            </label>
            <select
              value={filterQuoteCurrency}
              onChange={(e) => setFilterQuoteCurrency(e.target.value)}
              className="w-full bg-[#182234] border border-[#1f2d44] rounded-xl px-2.5 py-1.5 text-xs text-white font-medium focus:outline-none focus:border-emerald-500/50"
            >
              <option value="ALL">All Currencies</option>
              {quoteCurrencies.map((sym) => (
                <option key={sym} value={sym}>
                  {sym}
                </option>
              ))}
            </select>
          </div>

          {/* 4. Style */}
          <div>
            <label className="block text-[10px] uppercase font-bold text-slate-400 mb-1">
              Exercise Style
            </label>
            <select
              value={styleFilter}
              onChange={(e) => setStyleFilter(e.target.value as any)}
              className="w-full bg-[#182234] border border-[#1f2d44] rounded-xl px-2.5 py-1.5 text-xs text-white font-medium focus:outline-none focus:border-emerald-500/50"
            >
              <option value="ALL">All Styles</option>
              <option value="American">American</option>
              <option value="European">European</option>
              <option value="Custom">Custom</option>
            </select>
          </div>

          {/* 5. Listing Status */}
          <div>
            <label className="block text-[10px] uppercase font-bold text-slate-400 mb-1">
              Market Status
            </label>
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value as any)}
              className="w-full bg-[#182234] border border-[#1f2d44] rounded-xl px-2.5 py-1.5 text-xs text-white font-medium focus:outline-none focus:border-emerald-500/50"
            >
              <option value="ALL">All Statuses</option>
              <option value="FOR_SALE">Listed on DEX (Buy Now)</option>
              <option value="ACTIVE">Active Only</option>
              <option value="EXPIRED">Expired</option>
            </select>
          </div>

          {/* 6. Search Bar */}
          <div>
            <label className="block text-[10px] uppercase font-bold text-slate-400 mb-1">
              Search Keywords
            </label>
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Token, strike, or ID..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-[#182234] border border-[#1f2d44] rounded-xl pl-8 pr-2.5 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-emerald-500/50"
              />
            </div>
          </div>
        </div>

        {/* Quick Filter Pills */}
        <div className="pt-2 border-t border-[#1f2d44]/60 flex items-center gap-1.5 overflow-x-auto">
          <button
            onClick={() => setTabFilter("ALL")}
            className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all whitespace-nowrap ${
              tabFilter === "ALL"
                ? "bg-[#182234] text-white shadow-sm border border-[#1f2d44]"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            All Active ({enrichedPositions.filter((p) => !p.isExpired).length})
          </button>
          <button
            onClick={() => setTabFilter("MY_POSITIONS")}
            className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all whitespace-nowrap ${
              tabFilter === "MY_POSITIONS"
                ? "bg-[#182234] text-white shadow-sm border border-[#1f2d44]"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            My Positions ({enrichedPositions.filter((p) => p.isUserWriter || p.userOptionBalance > 0n).length})
          </button>
          <button
            onClick={() => setTabFilter("MY_WRITTEN")}
            className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all whitespace-nowrap ${
              tabFilter === "MY_WRITTEN"
                ? "bg-[#182234] text-white shadow-sm border border-[#1f2d44]"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            Written by Me ({enrichedPositions.filter((p) => p.isUserWriter).length})
          </button>
          <button
            onClick={() => setTabFilter("EXERCISABLE")}
            className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all whitespace-nowrap ${
              tabFilter === "EXERCISABLE"
                ? "bg-emerald-500/20 text-emerald-300 shadow-sm border border-emerald-500/40"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            Exercisable ({enrichedPositions.filter((p) => p.isExercisable).length})
          </button>
          <button
            onClick={() => setTabFilter("EXPIRED")}
            className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all whitespace-nowrap ${
              tabFilter === "EXPIRED"
                ? "bg-[#182234] text-white shadow-sm border border-[#1f2d44]"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            Expired / Reclaim ({enrichedPositions.filter((p) => p.isExpired).length})
          </button>
        </div>
      </div>

      {/* Options Grid */}
      {loading && enrichedPositions.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center space-y-3 bg-[#121824]/40 rounded-3xl border border-[#1f2d44]">
          <Loader2 className="w-8 h-8 text-emerald-400 animate-spin" />
          <div className="text-sm font-semibold text-slate-200">
            Scanning on-chain options on Cardano {settings.network}...
          </div>
          <div className="text-xs text-slate-400">
            Querying Plutus V3 Option Spending Validator UTxOs
          </div>
        </div>
      ) : filteredPositions.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center space-y-3 bg-[#121824]/40 rounded-3xl border border-[#1f2d44]">
          <div className="p-4 rounded-2xl bg-[#182234] text-slate-400 border border-[#1f2d44]">
            <TrendingUp className="w-8 h-8" />
          </div>
          <div className="text-base font-bold text-white">No Option Positions Found</div>
          <div className="text-xs text-slate-400 max-w-md">
            {tabFilter === "MY_POSITIONS" || tabFilter === "MY_WRITTEN"
              ? "You do not have any options in this filter. Click 'Write New Option' to create your first position."
              : "No active options match your current filter. You can write a new option to seed the market."}
          </div>
          <button
            onClick={handleOpenWriteModal}
            className="px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-bold text-xs transition-colors"
          >
            Write New Option
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {filteredPositions.map((position) => {
            const depAmount =
              Number(position.remainingDeposit) / Math.pow(10, position.depositDecimals);
            const userHeld =
              Number(position.userOptionBalance) / Math.pow(10, position.depositDecimals);

            return (
              <div
                key={`${position.utxoRef.txHash}#${position.utxoRef.outputIndex}`}
                className={`rounded-2xl bg-[#121824] border transition-all flex flex-col justify-between overflow-hidden shadow-lg ${
                  position.isUserWriter
                    ? "border-purple-500/40 hover:border-purple-500/70"
                    : position.userOptionBalance > 0n
                    ? "border-sky-500/40 hover:border-sky-500/70"
                    : "border-[#1f2d44] hover:border-slate-600"
                }`}
              >
                {/* Card Header */}
                <div className="p-4 sm:p-5 border-b border-[#1f2d44]/70 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                          position.style === "American"
                            ? "bg-sky-500/15 text-sky-300 border border-sky-500/30"
                            : position.style === "European"
                            ? "bg-purple-500/15 text-purple-300 border border-purple-500/30"
                            : "bg-amber-500/15 text-amber-300 border border-amber-500/30"
                        }`}
                      >
                        {position.style}
                      </span>
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                        Call Option
                      </span>
                    </div>

                    <div className="text-right">
                      {position.isExpired ? (
                        <span className="text-[11px] font-bold text-rose-400 flex items-center gap-1">
                          <Clock className="w-3 h-3" /> Expired
                        </span>
                      ) : position.isExercisable ? (
                        <span className="text-[11px] font-bold text-emerald-400 flex items-center gap-1">
                          <Zap className="w-3 h-3" /> Exercisable
                        </span>
                      ) : (
                        <span className="text-[11px] font-bold text-slate-400 flex items-center gap-1">
                          <Clock className="w-3 h-3" /> Starts Soon
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Pair / Underlying Heading */}
                  <div>
                    <div className="text-lg font-extrabold text-white tracking-tight flex items-center gap-2">
                      <span>{position.depositSymbol}</span>
                      <ArrowRight className="w-4 h-4 text-slate-500" />
                      <span className="text-emerald-400">{position.paymentSymbol}</span>
                    </div>
                    <div className="text-[11px] text-slate-400 font-mono mt-0.5">
                      {position.tokenNameDisplay}
                    </div>
                  </div>

                  {/* Key Metrics Grid */}
                  <div className="grid grid-cols-2 gap-2 pt-2">
                    <div className="p-2.5 rounded-xl bg-[#0b0e14]/70 border border-[#1f2d44]/70">
                      <div className="text-[10px] font-medium text-slate-400">Strike Price</div>
                      <div className="text-xs font-bold text-white font-mono mt-0.5">
                        {position.strikePriceDisplay}
                      </div>
                    </div>

                    <div className="p-2.5 rounded-xl bg-[#0b0e14]/70 border border-[#1f2d44]/70">
                      <div className="text-[10px] font-medium text-slate-400">Remaining Backing</div>
                      <div className="text-xs font-bold text-emerald-400 font-mono mt-0.5">
                        {depAmount.toLocaleString(undefined, { maximumFractionDigits: 4 })} {position.depositSymbol}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Card Middle: Dates & Backing Details */}
                <div className="p-4 sm:p-5 space-y-3 text-xs">
                  <div className="flex items-center justify-between text-slate-400">
                    <span>Time Remaining</span>
                    <span className="text-white font-mono font-medium">
                      {formatTimeRemaining(position.expirationTimeMs)}
                    </span>
                  </div>

                  {/* Dual Timezone Expiry Card */}
                  <div className="space-y-1.5 p-2.5 rounded-xl bg-[#0b0e14]/70 border border-[#1f2d44]/70 text-[11px]">
                    <div className="flex items-center justify-between text-slate-400">
                      <span>Expires (Local):</span>
                      <span className="font-mono text-slate-200 font-semibold">
                        {formatDateTimeDual(position.expirationTimeMs).localFull}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-slate-400">
                      <span>Expires (UTC):</span>
                      <span className="font-mono text-emerald-400/90 font-semibold">
                        {formatDateTimeDual(position.expirationTimeMs).utcFull}
                      </span>
                    </div>
                  </div>

                  {position.style === "European" && (
                    <div className="p-2 rounded-lg bg-purple-950/25 border border-purple-500/30 text-[10px] text-purple-300 space-y-0.5">
                      <div className="font-bold text-purple-200">European Exercise Window:</div>
                      <div>• Opens: {formatDateTimeDual(position.startTimeMs).localFull} ({formatDateTimeDual(position.startTimeMs).utcFull})</div>
                      <div>• Closes: {formatDateTimeDual(position.expirationTimeMs).localFull}</div>
                    </div>
                  )}

                  {position.style === "Custom" && (
                    <div className="p-2 rounded-lg bg-amber-950/25 border border-amber-500/30 text-[10px] text-amber-300 space-y-0.5">
                      <div className="font-bold text-amber-200">Custom Exercise Window:</div>
                      <div>• Opens: {formatDateTimeDual(position.startTimeMs).localFull} ({formatDateTimeDual(position.startTimeMs).utcFull})</div>
                      <div>• Closes: {formatDateTimeDual(position.expirationTimeMs).localFull}</div>
                    </div>
                  )}

                  {position.style === "American" && (
                    <div className="p-2 rounded-lg bg-sky-950/20 border border-sky-500/20 text-[10px] text-sky-300">
                      American: Exercisable anytime from creation until expiration.
                    </div>
                  )}

                  {/* User status badges */}
                  <div className="pt-2 border-t border-[#1f2d44]/50 flex flex-wrap gap-1.5">
                    {!wallet.connected && (
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-900/60 border border-slate-800 text-slate-400 text-[11px]">
                        <Wallet className="w-3 h-3 text-slate-500" />
                        <span>Connect wallet to see held & writer actions</span>
                      </span>
                    )}

                    {wallet.connected && position.userOptionBalance > 0n && (
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-sky-950/50 border border-sky-500/40 text-sky-300 text-[11px] font-bold">
                        <Coins className="w-3 h-3" />
                        <span>
                          You hold {Number(position.userOptionBalance).toLocaleString()} option(s) ({userHeld.toLocaleString(undefined, { maximumFractionDigits: position.depositDecimals })} {position.depositSymbol})
                        </span>
                      </span>
                    )}

                    {wallet.connected && position.isUserWriter && (
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-purple-950/50 border border-purple-500/40 text-purple-300 text-[11px] font-bold">
                        <ShieldCheck className="w-3 h-3" />
                        <span>
                          Writer ({position.userUnsoldBalance > 0n ? `${Number(position.userUnsoldBalance).toLocaleString()} unsold` : "0 unsold in wallet"})
                        </span>
                      </span>
                    )}
                  </div>

                  {/* DEX Market Listing Box */}
                  {position.listing ? (
                    <div className="p-3 rounded-xl bg-gradient-to-r from-emerald-950/40 via-teal-950/30 to-[#0b0e14]/70 border border-emerald-500/40 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-emerald-500/20 text-emerald-300 text-[10px] font-extrabold uppercase tracking-wide border border-emerald-500/30">
                          <Tag className="w-3 h-3 text-emerald-400" />
                          <span>Listed on DEX</span>
                        </span>
                        <span className="text-[11px] font-mono text-slate-300">
                          Seller:{" "}
                          {position.listing.isUserSeller ? (
                            <span className="font-bold text-purple-300">You</span>
                          ) : (
                            `${position.listing.sellerAddress.slice(0, 8)}...${position.listing.sellerAddress.slice(-4)}`
                          )}
                        </span>
                      </div>

                      <div className="flex items-baseline justify-between pt-1">
                        <div>
                          <div className="text-[10px] text-slate-400">Asking Price</div>
                          <div className="text-base font-extrabold text-white font-mono">
                            {position.listing.pricePerOption.toLocaleString(undefined, { maximumFractionDigits: 6 })}{" "}
                            <span className="text-emerald-400 text-xs font-sans">{position.listing.quoteSymbol}</span>
                            <span className="text-slate-400 text-[10px] font-normal"> / opt</span>
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-[10px] text-slate-400">Available on Market</div>
                          <div className="text-xs font-bold text-slate-200">
                            {Number(position.listing.offeredAmount).toLocaleString()} options
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="p-2.5 rounded-xl bg-[#0b0e14]/40 border border-[#1f2d44]/50 flex items-center justify-between text-xs">
                      <span className="text-[11px] text-slate-400">DEX Market Status</span>
                      <span className="text-[11px] font-medium text-slate-500">Unlisted on DEX</span>
                    </div>
                  )}
                </div>

                {/* Card Footer: Action Buttons */}
                <div className="p-4 bg-[#0e131d] border-t border-[#1f2d44] flex flex-wrap gap-2">
                  {/* Connect Wallet prompt when not connected */}
                  {!wallet.connected && (
                    <button
                      onClick={onOpenWallet}
                      className="flex-1 py-2 px-3 rounded-xl bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/40 text-emerald-300 font-bold text-xs transition-colors flex items-center justify-center gap-1.5 shadow-sm"
                    >
                      <Wallet className="w-3.5 h-3.5 text-emerald-400" />
                      <span>Connect Wallet to Manage</span>
                    </button>
                  )}

                  {/* Buy Option Button (if listed on DEX and not own listing) */}
                  {wallet.connected && position.listing && !position.listing.isUserSeller && !position.isExpired && (
                    <button
                      onClick={() => handleOpenBuyModal(position.listing!)}
                      className="flex-1 py-2 px-3 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-600 hover:to-teal-600 text-slate-950 font-bold text-xs transition-colors flex items-center justify-center gap-1.5 shadow-md shadow-emerald-500/20"
                    >
                      <ShoppingCart className="w-3.5 h-3.5" />
                      <span>
                        Buy ({position.listing.pricePerOption.toLocaleString(undefined, { maximumFractionDigits: 4 })}{" "}
                        {position.listing.quoteSymbol})
                      </span>
                    </button>
                  )}

                  {/* Cancel Listing Button (if user is the seller) */}
                  {wallet.connected && position.listing && position.listing.isUserSeller && (
                    <button
                      onClick={() => handleCancelListing(position.listing!)}
                      disabled={actionPending}
                      className="flex-1 py-2 px-3 rounded-xl bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/40 text-rose-300 font-bold text-xs transition-colors flex items-center justify-center gap-1.5"
                    >
                      <XCircle className="w-3.5 h-3.5 text-rose-400" />
                      <span>Cancel Listing</span>
                    </button>
                  )}

                  {/* List for Sale on DEX (if user holds option tokens) */}
                  {wallet.connected && position.userOptionBalance > 0n && !position.isExpired && (
                    <button
                      onClick={() => handleOpenListModal(position)}
                      className="flex-1 py-2 px-3 rounded-xl bg-sky-500/20 hover:bg-sky-500/30 border border-sky-500/40 text-sky-300 font-bold text-xs transition-colors flex items-center justify-center gap-1.5"
                    >
                      <Tag className="w-3.5 h-3.5 text-sky-400" />
                      <span>List for Sale</span>
                    </button>
                  )}

                  {/* Exercise Button */}
                  {wallet.connected && position.userOptionBalance > 0n && (
                    <button
                      onClick={() => {
                        setExecutingPosition(position);
                        setExecuteAmount("1");
                        setActionError(null);
                        setActionSuccess(null);
                      }}
                      disabled={!position.isExercisable || position.remainingDeposit <= 0n}
                      className="flex-1 py-2 px-3 rounded-xl bg-emerald-500 hover:bg-emerald-600 disabled:bg-slate-800 disabled:text-slate-500 text-slate-950 font-bold text-xs transition-colors flex items-center justify-center gap-1.5 shadow-md shadow-emerald-500/10"
                    >
                      <Zap className="w-3.5 h-3.5" />
                      <span>Exercise</span>
                    </button>
                  )}

                  {/* Early Cancel (for Writer) */}
                  {wallet.connected && position.isUserWriter && position.canCancelEarly && position.userUnsoldBalance > 0n && (
                    <button
                      onClick={() => {
                        setCancelingPosition(position);
                        setCancelAmount(position.userUnsoldBalance.toString());
                        setActionError(null);
                        setActionSuccess(null);
                      }}
                      className="flex-1 py-2 px-3 rounded-xl bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-300 font-bold text-xs transition-colors flex items-center justify-center gap-1.5"
                    >
                      <Flame className="w-3.5 h-3.5 text-amber-400" />
                      <span>Cancel Unsold</span>
                    </button>
                  )}

                  {/* Early Cancel (Writer but 0 unsold tokens in wallet) */}
                  {wallet.connected && position.isUserWriter && position.canCancelEarly && position.userUnsoldBalance <= 0n && (
                    <button
                      disabled
                      title="All minted option tokens for this position are either already cancelled, listed on DEX, or held in another address."
                      className="flex-1 py-2 px-3 rounded-xl bg-slate-800/40 border border-slate-700/50 text-slate-500 font-medium text-xs flex items-center justify-center gap-1.5 cursor-not-allowed"
                    >
                      <Flame className="w-3.5 h-3.5 text-slate-600" />
                      <span>0 Unsold Options</span>
                    </button>
                  )}

                  {/* Retrieve Collateral (for Writer when expired) */}
                  {wallet.connected && position.isUserWriter && position.isExpired && (
                    <button
                      onClick={() => {
                        setRetrievingPosition(position);
                        setActionError(null);
                        setActionSuccess(null);
                      }}
                      className="flex-1 py-2 px-3 rounded-xl bg-purple-500 hover:bg-purple-600 text-white font-bold text-xs transition-colors flex items-center justify-center gap-1.5 shadow-md shadow-purple-500/20"
                    >
                      <Coins className="w-3.5 h-3.5" />
                      <span>Retrieve Collateral</span>
                    </button>
                  )}

                  {/* Trade on DEX */}
                  <button
                    onClick={() => handleTradeOnDex(position)}
                    title="Open in DEX Order Book (Raw Spot Pair)"
                    className="py-2 px-3 rounded-xl bg-[#182234] hover:bg-[#1f2d44] border border-[#1f2d44] text-slate-300 hover:text-white font-bold text-xs transition-colors flex items-center justify-center gap-1.5"
                  >
                    <ArrowUpDown className="w-3.5 h-3.5 text-sky-400" />
                    <span>DEX Book</span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ------------------------------------------------------------- */}
      {/* MODAL 1: Write New Option */}
      {/* ------------------------------------------------------------- */}
      {showWriteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/80 backdrop-blur-sm overflow-y-auto">
          <div className="bg-[#121824] border border-[#1f2d44] rounded-3xl w-full max-w-lg p-5 sm:p-7 space-y-5 shadow-2xl relative my-8">
            <div className="flex items-center justify-between pb-3 border-b border-[#1f2d44]">
              <div>
                <h3 className="text-lg font-bold text-white flex items-center gap-2">
                  <PlusCircle className="w-5 h-5 text-emerald-400" />
                  <span>Write New Option</span>
                </h3>
                <p className="text-xs text-slate-400">
                  Mint covered call options backed 1:1 by your collateral
                </p>
              </div>
              <button
                onClick={() => setShowWriteModal(false)}
                className="text-slate-400 hover:text-white text-lg leading-none p-1"
              >
                ✕
              </button>
            </div>

            <div className="space-y-4 text-xs">
              {/* Option Style Selector */}
              <div>
                <label className="block text-slate-300 font-semibold mb-1.5">
                  Option Style
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => setWriteStyle("American")}
                    className={`p-3 rounded-xl border text-left transition-all ${
                      writeStyle === "American"
                        ? "bg-sky-500/15 border-sky-500/50 text-white shadow-md shadow-sky-500/10"
                        : "bg-[#182234] border-[#1f2d44] text-slate-400 hover:text-slate-200"
                    }`}
                  >
                    <div className="font-bold text-sky-400 flex items-center justify-between">
                      <span>American</span>
                      {writeStyle === "American" && (
                        <span className="w-1.5 h-1.5 rounded-full bg-sky-400"></span>
                      )}
                    </div>
                    <div className="text-[10px] text-slate-400 mt-1 leading-snug">
                      Exercisable anytime from now until expiration.
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setWriteStyle("European")}
                    className={`p-3 rounded-xl border text-left transition-all ${
                      writeStyle === "European"
                        ? "bg-purple-500/15 border-purple-500/50 text-white shadow-md shadow-purple-500/10"
                        : "bg-[#182234] border-[#1f2d44] text-slate-400 hover:text-slate-200"
                    }`}
                  >
                    <div className="font-bold text-purple-400 flex items-center justify-between">
                      <span>European</span>
                      {writeStyle === "European" && (
                        <span className="w-1.5 h-1.5 rounded-full bg-purple-400"></span>
                      )}
                    </div>
                    <div className="text-[10px] text-slate-400 mt-1 leading-snug">
                      Exercisable strictly in final 24h before expiration.
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setWriteStyle("Custom")}
                    className={`p-3 rounded-xl border text-left transition-all ${
                      writeStyle === "Custom"
                        ? "bg-amber-500/15 border-amber-500/50 text-white shadow-md shadow-amber-500/10"
                        : "bg-[#182234] border-[#1f2d44] text-slate-400 hover:text-slate-200"
                    }`}
                  >
                    <div className="font-bold text-amber-400 flex items-center justify-between">
                      <span>Custom Window</span>
                      {writeStyle === "Custom" && (
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-400"></span>
                      )}
                    </div>
                    <div className="text-[10px] text-slate-400 mt-1 leading-snug">
                      Arbitrary start date/time and expiration date/time.
                    </div>
                  </button>
                </div>
              </div>

              {/* Timezone Switcher */}
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 p-2.5 rounded-xl bg-[#0b0e14] border border-[#1f2d44]">
                <div className="flex items-center gap-1.5 text-xs text-slate-300 font-semibold">
                  <Globe className="w-4 h-4 text-sky-400 shrink-0" />
                  <span>Timezone Display:</span>
                  <span className="text-[11px] text-slate-400 font-normal">
                    (Local: {formatDateTimeDual(Date.now()).localTimezone || "Local"})
                  </span>
                </div>
                <div className="flex items-center bg-[#182234] p-0.5 rounded-lg border border-[#1f2d44] text-[11px] font-bold">
                  <button
                    type="button"
                    onClick={() => handleToggleTimezoneMode("local")}
                    className={`px-2.5 py-1 rounded-md transition-all ${
                      writeTimezoneMode === "local"
                        ? "bg-sky-500/20 text-sky-300 border border-sky-500/40 shadow-sm"
                        : "text-slate-400 hover:text-slate-200"
                    }`}
                  >
                    Local ({formatDateTimeDual(Date.now()).localTimezone || "Local"})
                  </button>
                  <button
                    type="button"
                    onClick={() => handleToggleTimezoneMode("utc")}
                    className={`px-2.5 py-1 rounded-md transition-all ${
                      writeTimezoneMode === "utc"
                        ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 shadow-sm"
                        : "text-slate-400 hover:text-slate-200"
                    }`}
                  >
                    UTC Time (GMT)
                  </button>
                </div>
              </div>

              {/* Deposit Asset (Underlying Collateral) */}
              <div>
                <label className="block text-slate-300 font-semibold mb-1.5">
                  Deposit Asset (Underlying Locked in Option)
                </label>
                <select
                  value={writeDepositAssetUnit}
                  onChange={(e) => handleDepositAssetChange(e.target.value)}
                  className="w-full bg-[#182234] border border-[#1f2d44] rounded-xl px-3 py-2 text-white font-medium focus:outline-none focus:border-emerald-500/50"
                >
                  {defaultTokens.map((t) => (
                    <option key={t.unit} value={t.unit}>
                      {t.symbol} ({t.name})
                    </option>
                  ))}
                </select>
              </div>

              {/* Swap Button */}
              <div className="flex justify-center -my-1">
                <button
                  type="button"
                  onClick={handleSwapAssets}
                  className="inline-flex items-center gap-1.5 px-3 py-1 bg-[#182234] hover:bg-[#22314a] border border-[#1f2d44] hover:border-emerald-500/40 rounded-full text-[11px] font-semibold text-slate-300 hover:text-emerald-400 transition-all shadow-sm"
                  title="Swap Deposit and Payment Assets"
                >
                  <ArrowUpDown className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Swap Assets</span>
                </button>
              </div>

              {/* Payment Asset (Strike Asset) */}
              <div>
                <label className="block text-slate-300 font-semibold mb-1.5">
                  Payment Asset (Paid by Buyer upon Exercise)
                </label>
                <select
                  value={writePaymentAssetUnit}
                  onChange={(e) => handlePaymentAssetChange(e.target.value)}
                  className="w-full bg-[#182234] border border-[#1f2d44] rounded-xl px-3 py-2 text-white font-medium focus:outline-none focus:border-emerald-500/50"
                >
                  {defaultTokens.map((t) => (
                    <option key={t.unit} value={t.unit}>
                      {t.symbol} ({t.name})
                    </option>
                  ))}
                </select>
              </div>

              {/* Same Token Warning Banner */}
              {isSameToken && (
                <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs flex items-start gap-2.5">
                  <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-semibold">Deposit and Payment assets cannot be identical</span>
                    <p className="text-amber-400/80 mt-0.5">
                      An option contract must exchange one asset for a different asset. Please select two distinct tokens.
                    </p>
                  </div>
                </div>
              )}

              {/* Collateral Amount / Options to Mint */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-300 font-semibold mb-1.5">
                    Total Deposit Amount
                  </label>
                  <input
                    type="number"
                    min="1"
                    step="any"
                    value={writeDepositAmount}
                    onChange={(e) => setWriteDepositAmount(e.target.value)}
                    placeholder="e.g. 100"
                    className="w-full bg-[#182234] border border-[#1f2d44] rounded-xl px-3 py-2 text-white font-mono focus:outline-none focus:border-emerald-500/50"
                  />
                  <div className="text-[10px] text-slate-400 mt-1">
                    {writeDepositAmount && !isNaN(parseFloat(writeDepositAmount))
                      ? `${(parseFloat(writeDepositAmount) * Math.pow(10, (defaultTokens.find((t) => t.unit === writeDepositAssetUnit)?.decimals ?? (writeDepositAssetUnit === "lovelace" ? 6 : 0)))).toLocaleString()} option tokens will be minted (1 token = 1 atomic unit)`
                      : "1 option token minted per 1 atomic unit of collateral"}
                  </div>
                </div>

                <div>
                  <label className="block text-slate-300 font-semibold mb-1.5">
                    Strike Price
                  </label>
                  <input
                    type="number"
                    min="0.000001"
                    step="any"
                    value={writeStrikePrice}
                    onChange={(e) => setWriteStrikePrice(e.target.value)}
                    placeholder="e.g. 2.5"
                    className="w-full bg-[#182234] border border-[#1f2d44] rounded-xl px-3 py-2 text-white font-mono focus:outline-none focus:border-emerald-500/50"
                  />
                  <div className="text-[10px] text-slate-400 mt-1">
                    Payment tokens per 1 deposit token
                  </div>
                </div>
              </div>

              {/* When Custom Style: Exercise Start Date & Time */}
              {writeStyle === "Custom" && (
                <div className="p-3.5 rounded-2xl bg-[#0e1420] border border-amber-500/30 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <label className="text-slate-200 font-bold text-xs flex items-center gap-1.5">
                      <Calendar className="w-3.5 h-3.5 text-amber-400" />
                      <span>Exercise Start Date & Time</span>
                    </label>
                    <span className="text-[10px] text-amber-300 font-mono">
                      Arbitrary exercise opening
                    </span>
                  </div>

                  {/* Start Presets */}
                  <div className="flex flex-wrap gap-1.5">
                    {START_PRESETS.map((p) => (
                      <button
                        key={p.label}
                        type="button"
                        onClick={() => handleApplyStartPreset(p.ms)}
                        className="px-2 py-1 text-[11px] font-semibold rounded-lg bg-[#182234] hover:bg-[#1f2d44] border border-[#1f2d44] text-slate-300 hover:text-white transition-colors"
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>

                  {/* Datetime Input for Start */}
                  <div>
                    <input
                      type="datetime-local"
                      value={writeStartInput}
                      onChange={(e) => handleStartInputChange(e.target.value)}
                      className="w-full bg-[#121824] border border-[#1f2d44] rounded-xl px-3 py-2 text-white font-mono text-xs focus:outline-none focus:border-amber-500/50"
                    />
                  </div>

                  {/* Dual Timezone Feedback for Start */}
                  <div className="p-2 rounded-xl bg-[#0b0e14] border border-[#1f2d44] space-y-1 text-[11px]">
                    <div className="flex items-center justify-between text-slate-400">
                      <span>📍 Start (Local):</span>
                      <span className="font-mono text-slate-200 font-medium">
                        {formatDateTimeDual(writeStartMs).localFull}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-slate-400">
                      <span>🌐 Start (UTC):</span>
                      <span className="font-mono text-amber-400 font-medium">
                        {formatDateTimeDual(writeStartMs).utcFull}
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {/* Expiration Date & Time (for all styles) */}
              <div className="p-3.5 rounded-2xl bg-[#0e1420] border border-[#1f2d44] space-y-2.5">
                <div className="flex items-center justify-between">
                  <label className="text-slate-200 font-bold text-xs flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5 text-emerald-400" />
                    <span>Expiration Date & Time</span>
                  </label>
                  <span className="text-[10px] text-emerald-400 font-mono">
                    Any arbitrary future date/time
                  </span>
                </div>

                {/* Duration Presets */}
                <div className="flex flex-wrap gap-1.5">
                  {EXPIRATION_PRESETS.map((p) => (
                    <button
                      key={p.label}
                      type="button"
                      onClick={() => handleApplyExpirationPreset(p.days)}
                      className="px-2.5 py-1 text-[11px] font-semibold rounded-lg bg-[#182234] hover:bg-[#1f2d44] border border-[#1f2d44] text-slate-300 hover:text-white transition-colors"
                    >
                      {p.label}
                    </button>
                  ))}
                </div>

                {/* Quick UTC Hour Alignment */}
                <div className="flex items-center gap-1.5 text-[10px] text-slate-400">
                  <span className="shrink-0 font-medium">Align to UTC Hour:</span>
                  {[0, 8, 12, 16].map((h) => (
                    <button
                      key={h}
                      type="button"
                      onClick={() => handleSetUtcHour(h)}
                      className="px-2 py-0.5 rounded bg-[#121824] hover:bg-[#1f2d44] border border-[#1f2d44] text-slate-300 font-mono transition-colors"
                    >
                      {h.toString().padStart(2, "0")}:00 UTC
                    </button>
                  ))}
                </div>

                {/* Arbitrary Datetime Input */}
                <div>
                  <input
                    type="datetime-local"
                    value={writeExpirationInput}
                    min={formatDatetimeInputValue(Date.now() + 60_000, writeTimezoneMode)}
                    onChange={(e) => handleExpirationInputChange(e.target.value)}
                    className="w-full bg-[#121824] border border-[#1f2d44] rounded-xl px-3 py-2 text-white font-mono text-xs focus:outline-none focus:border-emerald-500/50"
                  />
                </div>

                {/* Dual Timezone Feedback for Expiration */}
                <div className="p-2.5 rounded-xl bg-[#0b0e14] border border-[#1f2d44] space-y-1 text-[11px]">
                  <div className="flex items-center justify-between text-slate-400">
                    <span>📍 Expiry (Local):</span>
                    <span className="font-mono text-slate-200 font-semibold">
                      {formatDateTimeDual(writeExpirationMs).localFull}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-slate-400">
                    <span>🌐 Expiry (UTC):</span>
                    <span className="font-mono text-emerald-400 font-semibold">
                      {formatDateTimeDual(writeExpirationMs).utcFull}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-slate-500 text-[10px] pt-1 border-t border-[#1f2d44]/50">
                    <span>Relative Duration:</span>
                    <span className="font-medium text-slate-300 font-mono">
                      {formatDateTimeDual(writeExpirationMs).relative}
                    </span>
                  </div>
                </div>
              </div>

              {/* Schedule Summary Preview */}
              <div className="p-3 rounded-xl bg-[#0b0e14] border border-[#1f2d44] space-y-1.5 text-[11px]">
                <div className="font-bold text-slate-300 flex items-center gap-1.5">
                  <Info className="w-3.5 h-3.5 text-sky-400" />
                  <span>Option Schedule Summary</span>
                </div>

                {writeStyle === "American" && (
                  <div className="text-slate-400 leading-relaxed">
                    • <span className="text-sky-300 font-semibold">American Style:</span> Exercisable immediately upon creation until expiration on{" "}
                    <span className="text-white font-mono">{formatDateTimeDual(writeExpirationMs).localFull}</span>{" "}
                    <span className="text-emerald-400 font-mono">({formatDateTimeDual(writeExpirationMs).utcFull})</span>.
                  </div>
                )}

                {writeStyle === "European" && (
                  <div className="text-slate-400 leading-relaxed space-y-1">
                    <div>
                      • <span className="text-purple-300 font-semibold">European Style:</span> Exercisable only during the final 24-hour window before expiration:
                    </div>
                    <div className="pl-3 text-[10px] space-y-0.5 font-mono">
                      <div>Opens: <span className="text-slate-200">{formatDateTimeDual(Math.max(Date.now(), writeExpirationMs - 86_400_000)).localFull}</span> ({formatDateTimeDual(Math.max(Date.now(), writeExpirationMs - 86_400_000)).utcFull})</div>
                      <div>Expires: <span className="text-slate-200">{formatDateTimeDual(writeExpirationMs).localFull}</span> ({formatDateTimeDual(writeExpirationMs).utcFull})</div>
                    </div>
                  </div>
                )}

                {writeStyle === "Custom" && (
                  <div className="text-slate-400 leading-relaxed space-y-1">
                    <div>
                      • <span className="text-amber-300 font-semibold">Custom Window:</span>
                    </div>
                    <div className="pl-3 text-[10px] space-y-0.5 font-mono">
                      <div>Opens: <span className="text-slate-200">{formatDateTimeDual(writeStartMs).localFull}</span> ({formatDateTimeDual(writeStartMs).utcFull})</div>
                      <div>Expires: <span className="text-slate-200">{formatDateTimeDual(writeExpirationMs).localFull}</span> ({formatDateTimeDual(writeExpirationMs).utcFull})</div>
                    </div>
                  </div>
                )}

                <div className="text-slate-400 pt-1 border-t border-[#1f2d44]/50">
                  • <span className="text-slate-300 font-medium">Unsold Cancellation:</span> Available at any time before cutoff to burn unsold tokens and refund your collateral.
                </div>
              </div>

              {/* Protocol Guarantees Note */}
              <div className="p-3 rounded-xl bg-[#0b0e14] border border-[#1f2d44] space-y-1 text-[11px] text-slate-400">
                <div className="flex items-center gap-1.5 text-emerald-400 font-bold">
                  <ShieldCheck className="w-4 h-4" />
                  <span>Protocol Guarantees</span>
                </div>
                <div>• Zero protocol fees (0 ADA).</div>
                <div>• Deposit collateral (+ 3 ADA minAda) is locked securely in Plutus V3 validator.</div>
                <div>• Only unsold options you hold can be cancelled early; sold options remain fully backed.</div>
              </div>
            </div>

            {actionError && (
              <div className="p-3.5 rounded-xl bg-rose-950/40 border border-rose-800/50 text-rose-200 text-xs flex items-start gap-2.5">
                <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                <div className="flex-1 break-words text-xs leading-relaxed">
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-bold text-rose-300">Minting Error</span>
                    <button
                      type="button"
                      onClick={() => setActionError(null)}
                      className="text-rose-400 hover:text-rose-200 transition-colors"
                      title="Dismiss error"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <p className="text-rose-200/90 font-sans">{actionError}</p>
                </div>
              </div>
            )}

            <div className="flex items-center justify-end gap-3 pt-3 border-t border-[#1f2d44]">
              <button
                type="button"
                onClick={() => setShowWriteModal(false)}
                className="px-4 py-2 rounded-xl text-slate-400 hover:text-white font-semibold text-xs transition-colors"
              >
                Cancel
              </button>

              <button
                type="button"
                onClick={handleWriteOption}
                disabled={actionPending || !wallet.connected || isSameToken}
                className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-600 hover:to-teal-600 disabled:opacity-50 text-slate-950 font-bold text-xs transition-all shadow-lg shadow-emerald-500/20 flex items-center gap-2"
              >
                {actionPending ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Minting...</span>
                  </>
                ) : isSameToken ? (
                  <span>Select Distinct Assets</span>
                ) : (
                  <span>Mint & Lock Option</span>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------- */}
      {/* MODAL 2: Exercise Options */}
      {/* ------------------------------------------------------------- */}
      {executingPosition && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/80 backdrop-blur-sm">
          <div className="bg-[#121824] border border-[#1f2d44] rounded-3xl w-full max-w-md p-5 sm:p-7 space-y-5 shadow-2xl relative">
            <div className="flex items-center justify-between pb-3 border-b border-[#1f2d44]">
              <div>
                <h3 className="text-lg font-bold text-white flex items-center gap-2">
                  <Zap className="w-5 h-5 text-emerald-400" />
                  <span>Exercise Option</span>
                </h3>
                <p className="text-xs text-slate-400">
                  Burn option tokens to claim underlying deposit collateral
                </p>
              </div>
              <button
                onClick={() => setExecutingPosition(null)}
                className="text-slate-400 hover:text-white text-lg leading-none p-1"
              >
                ✕
              </button>
            </div>

            <div className="space-y-4 text-xs">
              <div className="p-3.5 rounded-xl bg-[#0b0e14] border border-[#1f2d44] space-y-1.5">
                <div className="text-slate-400">Position</div>
                <div className="text-sm font-bold text-white">
                  {executingPosition.tokenNameDisplay}
                </div>
                <div className="text-[11px] text-slate-300">
                  Strike: <span className="font-mono font-bold text-emerald-400">{executingPosition.strikePriceDisplay}</span>
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-slate-300 font-semibold">Amount to Exercise</label>
                  <button
                    type="button"
                    onClick={() => setExecuteAmount(executingPosition.userOptionBalance.toString())}
                    className="text-[11px] text-emerald-400 hover:text-emerald-300 font-mono transition-colors"
                  >
                    Max: {Number(executingPosition.userOptionBalance).toLocaleString()} options
                  </button>
                </div>
                <input
                  type="number"
                  min="1"
                  max={executingPosition.userOptionBalance.toString()}
                  value={executeAmount}
                  onChange={(e) => setExecuteAmount(e.target.value)}
                  className="w-full bg-[#182234] border border-[#1f2d44] rounded-xl px-3 py-2 text-white font-mono focus:outline-none focus:border-emerald-500/50"
                />
              </div>

              {/* Required Strike Payment Calculation */}
              <div className="p-3.5 rounded-xl bg-emerald-950/20 border border-emerald-500/30 space-y-1 text-slate-300">
                <div className="text-[11px] font-semibold text-emerald-400 uppercase tracking-wide">
                  Exercise Summary
                </div>
                <div className="flex justify-between">
                  <span>Burn Option Tokens:</span>
                  <span className="font-mono text-white font-bold">
                    {(() => {
                      const raw = parseFloat(executeAmount || "0");
                      return isNaN(raw) ? "0" : Math.floor(raw).toLocaleString();
                    })()}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Receive Collateral:</span>
                  <span className="font-mono text-emerald-400 font-bold">
                    {(() => {
                      const raw = parseFloat(executeAmount || "0");
                      const val = isNaN(raw) ? 0 : raw / Math.pow(10, executingPosition.depositDecimals);
                      return `${val.toLocaleString(undefined, { maximumFractionDigits: executingPosition.depositDecimals })} ${executingPosition.depositSymbol}`;
                    })()}
                  </span>
                </div>
                <div className="flex justify-between pt-1 border-t border-emerald-500/20">
                  <span>Required Strike Payment:</span>
                  <span className="font-mono text-white font-bold">
                    {(() => {
                      try {
                        const amtBig = BigInt(Math.floor(parseFloat(executeAmount || "0")));
                        if (amtBig <= 0n) return `0 ${executingPosition.paymentSymbol}`;
                        const rawPay = calculateRequiredPayment(amtBig, executingPosition.datum.opdPrice);
                        const humanPay = Number(rawPay) / Math.pow(10, executingPosition.paymentDecimals);
                        return `${humanPay.toLocaleString(undefined, { maximumFractionDigits: executingPosition.paymentDecimals })} ${executingPosition.paymentSymbol}`;
                      } catch {
                        return `0 ${executingPosition.paymentSymbol}`;
                      }
                    })()}
                  </span>
                </div>
              </div>
            </div>

            {actionError && (
              <div className="p-3.5 rounded-xl bg-rose-950/40 border border-rose-800/50 text-rose-200 text-xs flex items-start gap-2.5">
                <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                <div className="flex-1 break-words text-xs leading-relaxed">
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-bold text-rose-300">Exercise Error</span>
                    <button
                      type="button"
                      onClick={() => setActionError(null)}
                      className="text-rose-400 hover:text-rose-200 transition-colors"
                      title="Dismiss error"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <p className="text-rose-200/90 font-sans">{actionError}</p>
                </div>
              </div>
            )}

            <div className="flex items-center justify-end gap-3 pt-3 border-t border-[#1f2d44]">
              <button
                type="button"
                onClick={() => setExecutingPosition(null)}
                className="px-4 py-2 rounded-xl text-slate-400 hover:text-white font-semibold text-xs transition-colors"
              >
                Cancel
              </button>

              <button
                type="button"
                onClick={handleExecute}
                disabled={actionPending || !executeAmount || parseFloat(executeAmount) <= 0}
                className="px-5 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 text-slate-950 font-bold text-xs transition-colors flex items-center gap-2"
              >
                {actionPending ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Submitting...</span>
                  </>
                ) : (
                  <span>Confirm Exercise</span>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------- */}
      {/* MODAL 3: Cancel Early (Unsold Options) */}
      {/* ------------------------------------------------------------- */}
      {cancelingPosition && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/80 backdrop-blur-sm">
          <div className="bg-[#121824] border border-[#1f2d44] rounded-3xl w-full max-w-md p-5 sm:p-7 space-y-5 shadow-2xl relative">
            <div className="flex items-center justify-between pb-3 border-b border-[#1f2d44]">
              <div>
                <h3 className="text-lg font-bold text-white flex items-center gap-2">
                  <Flame className="w-5 h-5 text-amber-400" />
                  <span>Cancel Unsold Options</span>
                </h3>
                <p className="text-xs text-slate-400">
                  Burn unsold options to reclaim deposited collateral early
                </p>
              </div>
              <button
                onClick={() => setCancelingPosition(null)}
                className="text-slate-400 hover:text-white text-lg leading-none p-1"
              >
                ✕
              </button>
            </div>

            <div className="space-y-4 text-xs">
              <div className="p-3.5 rounded-xl bg-[#0b0e14] border border-[#1f2d44] space-y-1.5">
                <div className="text-slate-400">Position</div>
                <div className="text-sm font-bold text-white">
                  {cancelingPosition.tokenNameDisplay}
                </div>
                <div className="text-[11px] text-amber-300">
                  Unsold in your wallet:{" "}
                  <span className="font-mono font-bold">
                    {Number(cancelingPosition.userUnsoldBalance).toLocaleString()} options (
                    {(Number(cancelingPosition.userUnsoldBalance) / Math.pow(10, cancelingPosition.depositDecimals)).toLocaleString(undefined, {
                      maximumFractionDigits: cancelingPosition.depositDecimals,
                    })}{" "}
                    {cancelingPosition.depositSymbol})
                  </span>
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-slate-300 font-semibold">Amount to Cancel</label>
                  <button
                    type="button"
                    onClick={() => setCancelAmount(cancelingPosition.userUnsoldBalance.toString())}
                    className="text-[11px] text-amber-400 hover:text-amber-300 font-mono transition-colors"
                  >
                    Max: {Number(cancelingPosition.userUnsoldBalance).toLocaleString()} options
                  </button>
                </div>
                <input
                  type="number"
                  min="1"
                  max={cancelingPosition.userUnsoldBalance.toString()}
                  value={cancelAmount}
                  onChange={(e) => setCancelAmount(e.target.value)}
                  className="w-full bg-[#182234] border border-[#1f2d44] rounded-xl px-3 py-2 text-white font-mono focus:outline-none focus:border-amber-500/50"
                />
              </div>

              <div className="p-3.5 rounded-xl bg-amber-950/20 border border-amber-500/30 space-y-1 text-slate-300">
                <div className="text-[11px] font-semibold text-amber-400 uppercase tracking-wide">
                  Buyer Protection Guarantee
                </div>
                <div className="text-[11px] leading-relaxed">
                  Options sold to buyers remain 100% active and backed by the continuing script output.
                  Only the unsold options you hold will be burned and refunded.
                </div>
                <div className="flex justify-between pt-1 border-t border-amber-500/20 font-bold text-white">
                  <span>Collateral to Reclaim:</span>
                  <span className="font-mono text-emerald-400">
                    {(() => {
                      const raw = parseFloat(cancelAmount || "0");
                      const val = isNaN(raw) ? 0 : raw / Math.pow(10, cancelingPosition.depositDecimals);
                      return `${val.toLocaleString(undefined, { maximumFractionDigits: cancelingPosition.depositDecimals })} ${cancelingPosition.depositSymbol}`;
                    })()}
                  </span>
                </div>
                {(() => {
                  try {
                    const amt = BigInt(Math.floor(parseFloat(cancelAmount || "0")));
                    if (amt > 0n && amt === cancelingPosition.remainingDeposit) {
                      return (
                        <div className="flex justify-between text-slate-400 font-mono text-[11px]">
                          <span>Min ADA Collateral:</span>
                          <span>+ 3.00 ADA (refunded)</span>
                        </div>
                      );
                    }
                  } catch {}
                  return null;
                })()}
              </div>
            </div>

            {actionError && (
              <div className="p-3.5 rounded-xl bg-rose-950/40 border border-rose-800/50 text-rose-200 text-xs flex items-start gap-2.5">
                <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                <div className="flex-1 break-words text-xs leading-relaxed">
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-bold text-rose-300">Cancellation Error</span>
                    <button
                      type="button"
                      onClick={() => setActionError(null)}
                      className="text-rose-400 hover:text-rose-200 transition-colors"
                      title="Dismiss error"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <p className="text-rose-200/90 font-sans">{actionError}</p>
                </div>
              </div>
            )}

            <div className="flex items-center justify-end gap-3 pt-3 border-t border-[#1f2d44]">
              <button
                type="button"
                onClick={() => setCancelingPosition(null)}
                className="px-4 py-2 rounded-xl text-slate-400 hover:text-white font-semibold text-xs transition-colors"
              >
                Back
              </button>

              <button
                type="button"
                onClick={handleCancelEarly}
                disabled={actionPending || !cancelAmount || parseFloat(cancelAmount) <= 0}
                className="px-5 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-slate-950 font-bold text-xs transition-colors flex items-center gap-2"
              >
                {actionPending ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Cancelling...</span>
                  </>
                ) : (
                  <span>Confirm Cancellation</span>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------- */}
      {/* MODAL 4: Retrieve Expired Collateral */}
      {/* ------------------------------------------------------------- */}
      {retrievingPosition && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/80 backdrop-blur-sm">
          <div className="bg-[#121824] border border-[#1f2d44] rounded-3xl w-full max-w-md p-5 sm:p-7 space-y-5 shadow-2xl relative">
            <div className="flex items-center justify-between pb-3 border-b border-[#1f2d44]">
              <div>
                <h3 className="text-lg font-bold text-white flex items-center gap-2">
                  <Coins className="w-5 h-5 text-purple-400" />
                  <span>Retrieve Expired Collateral</span>
                </h3>
                <p className="text-xs text-slate-400">
                  Reclaim 100% of remaining collateral and strike proceeds
                </p>
              </div>
              <button
                onClick={() => setRetrievingPosition(null)}
                className="text-slate-400 hover:text-white text-lg leading-none p-1"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <p className="text-slate-300 leading-relaxed">
                This option expired at{" "}
                <span className="font-mono text-white">
                  {new Date(retrievingPosition.expirationTimeMs).toLocaleString()}
                </span>
                . As the writer, you can now consume the script UTxO, burn the Position NFT, and
                transfer all remaining assets into your wallet.
              </p>

              <div className="p-3.5 rounded-xl bg-purple-950/20 border border-purple-500/30 space-y-1.5">
                <div className="text-[11px] font-semibold text-purple-300 uppercase tracking-wide">
                  Assets to Reclaim
                </div>
                <div className="flex justify-between text-white font-mono">
                  <span>Remaining Collateral:</span>
                  <span className="font-bold text-emerald-400">
                    {(Number(retrievingPosition.remainingDeposit) / Math.pow(10, retrievingPosition.depositDecimals)).toLocaleString()}{" "}
                    {retrievingPosition.depositSymbol}
                  </span>
                </div>
                {retrievingPosition.accumulatedStrikePayment > 0n && (
                  <div className="flex justify-between text-white font-mono">
                    <span>Strike Proceeds:</span>
                    <span className="font-bold text-sky-400">
                      {(Number(retrievingPosition.accumulatedStrikePayment) / Math.pow(10, retrievingPosition.paymentDecimals)).toLocaleString()}{" "}
                      {retrievingPosition.paymentSymbol}
                    </span>
                  </div>
                )}
                <div className="flex justify-between text-slate-400 font-mono text-[11px]">
                  <span>Min ADA Collateral:</span>
                  <span>3.00 ADA (refunded)</span>
                </div>
              </div>
            </div>

            {actionError && (
              <div className="p-3.5 rounded-xl bg-rose-950/40 border border-rose-800/50 text-rose-200 text-xs flex items-start gap-2.5">
                <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                <div className="flex-1 break-words text-xs leading-relaxed">
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-bold text-rose-300">Retrieve Error</span>
                    <button
                      type="button"
                      onClick={() => setActionError(null)}
                      className="text-rose-400 hover:text-rose-200 transition-colors"
                      title="Dismiss error"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <p className="text-rose-200/90 font-sans">{actionError}</p>
                </div>
              </div>
            )}

            <div className="flex items-center justify-end gap-3 pt-3 border-t border-[#1f2d44]">
              <button
                type="button"
                onClick={() => setRetrievingPosition(null)}
                className="px-4 py-2 rounded-xl text-slate-400 hover:text-white font-semibold text-xs transition-colors"
              >
                Back
              </button>

              <button
                type="button"
                onClick={handleRetrieve}
                disabled={actionPending}
                className="px-5 py-2.5 rounded-xl bg-purple-500 hover:bg-purple-600 disabled:opacity-50 text-white font-bold text-xs transition-colors flex items-center gap-2"
              >
                {actionPending ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Retrieving...</span>
                  </>
                ) : (
                  <span>Reclaim Everything</span>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------- */}
      {/* MODAL 5: List Option for Sale on DEX */}
      {/* ------------------------------------------------------------- */}
      {listingPosition && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/80 backdrop-blur-sm">
          <div className="bg-[#121824] border border-[#1f2d44] rounded-3xl w-full max-w-md p-5 sm:p-7 space-y-5 shadow-2xl relative">
            <div className="flex items-center justify-between pb-3 border-b border-[#1f2d44]">
              <div>
                <h3 className="text-lg font-bold text-white flex items-center gap-2">
                  <Tag className="w-5 h-5 text-emerald-400" />
                  <span>List Option on DEX</span>
                </h3>
                <p className="text-xs text-slate-400">
                  Create an on-chain limit sell order on Genius Yield DEX
                </p>
              </div>
              <button
                onClick={() => setListingPosition(null)}
                className="text-slate-400 hover:text-white text-lg leading-none p-1"
              >
                ✕
              </button>
            </div>

            <div className="space-y-4 text-xs">
              {/* Option Details Card */}
              <div className="p-3.5 rounded-xl bg-[#0b0e14] border border-[#1f2d44] space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-white text-sm">
                    {listingPosition.tokenNameDisplay}
                  </span>
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                    {listingPosition.style}
                  </span>
                </div>
                <div className="text-[11px] text-slate-400 leading-relaxed">
                  Strike Price:{" "}
                  <span className="text-sky-400 font-mono font-semibold">
                    {listingPosition.strikePriceDisplay}
                  </span>
                  . Total Deposit:{" "}
                  <span className="text-emerald-400 font-mono font-semibold">
                    {(Number(listingPosition.remainingDeposit) / Math.pow(10, listingPosition.depositDecimals)).toLocaleString()}{" "}
                    {listingPosition.depositSymbol}
                  </span>
                </div>
                <div className="flex items-center justify-between pt-1 border-t border-[#1f2d44] text-[11px]">
                  <span className="text-slate-400">Your Wallet Balance:</span>
                  <span className="font-mono font-bold text-white">
                    {listingPosition.userOptionBalance.toString()} option(s)
                  </span>
                </div>
              </div>

              {/* Quantity Input */}
              {(() => {
                const maxSellable = calculateMaxSellableOptions(listingPosition.userOptionBalance);
                const parsedQty = parseInt(listingAmount || "0", 10);
                const qtyBig = !isNaN(parsedQty) && parsedQty > 0 ? BigInt(parsedQty) : 0n;
                const feeBig = calculateMakerFeeTokens(qtyBig);
                const totalNeeded = qtyBig + feeBig;
                const isOverBalance = totalNeeded > listingPosition.userOptionBalance;

                return (
                  <div className="space-y-1.5">
                    <div className="flex justify-between items-center text-slate-300 font-medium">
                      <label>Quantity to Sell</label>
                      <button
                        type="button"
                        onClick={() => setListingAmount(maxSellable.toString())}
                        className="text-[10px] text-emerald-400 hover:underline font-mono"
                        title="Maximum sellable accounting for 0.3% DEX maker fee"
                      >
                        MAX ({maxSellable.toLocaleString()})
                      </button>
                    </div>
                    <input
                      type="number"
                      min="1"
                      max={maxSellable.toString()}
                      step="1"
                      value={listingAmount}
                      onChange={(e) => setListingAmount(e.target.value)}
                      className={`w-full bg-[#0b0e14] border rounded-xl px-3 py-2 text-white font-mono text-sm focus:outline-none transition-colors ${
                        isOverBalance
                          ? "border-rose-500/80 focus:border-rose-500 text-rose-200"
                          : "border-[#1f2d44] focus:border-emerald-500/50"
                      }`}
                      placeholder="1"
                    />

                    {isOverBalance ? (
                      <div className="p-3 rounded-xl bg-rose-950/40 border border-rose-800/50 text-rose-300 text-[11px] leading-relaxed flex items-start gap-2">
                        <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                        <div className="space-y-1">
                          <div>
                            Offering <strong>{qtyBig.toLocaleString()}</strong> options requires{" "}
                            <strong>{totalNeeded.toLocaleString()}</strong> option tokens (including the 0.3% DEX protocol maker fee of{" "}
                            <strong>{feeBig.toLocaleString()}</strong> options), exceeding your wallet balance of{" "}
                            <strong>{listingPosition.userOptionBalance.toLocaleString()}</strong> options.
                          </div>
                          <button
                            type="button"
                            onClick={() => setListingAmount(maxSellable.toString())}
                            className="text-emerald-400 hover:underline font-semibold flex items-center gap-1 text-xs"
                          >
                            Adjust to maximum sellable: {maxSellable.toLocaleString()} options
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex justify-between items-center text-[10px] text-slate-400 px-0.5 font-mono">
                        <span>DEX Maker Fee (0.3%): {feeBig.toLocaleString()} options</span>
                        <span>Total Escrowed: {totalNeeded.toLocaleString()} / {listingPosition.userOptionBalance.toLocaleString()}</span>
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* Quote Currency Select (Decoupled, defaults to ADA) */}
              <div className="space-y-1.5">
                <label className="text-slate-300 font-medium flex items-center justify-between">
                  <span>Receive Payment In (Quotation Currency)</span>
                  <span className="text-[10px] text-emerald-400 font-mono">DEX Quote Asset</span>
                </label>
                <select
                  value={listingQuoteUnit}
                  onChange={(e) => setListingQuoteUnit(e.target.value)}
                  className="w-full bg-[#0b0e14] border border-[#1f2d44] rounded-xl px-3 py-2 text-white text-xs focus:outline-none focus:border-emerald-500/50"
                >
                  <option value="lovelace">
                    {settings.network === "mainnet" ? "ADA" : "tADA"} (Cardano Native Currency - Default)
                  </option>
                  {defaultTokens
                    .filter((t) => t.unit !== "lovelace")
                    .map((t) => (
                      <option key={t.unit} value={t.unit}>
                        {t.symbol} ({t.assetName || t.unit.slice(0, 10)}...)
                      </option>
                    ))}
                </select>
                <p className="text-[10px] text-slate-400 leading-normal">
                  You can trade your option token for ADA or any other token on the DEX independently of the option's collateral and strike assets.
                </p>
              </div>

              {/* Price per Option Input */}
              <div className="space-y-1.5">
                <label className="text-slate-300 font-medium flex items-center justify-between">
                  <span>Asking Price per Option Token</span>
                  <span className="text-[10px] text-slate-400 font-mono">
                    in {listingQuoteUnit === "lovelace" ? (settings.network === "mainnet" ? "ADA" : "tADA") : (defaultTokens.find(t => t.unit === listingQuoteUnit)?.symbol || "Token")}
                  </span>
                </label>
                <div className="relative">
                  <input
                    type="number"
                    min="0.000001"
                    step="0.1"
                    value={listingPricePerOption}
                    onChange={(e) => setListingPricePerOption(e.target.value)}
                    className="w-full bg-[#0b0e14] border border-[#1f2d44] rounded-xl px-3 py-2 text-white font-mono text-sm focus:outline-none focus:border-emerald-500/50"
                    placeholder="2.0"
                  />
                  <div className="absolute right-3 top-1/2 -translate-y-1/2 font-mono text-xs text-slate-400">
                    {listingQuoteUnit === "lovelace" ? (settings.network === "mainnet" ? "ADA" : "tADA") : (defaultTokens.find(t => t.unit === listingQuoteUnit)?.symbol || "Token")}
                  </div>
                </div>
              </div>

              {/* Order Financial Summary */}
              {(() => {
                const parsedQty = parseInt(listingAmount || "0", 10);
                const qtyBig = !isNaN(parsedQty) && parsedQty > 0 ? BigInt(parsedQty) : 0n;
                const feeBig = calculateMakerFeeTokens(qtyBig);
                const totalNeeded = qtyBig + feeBig;
                const qty = parseFloat(listingAmount || "0");
                const price = parseFloat(listingPricePerOption || "0");
                const total = isNaN(qty) || isNaN(price) ? 0 : qty * price;
                const sym =
                  listingQuoteUnit === "lovelace"
                    ? settings.network === "mainnet"
                      ? "ADA"
                      : "tADA"
                    : defaultTokens.find((t) => t.unit === listingQuoteUnit)?.symbol || "Token";

                return (
                  <div className="p-3.5 rounded-xl bg-emerald-950/20 border border-emerald-500/20 space-y-2">
                    <div className="text-[11px] font-semibold text-emerald-300 uppercase tracking-wide">
                      Order Summary
                    </div>

                    <div className="flex justify-between text-slate-300 font-mono text-xs">
                      <span>Quantity Offered:</span>
                      <span className="font-semibold text-white">
                        {qtyBig > 0n ? `${qtyBig.toLocaleString()} options` : "0 options"}
                      </span>
                    </div>

                    <div className="flex justify-between text-slate-400 font-mono text-[11px]">
                      <span>DEX Protocol Maker Fee (0.3%):</span>
                      <span>{feeBig > 0n ? `${feeBig.toLocaleString()} options` : "0 options"}</span>
                    </div>

                    <div className="flex justify-between text-slate-300 font-mono text-xs border-t border-emerald-500/20 pt-1.5">
                      <span>Total Option Tokens Escrowed:</span>
                      <span className="font-bold text-white">
                        {totalNeeded > 0n ? `${totalNeeded.toLocaleString()} options` : "0 options"}
                      </span>
                    </div>

                    <div className="flex justify-between text-white font-mono text-xs border-t border-emerald-500/20 pt-1.5">
                      <span>Total Expected Revenue:</span>
                      <span className="font-bold text-emerald-400">
                        {total.toLocaleString(undefined, { maximumFractionDigits: 6 })} {sym}
                      </span>
                    </div>

                    <div className="flex justify-between text-slate-400 font-mono text-[11px]">
                      <span>Maker Deposit (Refundable):</span>
                      <span>~2.0 ADA (returned upon fill or cancellation)</span>
                    </div>
                  </div>
                );
              })()}
            </div>

            {actionError && (
              <div className="p-3.5 rounded-xl bg-rose-950/40 border border-rose-800/50 text-rose-200 text-xs flex items-start gap-2.5">
                <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                <div className="flex-1 break-words text-xs leading-relaxed">
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-bold text-rose-300">Listing Error</span>
                    <button
                      type="button"
                      onClick={() => setActionError(null)}
                      className="text-rose-400 hover:text-rose-200 transition-colors"
                      title="Dismiss error"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <p className="text-rose-200/90 font-sans">{actionError}</p>
                </div>
              </div>
            )}

            <div className="flex items-center justify-end gap-3 pt-3 border-t border-[#1f2d44]">
              <button
                type="button"
                onClick={() => setListingPosition(null)}
                className="px-4 py-2 rounded-xl text-slate-400 hover:text-white font-semibold text-xs transition-colors"
              >
                Back
              </button>

              {(() => {
                const parsedQty = parseInt(listingAmount || "0", 10);
                const qtyBig = !isNaN(parsedQty) && parsedQty > 0 ? BigInt(parsedQty) : 0n;
                const feeBig = calculateMakerFeeTokens(qtyBig);
                const totalNeeded = qtyBig + feeBig;
                const isOverBalance = totalNeeded > listingPosition.userOptionBalance;

                return (
                  <button
                    type="button"
                    onClick={handleCreateListing}
                    disabled={
                      actionPending ||
                      !listingAmount ||
                      parsedQty <= 0 ||
                      isOverBalance ||
                      parseFloat(listingPricePerOption) <= 0
                    }
                    className="px-5 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 text-slate-950 font-bold text-xs transition-colors flex items-center gap-2"
                  >
                    {actionPending ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        <span>Listing on DEX...</span>
                      </>
                    ) : (
                      <span>Place DEX Sell Order</span>
                    )}
                  </button>
                );
              })()}
            </div>
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------- */}
      {/* MODAL 6: Buy Option from DEX */}
      {/* ------------------------------------------------------------- */}
      {buyingListing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/80 backdrop-blur-sm">
          <div className="bg-[#121824] border border-[#1f2d44] rounded-3xl w-full max-w-md p-5 sm:p-7 space-y-5 shadow-2xl relative">
            <div className="flex items-center justify-between pb-3 border-b border-[#1f2d44]">
              <div>
                <h3 className="text-lg font-bold text-white flex items-center gap-2">
                  <ShoppingCart className="w-5 h-5 text-emerald-400" />
                  <span>Buy Option from DEX</span>
                </h3>
                <p className="text-xs text-slate-400">
                  Instant fill from Genius Yield DEX order book
                </p>
              </div>
              <button
                onClick={() => setBuyingListing(null)}
                className="text-slate-400 hover:text-white text-lg leading-none p-1"
              >
                ✕
              </button>
            </div>

            <div className="space-y-4 text-xs">
              {/* Option Details Card */}
              <div className="p-3.5 rounded-xl bg-[#0b0e14] border border-[#1f2d44] space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-white text-sm">
                    {buyingListing.matchingPosition
                      ? buyingListing.matchingPosition.tokenNameDisplay
                      : `${buyingListing.optionUnit.slice(0, 12)}...${buyingListing.optionUnit.slice(-6)}`}
                  </span>
                  {buyingListing.matchingPosition && (
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                      {buyingListing.matchingPosition.style}
                    </span>
                  )}
                </div>

                {buyingListing.matchingPosition ? (
                  <div className="text-[11px] text-slate-400 leading-relaxed">
                    Strike Price:{" "}
                    <span className="text-sky-400 font-mono font-semibold">
                      {buyingListing.matchingPosition.strikePriceDisplay}
                    </span>
                    . Backing:{" "}
                    <span className="text-emerald-400 font-mono font-semibold">
                      {(Number(buyingListing.matchingPosition.remainingDeposit) / Math.pow(10, buyingListing.matchingPosition.depositDecimals)).toLocaleString()}{" "}
                      {buyingListing.matchingPosition.depositSymbol}
                    </span>
                  </div>
                ) : (
                  <div className="text-[11px] text-slate-400 leading-relaxed">
                    Option Asset: <span className="font-mono text-slate-200">{buyingListing.optionUnit.slice(0, 20)}...</span>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-2 pt-2 border-t border-[#1f2d44] text-[11px]">
                  <div>
                    <span className="text-slate-400 block text-[10px]">Asking Price:</span>
                    <span className="font-bold text-emerald-400 font-mono">
                      {buyingListing.pricePerOption.toLocaleString(undefined, { maximumFractionDigits: 6 })} {buyingListing.quoteSymbol}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-400 block text-[10px]">Available on Order:</span>
                    <span className="font-bold text-white font-mono">
                      {buyingListing.offeredAmount.toString()} option(s)
                    </span>
                  </div>
                </div>

                {buyingListing.matchingPosition && (
                  <div className="flex justify-between pt-1 border-t border-[#1f2d44]/50 text-[10px] text-slate-400">
                    <span>Expiration:</span>
                    <span className="font-mono text-slate-300">
                      {new Date(buyingListing.matchingPosition.expirationTimeMs).toLocaleString()}
                    </span>
                  </div>
                )}
              </div>

              {/* Quantity Input */}
              <div className="space-y-1.5">
                <div className="flex justify-between items-center text-slate-300 font-medium">
                  <label>Quantity to Buy</label>
                  <button
                    type="button"
                    onClick={() => setBuyQuantity(buyingListing.offeredAmount.toString())}
                    className="text-[10px] text-emerald-400 hover:underline font-mono"
                  >
                    MAX ({buyingListing.offeredAmount.toString()})
                  </button>
                </div>
                <input
                  type="number"
                  min="1"
                  max={buyingListing.offeredAmount.toString()}
                  step="1"
                  value={buyQuantity}
                  onChange={(e) => setBuyQuantity(e.target.value)}
                  className="w-full bg-[#0b0e14] border border-[#1f2d44] rounded-xl px-3 py-2 text-white font-mono text-sm focus:outline-none focus:border-emerald-500/50"
                  placeholder="1"
                />
              </div>

              {/* Cost Breakdown */}
              <div className="p-3.5 rounded-xl bg-sky-950/20 border border-sky-500/20 space-y-1.5">
                <div className="text-[11px] font-semibold text-sky-300 uppercase tracking-wide">
                  Payment Breakdown
                </div>
                <div className="flex justify-between text-white font-mono">
                  <span>Option Purchase Cost:</span>
                  <span className="font-bold text-sky-400">
                    {(() => {
                      const qty = parseFloat(buyQuantity || "0");
                      const cost = isNaN(qty) ? 0 : qty * buyingListing.pricePerOption;
                      return `${cost.toLocaleString(undefined, { maximumFractionDigits: 6 })} ${buyingListing.quoteSymbol}`;
                    })()}
                  </span>
                </div>
                <div className="flex justify-between text-slate-400 font-mono text-[11px]">
                  <span>DEX Taker Flat Fee:</span>
                  <span>1.0 ADA</span>
                </div>
              </div>
            </div>

            {actionError && (
              <div className="p-3.5 rounded-xl bg-rose-950/40 border border-rose-800/50 text-rose-200 text-xs flex items-start gap-2.5">
                <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                <div className="flex-1 break-words text-xs leading-relaxed">
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-bold text-rose-300">Purchase Error</span>
                    <button
                      type="button"
                      onClick={() => setActionError(null)}
                      className="text-rose-400 hover:text-rose-200 transition-colors"
                      title="Dismiss error"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <p className="text-rose-200/90 font-sans">{actionError}</p>
                </div>
              </div>
            )}

            <div className="flex items-center justify-end gap-3 pt-3 border-t border-[#1f2d44]">
              <button
                type="button"
                onClick={() => setBuyingListing(null)}
                className="px-4 py-2 rounded-xl text-slate-400 hover:text-white font-semibold text-xs transition-colors"
              >
                Back
              </button>

              <button
                type="button"
                onClick={handleBuyOption}
                disabled={
                  actionPending ||
                  !buyQuantity ||
                  parseInt(buyQuantity, 10) <= 0 ||
                  BigInt(parseInt(buyQuantity, 10)) > buyingListing.offeredAmount
                }
                className="px-5 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 text-slate-950 font-bold text-xs transition-colors flex items-center gap-2"
              >
                {actionPending ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Executing Buy...</span>
                  </>
                ) : (
                  <span>Confirm Purchase</span>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
