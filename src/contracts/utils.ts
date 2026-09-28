import {
  Address,
  Assets,
  LucidEvolution,
  OutRef,
  Unit,
  fromHex,
  fromUnit,
  getAddressDetails,
  toHex,
  toUnit,
  keyHashToCredential,
  scriptHashToCredential,
  credentialToAddress,
} from "@lucid-evolution/lucid";
import {
  AddressD,
  AssetClassD,
  OutputReferenceD,
  PartialOrderContainedFee,
  ValueD,
} from "./contract.types";

export function decimalToHexByte(decimal: number): string {
  const hex = decimal.toString(16);
  return hex.length === 1 ? `0${hex}` : hex;
}

export const expectedTokenName = async (outRef: OutRef): Promise<string> => {
  const stringToHash = `${decimalToHexByte(outRef.outputIndex)}${outRef.txHash}`;
  const bytes = fromHex(stringToHash);
  const hashBuffer = await crypto.subtle.digest("SHA-256", bytes.buffer as ArrayBuffer);
  const hashArray = new Uint8Array(hashBuffer);
  const hashHex = toHex(hashArray);
  return hashHex;
};

export function fromAddress(address: Address): AddressD {
  const { paymentCredential, stakeCredential } = getAddressDetails(address);

  if (!paymentCredential) throw new Error("Not a valid payment address.");

  return {
    paymentCredential:
      paymentCredential.type === "Key"
        ? {
            PublicKeyCredential: [paymentCredential.hash],
          }
        : { ScriptCredential: [paymentCredential.hash] },
    stakeCredential: stakeCredential
      ? {
          Inline: [
            stakeCredential.type === "Key"
              ? {
                  PublicKeyCredential: [stakeCredential.hash],
                }
              : { ScriptCredential: [stakeCredential.hash] },
          ],
        }
      : null,
  };
}

export function toAddress(address: AddressD, lucid: LucidEvolution): Address {
  const paymentCredential = (() => {
    if ("PublicKeyCredential" in address.paymentCredential) {
      return keyHashToCredential(
        address.paymentCredential.PublicKeyCredential[0]
      );
    } else {
      return scriptHashToCredential(
        address.paymentCredential.ScriptCredential[0]
      );
    }
  })();
  const stakeCredential = (() => {
    if (!address.stakeCredential) return undefined;
    if ("Inline" in address.stakeCredential) {
      if ("PublicKeyCredential" in address.stakeCredential.Inline[0]) {
        return keyHashToCredential(
          address.stakeCredential.Inline[0].PublicKeyCredential[0]
        );
      } else {
        return scriptHashToCredential(
          address.stakeCredential.Inline[0].ScriptCredential[0]
        );
      }
    } else {
      return undefined;
    }
  })();
  return credentialToAddress(
    lucid.config().network,
    paymentCredential,
    stakeCredential
  );
}

export function fromOutRef(outRef: OutRef): OutputReferenceD {
  return {
    txHash: { hash: outRef.txHash },
    outputIndex: BigInt(outRef.outputIndex),
  };
}

export function assetClassDFromUnit(unit: Unit): AssetClassD {
  if (unit === "lovelace" || unit === "") {
    return {
      symbol: "",
      name: "",
    };
  }
  const { policyId, assetName } = fromUnit(unit);
  return {
    symbol: policyId,
    name: assetName ?? "",
  };
}

export function assetClassDToUnit(ac: AssetClassD): Unit {
  if (ac.symbol === "" || !ac.symbol) return "lovelace";
  return toUnit(ac.symbol, ac.name);
}

export function resolveAC(unit: Unit, amt: bigint): Assets {
  if (unit === "" || unit === "lovelace") {
    return { lovelace: amt };
  } else {
    return { [unit]: amt };
  }
}

export function mappendAssets(a1: Assets, a2: Assets): Assets {
  const a2Entries = Object.entries(a2);
  const result: Assets = { ...a1 };

  a2Entries.forEach(([key, quantity]) => {
    if (result[key]) {
      result[key] += quantity;
    } else {
      result[key] = quantity;
    }
  });

  Object.entries(result).forEach(([key, value]) => {
    if (value === 0n) {
      delete result[key];
    }
  });
  return result;
}

export function negateAssets(assets: Assets): Assets {
  const result: Assets = {};
  for (const [unit, amount] of Object.entries(assets)) {
    result[unit] = -amount;
  }
  return result;
}

export const zeroContainedFee: PartialOrderContainedFee = {
  pocfLovelaces: 0n,
  pocfOfferedTokens: 0n,
  pocfAskedTokens: 0n,
};

export function isEqualContainedFee(
  fee1: PartialOrderContainedFee,
  fee2: PartialOrderContainedFee
): boolean {
  return (
    fee1.pocfLovelaces === fee2.pocfLovelaces &&
    fee1.pocfOfferedTokens === fee2.pocfOfferedTokens &&
    fee1.pocfAskedTokens === fee2.pocfAskedTokens
  );
}

export function addContainedFees(
  fee1: PartialOrderContainedFee,
  fee2: PartialOrderContainedFee
): PartialOrderContainedFee {
  return {
    pocfLovelaces: fee1.pocfLovelaces + fee2.pocfLovelaces,
    pocfOfferedTokens: fee1.pocfOfferedTokens + fee2.pocfOfferedTokens,
    pocfAskedTokens: fee1.pocfAskedTokens + fee2.pocfAskedTokens,
  };
}

export function fromAssets(assets: Assets): ValueD {
  const value = new Map<string, Map<string, bigint>>();
  if (assets.lovelace) value.set("", new Map([["", assets.lovelace]]));

  const units = Object.keys(assets);
  const policies = Array.from(
    new Set(
      units
        .filter((unit) => unit !== "lovelace")
        .map((unit) => unit.slice(0, 56))
    )
  );
  policies.sort().forEach((policyId) => {
    const policyUnits = units.filter((unit) => unit.slice(0, 56) === policyId);
    const assetsMap = new Map<string, bigint>();
    policyUnits.sort().forEach((unit) => {
      assetsMap.set(unit.slice(56), assets[unit] ?? 0n);
    });
    value.set(policyId, assetsMap);
  });
  return value;
}

export function toAssets(value: ValueD): Assets {
  const result: Assets = { lovelace: value.get("")?.get("") || BigInt(0) };

  for (const [policyId, assets] of value) {
    if (policyId === "") continue;
    for (const [assetName, amount] of assets) {
      result[policyId + assetName] = amount;
    }
  }
  return result;
}

export function maxBigint(a: bigint, b: bigint): bigint {
  return a > b ? a : b;
}

export function minBigint(a: bigint, b: bigint): bigint {
  return a < b ? a : b;
}

export const containedFeeToAssetsM = (
  containedFee: PartialOrderContainedFee,
  offerAC: AssetClassD,
  priceAC: AssetClassD
): Assets => {
  const assets: Assets = mappendAssets(
    mappendAssets(
      { lovelace: containedFee.pocfLovelaces },
      { [assetClassDToUnit(offerAC)]: containedFee.pocfOfferedTokens }
    ),
    { [assetClassDToUnit(priceAC)]: containedFee.pocfAskedTokens }
  );
  return assets;
};

export const containedFeeToAssets = (orderDatum: any): Assets => {
  return containedFeeToAssetsM(
    orderDatum.podContainedFee,
    orderDatum.podOfferedAsset,
    orderDatum.podAskedAsset
  );
};

export const partialOrderPrice = (
  orderDatum: any,
  amount: bigint
): Assets => {
  return {
    [assetClassDToUnit(orderDatum.podAskedAsset)]:
      (amount * orderDatum.podPrice.numerator +
        orderDatum.podPrice.denominator -
        1n) /
      orderDatum.podPrice.denominator,
  };
};

export const expectedPaymentWithDeposit = (
  poConstants: any,
  orderUTxOValue: Assets,
  orderDatum: any,
  isCompleteFill: boolean
): Assets => {
  const toSubtract = mappendAssets(
    mappendAssets(
      { [poConstants.mintPolicyId + orderDatum.podNFT]: 1n },
      { [assetClassDToUnit(orderDatum.podOfferedAsset)]: orderDatum.podOfferedAmount }
    ),
    containedFeeToAssets(orderDatum)
  );
  const toAdd = isCompleteFill
    ? partialOrderPrice(orderDatum, orderDatum.podOfferedAmount)
    : {};
  const toSend = mappendAssets(
    mappendAssets(orderUTxOValue, toAdd),
    negateAssets(toSubtract)
  );
  return toSend;
};

export function ensure<T>(
  argument: T | undefined | null,
  message: string = "This value was promised to be there."
): T {
  if (argument === undefined || argument === null) {
    throw new TypeError(message);
  }
  return argument;
}
