import {
  LucidEvolution,
  UTxO,
  validatorToAddress,
  paymentCredentialOf,
  fromHex,
} from "@lucid-evolution/lucid";
import {
  OPTIONS_SCRIPTS,
  OPTIONS_SCRIPTS_V1,
  OPTIONS_SCRIPTS_V2,
  ALL_OPTION_SCRIPTS,
  getOptionScriptsForUtxo,
  OPTIONS_NFT_POLICY_HASH,
  OPTIONS_VALIDATOR_HASH,
  OPTION_MIN_ADA,
  ADA_OPTION_ASSET,
  OptionDatum,
  OptionAsset,
  Rational,
  OptionStyle,
  decodeOptionDatum,
  isAdaAsset,
  assetToUnit,
  createOption,
  executeOption,
  cancelEarlyOption,
  retrieveOption,
  CreateOptionParams,
  calculateRequiredPayment,
} from "../contracts/options";
import { getDefaultTokens, DEX_CONSTANTS } from "../config/dex";
import { KNOWN_REWARD_TOKENS } from "./rewards";
import { NetworkType, FetchProgress, TokenInfo, TradingPair, DexOrder } from "../types";
import { runWithConcurrency } from "./staking";
import { fetchAllActiveParsedOrders, ParsedOnChainOrder } from "./orderbook";

export interface OptionPosition {
  utxoRef: {
    txHash: string;
    outputIndex: number;
  };
  datum: OptionDatum;
  optionUnit: string;
  nftUnit: string;
  tokenNameHex: string;
  tokenNameDisplay: string;
  depositUnit: string;
  depositSymbol: string;
  depositDecimals: number;
  paymentUnit: string;
  paymentSymbol: string;
  paymentDecimals: number;
  totalMinted: bigint;
  remainingDeposit: bigint;
  strikePriceRational: Rational;
  strikePriceNumber: number; // Quote units per 1 Base unit
  strikePriceDisplay: string;
  startTimeMs: number;
  expirationTimeMs: number;
  cancelCutoffMs: number;
  style: OptionStyle; // "American" | "European"
  isExercisable: boolean;
  isExpired: boolean;
  canCancelEarly: boolean;
  isUserWriter: boolean;
  userOptionBalance: bigint; // How many option tokens the connected user holds
  userUnsoldBalance: bigint; // How many unsold option tokens the writer still holds
  accumulatedStrikePayment: bigint; // Total payment tokens collected in script from prior exercises
  sellerPkh: string;
  rawDatumHex?: string;
  utxo: UTxO;
  listing?: OptionMarketListing;
}

const SPENT_OPTIONS_KEY = "genius_zero_spent_options";

function getStoredSpentOptions(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = sessionStorage.getItem(SPENT_OPTIONS_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}

export function addStoredSpentOption(ref: string) {
  if (typeof window === "undefined") return;
  try {
    const set = getStoredSpentOptions();
    set.add(ref);
    sessionStorage.setItem(SPENT_OPTIONS_KEY, JSON.stringify(Array.from(set)));
  } catch {}
}

export function resolveTokenMeta(
  asset: OptionAsset,
  network: NetworkType
): { symbol: string; decimals: number } {
  if (isAdaAsset(asset)) {
    return {
      symbol: network === "mainnet" ? "ADA" : "tADA",
      decimals: 6,
    };
  }

  const unit = assetToUnit(asset);
  const rawUnit = unit.replace(".", "");
  const knownTokens = getDefaultTokens(network);
  const found = knownTokens.find((t) => t.unit.toLowerCase() === rawUnit.toLowerCase());
  if (found) {
    return {
      symbol: found.symbol,
      decimals: found.decimals,
    };
  }

  if (network === "mainnet") {
    const known = KNOWN_REWARD_TOKENS[rawUnit] || KNOWN_REWARD_TOKENS[unit];
    if (known) {
      return {
        symbol: known.ticker,
        decimals: known.decimals,
      };
    }
  }

  // Try ASCII decoding of asset name (stripping CIP-68 prefix if present)
  try {
    if (asset.assetName) {
      let cleanHex = asset.assetName;
      if (/^00(0643b0|0de140|14df10|1bc280)/i.test(cleanHex) && cleanHex.length > 8) {
        cleanHex = cleanHex.slice(8);
      }
      const bytes = fromHex(cleanHex);
      const ascii = new TextDecoder().decode(bytes);
      if (/^[a-zA-Z0-9_-]{1,16}$/.test(ascii)) {
        return { symbol: ascii, decimals: 0 };
      }
    }
  } catch {}

  // Fallback to truncated hex
  const shortName = asset.assetName
    ? asset.assetName.slice(0, 8)
    : asset.policyId.slice(0, 8);
  return { symbol: shortName.toUpperCase(), decimals: 0 };
}

/**
 * Fetches all active on-chain option positions from the Option Spending Validator script.
 */
export async function fetchActiveOptions(
  lucid: LucidEvolution,
  network: NetworkType,
  userAddress?: string | null,
  userTokenBalances: Record<string, bigint> = {},
  onProgress?: (progress: FetchProgress) => void,
  shouldAbort?: () => boolean,
  userPkhs?: string[] | null
): Promise<OptionPosition[]> {
  const net = network === "mainnet" ? "Mainnet" : "Preprod";
  const addressesToQuery: string[] = [];
  for (const scriptSet of ALL_OPTION_SCRIPTS) {
    try {
      const addr = validatorToAddress(net, scriptSet.validator);
      if (!addressesToQuery.includes(addr)) {
        addressesToQuery.push(addr);
      }
    } catch {}
  }

  onProgress?.({
    current: 0,
    total: 1,
    stage: "Querying on-chain option script UTxOs...",
    itemType: "UTxOs",
  });

  if (network === "preprod") {
    const fallbacks = [
      "addr_test1wpc3xdajp73gev3er7qun50uxgl35clavhn5jadk400j8cq2kfttu",
      "addr_test1wq5mmd7zh5rgr4su6kwq4w7996efyzyuzlh2vejhkytuhegvjdjzm",
    ];
    for (const fb of fallbacks) {
      if (!addressesToQuery.includes(fb)) {
        addressesToQuery.push(fb);
      }
    }
  }

  const utxoArrays = await Promise.all(
    addressesToQuery.map((addr) => lucid.utxosAt(addr).catch(() => []))
  );
  const allUtxos = utxoArrays.flat();
  if (shouldAbort && shouldAbort()) return [];

  const spentSet = getStoredSpentOptions();
  const knownNftHashes = ALL_OPTION_SCRIPTS.map((s) => s.nftPolicy.hash);

  // Filter for option UTxOs carrying the position tracking NFT
  const optionUtxos = allUtxos.filter((u) => {
    const key = `${u.txHash}#${u.outputIndex}`;
    if (spentSet.has(key)) return false;
    if (!u.datum) return false;
    return Object.keys(u.assets).some((unit) =>
      knownNftHashes.some((h) => unit.startsWith(h))
    );
  });

  onProgress?.({
    current: 0,
    total: optionUtxos.length,
    stage: `Parsing ${optionUtxos.length} option contracts...`,
    itemType: "Options",
  });

  const userPkhSet = new Set<string>();
  if (userAddress) {
    try {
      userPkhSet.add(paymentCredentialOf(userAddress).hash.toLowerCase());
    } catch {}
  }
  if (userPkhs && Array.isArray(userPkhs)) {
    for (const p of userPkhs) {
      if (p) userPkhSet.add(p.toLowerCase());
    }
  }

  const now = Date.now();

  const parsed = await runWithConcurrency(
    optionUtxos,
    8,
    async (utxo) => {
      try {
        const datum = decodeOptionDatum(utxo.datum!);
        const scripts = getOptionScriptsForUtxo(utxo, datum);
        const optionUnit = datum.opdToken.policyId + datum.opdToken.assetName;
        const nftUnit = scripts.nftPolicy.hash + datum.opdToken.assetName;

        const depMeta = resolveTokenMeta(datum.opdDeposit, network);
        const payMeta = resolveTokenMeta(datum.opdPayment, network);

        const depUnit = assetToUnit(datum.opdDeposit);
        const payUnit = assetToUnit(datum.opdPayment);

        // Remaining deposit tokens in script
        let remainingDeposit: bigint;
        if (isAdaAsset(datum.opdDeposit)) {
          remainingDeposit = (utxo.assets["lovelace"] || 0n) - OPTION_MIN_ADA;
          if (remainingDeposit < 0n) remainingDeposit = 0n;
        } else {
          remainingDeposit = utxo.assets[depUnit] || 0n;
        }

        // Accumulated strike payments in script
        let accumulatedStrikePayment: bigint;
        if (isAdaAsset(datum.opdPayment)) {
          // Subtract the minAda deposit if deposit was not ADA, or consider excess lovelace
          if (isAdaAsset(datum.opdDeposit)) {
            accumulatedStrikePayment = 0n; // Shared lovelace
          } else {
            accumulatedStrikePayment = (utxo.assets["lovelace"] || 0n) - OPTION_MIN_ADA;
            if (accumulatedStrikePayment < 0n) accumulatedStrikePayment = 0n;
          }
        } else {
          accumulatedStrikePayment = utxo.assets[payUnit] || 0n;
        }

        // Strike price number
        const num = Number(datum.opdPrice.numerator);
        const den = Number(datum.opdPrice.denominator);
        const strikePriceRaw = den > 0 ? num / den : 0;
        // Adjust for decimals difference: (Payment / 10^payDec) / (Deposit / 10^depDec)
        const decimalAdjustment = Math.pow(10, depMeta.decimals - payMeta.decimals);
        const strikePriceNumber = strikePriceRaw * decimalAdjustment;

        const strikePriceDisplay = `${strikePriceNumber.toLocaleString(undefined, {
          maximumFractionDigits: 6,
        })} ${payMeta.symbol} / ${depMeta.symbol}`;

        const startTimeMs = Number(datum.opdStart);
        const expirationTimeMs = Number(datum.opdEnd);
        const cancelCutoffMs = Number(datum.opdCancelCutoff);
        // Determine style:
        // - European: exercise window is the final 24h before expiration (within small slot tolerance)
        // - Custom: start time is in the future (delayed exercise opening)
        // - American: exercisable immediately from minting until expiration
        let style: OptionStyle = "American";
        const windowDurationMs = expirationTimeMs - startTimeMs;
        if (Math.abs(windowDurationMs - 86_400_000) <= 120_000) {
          style = "European";
        } else if (startTimeMs > now) {
          style = "Custom";
        } else {
          style = "American";
        }

        const isExercisable = now >= startTimeMs && now <= expirationTimeMs && remainingDeposit > 0n;
        const isExpired = now > expirationTimeMs;
        const canCancelEarly = now < cancelCutoffMs && remainingDeposit > 0n;
        const isUserWriter = userPkhSet.has(datum.opdSellerKey.toLowerCase());

        const userOptionBalance = userTokenBalances[optionUnit] || 0n;
        const userUnsoldBalance = isUserWriter ? userOptionBalance : 0n;

        // Display name for option token
        const tokenNameHex = datum.opdToken.assetName;
        const tokenNameDisplay = `OPT-${depMeta.symbol}-${payMeta.symbol}-${tokenNameHex.slice(0, 6)}`;

        const position: OptionPosition = {
          utxoRef: {
            txHash: utxo.txHash,
            outputIndex: utxo.outputIndex,
          },
          datum,
          optionUnit,
          nftUnit,
          tokenNameHex,
          tokenNameDisplay,
          depositUnit: depUnit,
          depositSymbol: depMeta.symbol,
          depositDecimals: depMeta.decimals,
          paymentUnit: payUnit,
          paymentSymbol: payMeta.symbol,
          paymentDecimals: payMeta.decimals,
          totalMinted: remainingDeposit, // Initial deposit at minimum remaining
          remainingDeposit,
          strikePriceRational: datum.opdPrice,
          strikePriceNumber,
          strikePriceDisplay,
          startTimeMs,
          expirationTimeMs,
          cancelCutoffMs,
          style,
          isExercisable,
          isExpired,
          canCancelEarly,
          isUserWriter,
          userOptionBalance,
          userUnsoldBalance,
          accumulatedStrikePayment,
          sellerPkh: datum.opdSellerKey,
          rawDatumHex: utxo.datum ?? undefined,
          utxo,
        };

        return position;
      } catch (e) {
        console.warn("Error decoding option UTxO:", utxo.txHash, e);
        return undefined;
      }
    },
    (curr, tot) => {
      onProgress?.({
        current: curr,
        total: tot,
        stage: `Parsed ${curr} of ${tot} options...`,
        itemType: "Options",
      });
    },
    shouldAbort
  );

  const validPositions = parsed.filter((p): p is OptionPosition => p !== undefined);

  return validPositions.sort((a, b) => {
    // Sort active first, then closest expiration
    if (a.isExpired !== b.isExpired) return a.isExpired ? 1 : -1;
    return a.expirationTimeMs - b.expirationTimeMs;
  });
}

/**
 * Creates a synthetic DEX TradingPair for trading an Option token on the Genius Yield orderbook.
 * Defaults to ADA/tADA as the quote currency, but allows any quote asset to be selected.
 */
export function createOptionTradingPair(
  position: OptionPosition,
  network: NetworkType,
  quoteAssetUnit?: string
): TradingPair {
  const baseToken: TokenInfo = {
    unit: position.optionUnit,
    policyId: position.datum.opdToken.policyId,
    assetName: position.datum.opdToken.assetName,
    symbol: position.tokenNameDisplay,
    name: `${position.style} Option (${position.depositSymbol} @ ${position.strikePriceDisplay})`,
    decimals: 0,
  };

  const defaultAda: TokenInfo = {
    unit: "lovelace",
    policyId: "",
    assetName: "",
    symbol: network === "mainnet" ? "ADA" : "tADA",
    name: network === "mainnet" ? "Cardano" : "Testnet ADA",
    decimals: 6,
  };

  let quoteToken: TokenInfo = defaultAda;

  if (quoteAssetUnit && quoteAssetUnit !== "lovelace") {
    const knownTokens = getDefaultTokens(network);
    const found = knownTokens.find((t) => t.unit.toLowerCase() === quoteAssetUnit.toLowerCase());
    if (found) {
      quoteToken = found;
    } else {
      let symbol = "TOKEN";
      if (quoteAssetUnit.length > 56) {
        try {
          const hex = quoteAssetUnit.slice(56);
          const str = new TextDecoder().decode(fromHex(hex));
          if (/^[\x20-\x7E]+$/.test(str)) {
            symbol = str;
          }
        } catch {}
      }
      quoteToken = {
        unit: quoteAssetUnit,
        policyId: quoteAssetUnit.length >= 56 ? quoteAssetUnit.slice(0, 56) : "",
        assetName: quoteAssetUnit.length >= 56 ? quoteAssetUnit.slice(56) : "",
        symbol,
        name: symbol !== "TOKEN" ? symbol : "Custom Token",
        decimals: 0,
      };
    }
  }

  return {
    id: `${baseToken.symbol}-${quoteToken.symbol}`,
    baseToken,
    quoteToken,
  };
}

export interface OptionMarketListing {
  order: DexOrder;
  rawOrder: ParsedOnChainOrder;
  optionUnit: string;
  offeredAmount: bigint; // quantity of option tokens for sale
  askedUnit: string; // unit of quote asset (e.g. "lovelace")
  quoteSymbol: string; // e.g. "tADA"
  quoteName: string;
  quoteDecimals: number;
  pricePerOption: number; // in quote units
  totalCost: number; // offeredAmount * pricePerOption
  sellerAddress: string;
  sellerKey: string;
  isUserSeller: boolean;
  orderType: "sell" | "buy";
  matchingPosition?: OptionPosition;
}

/**
 * Indexes active Genius Yield DEX limit orders that offer option tokens for sale,
 * matching them against known option positions and connecting buyer/seller context.
 */
export async function fetchOptionMarketListings(
  lucid: LucidEvolution,
  network: NetworkType,
  knownPositions: OptionPosition[] = [],
  userPkhs: string[] = []
): Promise<OptionMarketListing[]> {
  const allOrders = await fetchAllActiveParsedOrders(lucid, network);
  const now = Date.now();
  const knownTokens = getDefaultTokens(network);

  const posByOptionUnit = new Map<string, OptionPosition>();
  for (const pos of knownPositions) {
    posByOptionUnit.set(pos.optionUnit.toLowerCase(), pos);
  }

  const knownOptionPolicies = new Set(
    ALL_OPTION_SCRIPTS.map((s) => s.nftPolicy.hash.toLowerCase())
  );

  const lowerUserPkhs = new Set(userPkhs.map((p) => p.toLowerCase()));
  const listings: OptionMarketListing[] = [];

  for (const rawOrder of allOrders) {
    if (rawOrder.end && Number(rawOrder.end) <= now) continue;
    if (rawOrder.start && Number(rawOrder.start) > now) continue;

    const offeredLower = rawOrder.offeredAsset.toLowerCase();
    const offeredPolicy = offeredLower.length >= 56 ? offeredLower.slice(0, 56) : "";

    const isOptionOffered =
      posByOptionUnit.has(offeredLower) || knownOptionPolicies.has(offeredPolicy);

    if (!isOptionOffered) continue;

    const matchingPos = posByOptionUnit.get(offeredLower);
    const isAda = rawOrder.askedAsset === "lovelace" || rawOrder.askedAsset === "";
    const quoteToken = isAda
      ? {
          unit: "lovelace",
          symbol: network === "mainnet" ? "ADA" : "tADA",
          name: network === "mainnet" ? "Cardano" : "Testnet ADA",
          decimals: 6,
        }
      : knownTokens.find((t) => t.unit.toLowerCase() === rawOrder.askedAsset.toLowerCase()) || {
          unit: rawOrder.askedAsset,
          symbol: "TOKEN",
          name: "Custom Token",
          decimals: 0,
        };

    const num = Number(rawOrder.price.numerator);
    const den = Number(rawOrder.price.denominator);
    if (den === 0 || num === 0) continue;

    // In Genius Yield order: price is (asked_raw / offered_raw)
    // Since option tokens have 0 decimals, rawRatio = num / den (quote raw units per 1 option)
    const rawRatio = num / den;
    const pricePerOption = rawRatio / Math.pow(10, quoteToken.decimals);
    const offeredAmount = rawOrder.offeredAmount;
    const totalCost = Number(offeredAmount) * pricePerOption;

    const isUserSeller = lowerUserPkhs.has(rawOrder.ownerKey.toLowerCase());

    const dexOrder: DexOrder = {
      utxoRef: rawOrder.utxoRef,
      ownerAddress: rawOrder.ownerAddress,
      ownerKey: rawOrder.ownerKey,
      offeredAsset: rawOrder.offeredAsset,
      offeredAmount: rawOrder.offeredAmount,
      offeredOriginalAmount: rawOrder.offeredOriginalAmount,
      askedAsset: rawOrder.askedAsset,
      price: rawOrder.price,
      effectivePrice: pricePerOption,
      orderType: "ask",
      nftUnit: rawOrder.nftUnit,
      depositLovelace: rawOrder.depositLovelace,
      partialFills: rawOrder.partialFills,
      start: rawOrder.start,
      end: rawOrder.end,
      isUserOrder: isUserSeller,
    };

    const listing: OptionMarketListing = {
      order: dexOrder,
      rawOrder,
      optionUnit: rawOrder.offeredAsset,
      offeredAmount,
      askedUnit: rawOrder.askedAsset,
      quoteSymbol: quoteToken.symbol,
      quoteName: quoteToken.name,
      quoteDecimals: quoteToken.decimals,
      pricePerOption,
      totalCost,
      sellerAddress: rawOrder.ownerAddress,
      sellerKey: rawOrder.ownerKey,
      isUserSeller,
      orderType: "sell",
      matchingPosition: matchingPos,
    };

    listings.push(listing);

    // If there is a matching position, link the listing to the position
    if (matchingPos) {
      matchingPos.listing = listing;
    }
  }

  return listings.sort((a, b) => a.pricePerOption - b.pricePerOption);
}

export interface FormattedDateTimeDual {
  localDate: string;
  localTime: string;
  localFull: string;
  localTimezone: string;
  utcDate: string;
  utcTime: string;
  utcFull: string;
  relative: string;
}

export function formatDateTimeDual(timestampMs: number): FormattedDateTimeDual {
  if (!timestampMs || isNaN(timestampMs)) {
    return {
      localDate: "-",
      localTime: "-",
      localFull: "-",
      localTimezone: "",
      utcDate: "-",
      utcTime: "-",
      utcFull: "-",
      relative: "-",
    };
  }

  const d = new Date(timestampMs);

  const localDate = d.toLocaleDateString(undefined, {
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
  });

  const localTime = d.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  const tzName =
    Intl.DateTimeFormat(undefined, { timeZoneName: "short" })
      .formatToParts(d)
      .find((p) => p.type === "timeZoneName")?.value || "";

  const pad = (n: number) => n.toString().padStart(2, "0");
  const utcMonths = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const utcDays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const utcDate = `${utcDays[d.getUTCDay()]}, ${d.getUTCDate()} ${utcMonths[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
  const utcTime = `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} UTC`;

  const diffMs = timestampMs - Date.now();
  let relative = "";
  if (diffMs > 0) {
    const days = Math.floor(diffMs / 86_400_000);
    const hours = Math.floor((diffMs % 86_400_000) / 3_600_000);
    const mins = Math.floor((diffMs % 3_600_000) / 60_000);
    if (days > 0) relative = `in ${days}d ${hours}h`;
    else if (hours > 0) relative = `in ${hours}h ${mins}m`;
    else relative = `in ${mins}m`;
  } else {
    relative = "expired";
  }

  return {
    localDate,
    localTime,
    localFull: `${localDate} ${localTime} (${tzName})`,
    localTimezone: tzName,
    utcDate,
    utcTime,
    utcFull: `${utcDate} ${utcTime}`,
    relative,
  };
}

/**
 * Calculates the 0.3% maker fee required in the offered asset by the Genius Yield DEX smart contract.
 * Maker fee ratio: 3 / 1000 (0.3%).
 */
export function calculateMakerFeeTokens(quantity: bigint): bigint {
  if (quantity <= 0n) return 0n;
  return (quantity * 3n) / 1000n;
}

/**
 * Calculates the total tokens required from the seller's wallet to list an option on the DEX:
 * Total = Quantity to Sell + 0.3% Maker Fee
 */
export function calculateTotalRequiredTokens(quantity: bigint): bigint {
  return quantity + calculateMakerFeeTokens(quantity);
}

/**
 * Calculates the maximum quantity of options a user can list on the DEX given their wallet balance,
 * accounting for the 0.3% maker fee in option tokens that must be locked in the DEX order.
 */
export function calculateMaxSellableOptions(walletBalance: bigint): bigint {
  if (walletBalance <= 0n) return 0n;
  let q = (walletBalance * 1000n) / 1003n;
  while (true) {
    const nextQ = q + 1n;
    const nextFee = (nextQ * 3n) / 1000n;
    if (nextQ + nextFee <= walletBalance) {
      q = nextQ;
    } else {
      break;
    }
  }
  return q;
}

/**
 * Translates low-level Lucid / Cardano Multiplatform Lib / Blockfrost errors
 * into clear, human-readable, well-formatted explanations.
 */
export function formatFriendlyError(
  raw: any,
  context: { tokenName?: string; tokenMap?: Record<string, string> } = {}
): string {
  if (!raw) return "An unexpected error occurred.";
  const msg = typeof raw === "string" ? raw : raw?.message || JSON.stringify(raw);

  // 1. Insufficient funds / coin selection
  if (msg.includes("Your wallet does not have enough funds to cover the required assets")) {
    const match = msg.match(/required assets:\s*\{([^}]+)\}/);
    if (match && match[1]) {
      const entries = match[1].split(",").map((s: string) => s.trim());
      const missing: string[] = [];
      for (const entry of entries) {
        const parts = entry.split(":").map((s: string) => s.trim().replace(/^["']|["']$/g, ""));
        if (parts.length === 2) {
          const [unit, amtRaw] = parts;
          const cleanAmt = amtRaw.replace(/n$/, "");
          try {
            const big = BigInt(cleanAmt);
            if (unit === "lovelace") {
              const ada = Number(big) / 1_000_000;
              missing.push(`${ada.toLocaleString(undefined, { maximumFractionDigits: 6 })} ADA`);
            } else {
              const name =
                context.tokenName ||
                (context.tokenMap && context.tokenMap[unit]) ||
                "Option token(s)";
              missing.push(`${big.toLocaleString()} ${name}`);
            }
          } catch {
            missing.push(`${cleanAmt} ${unit}`);
          }
        }
      }
      if (missing.length > 0) {
        return `Insufficient funds: Your wallet needs an additional ${missing.join(
          ", "
        )} to cover this order and required fees. If you are selling options, remember the DEX protocol requires a 0.3% maker fee in option tokens deposited into the order.`;
      }
    }
    return "Your wallet does not have enough funds to cover this order and required deposits/fees.";
  }

  // 2. User cancellation / rejected signature
  if (
    msg.toLowerCase().includes("user declined") ||
    msg.toLowerCase().includes("user rejected") ||
    msg.toLowerCase().includes("user cancelled") ||
    msg.toLowerCase().includes("cancelled by user")
  ) {
    return "Transaction signing was cancelled in your wallet.";
  }

  // 3. Blockfrost Rate Limiting / 429
  if (msg.includes("429") || msg.toLowerCase().includes("rate limit")) {
    return "Blockfrost API rate limit exceeded. Please wait a few moments and try again.";
  }

  // 4. Blockfrost 402 / Over Limit
  if (msg.includes("402") || msg.toLowerCase().includes("over limit")) {
    return "Blockfrost project daily request limit reached. Please update your API key in Settings.";
  }

  // 5. UTxO Contention / Input missing
  if (
    msg.includes("missing from UTxO set") ||
    msg.includes("BadInputsUTxO") ||
    msg.includes("ValueNotConservedUTxO")
  ) {
    return "A required UTxO was recently spent or is still confirming on-chain. Please wait ~20 seconds and refresh.";
  }

  // 6. Max Tx size or ExUnits exceeded
  if (msg.includes("MaxTxSizeUTxO") || msg.includes("ExUnitsTooBigUTxO")) {
    return "Transaction execution units or size exceeded Cardano limits.";
  }

  // 7. General cleanup of raw JSON or Error prefix
  let cleaned = msg.replace(/^\{.*"message":\s*"([^"]+)".*\}$/, "$1");
  cleaned = cleaned.replace(/^Error:\s*/i, "");
  cleaned = cleaned.replace(/\s*Or it contains UTxOs with reference scripts;.*$/i, "");
  return cleaned.trim() || "An unexpected error occurred.";
}

