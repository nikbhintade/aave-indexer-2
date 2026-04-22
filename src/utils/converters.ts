import { BigDecimal } from "generated";
import { ZERO_BI, ZERO_BD } from "./constants";

export const BORROW_MODE_STABLE = "Stable";
export const BORROW_MODE_VARIABLE = "Variable";
export const BORROW_MODE_NONE = "None";

export const PRICE_ORACLE_ASSET_TYPE_SIMPLE = "Simple";
export const PRICE_ORACLE_ASSET_TYPE_COMPOSITE = "Composite";

export const PRICE_ORACLE_ASSET_PLATFORM_SIMPLE = "Simple";
export const PRICE_ORACLE_ASSET_PLATFORM_UNISWAP = "Uniswap";

export function exponentToBigDecimal(decimals: number): BigDecimal {
  return new BigDecimal(10n ** BigInt(decimals));
}

export function exponentToBigInt(decimals: number): bigint {
  return 10n ** BigInt(decimals);
}

export function convertTokenAmountToDecimals(
  amount: bigint,
  decimals: number
): BigDecimal {
  return new BigDecimal(amount).div(exponentToBigDecimal(decimals));
}

export function convertValueFromRay(value: bigint): BigDecimal {
  return convertTokenAmountToDecimals(value, 27);
}

export function format18(price: bigint): bigint {
  if (price === ZERO_BI) return price;
  return exponentToBigInt(18) / price;
}

export function formatUsdEthChainlinkPrice(price: bigint): bigint {
  if (price === ZERO_BI) return price;
  return exponentToBigInt(18 + 8) / price;
}

export function getBorrowRateMode(mode: bigint): string {
  const m = Number(mode);
  if (m === 0) return BORROW_MODE_NONE;
  if (m === 1) return BORROW_MODE_STABLE;
  if (m === 2) return BORROW_MODE_VARIABLE;
  throw new Error(`invalid borrow rate mode: ${m}`);
}

export function getBorrowRateModeFromString(mode: string): bigint {
  if (mode === BORROW_MODE_NONE) return ZERO_BI;
  if (mode === BORROW_MODE_STABLE) return 1n;
  if (mode === BORROW_MODE_VARIABLE) return 2n;
  throw new Error(`invalid borrow rate mode: ${mode}`);
}

export function getPriceOracleAssetType(type: bigint): string {
  const t = Number(type);
  if (t === 1) return PRICE_ORACLE_ASSET_TYPE_SIMPLE;
  if (t === 2) return PRICE_ORACLE_ASSET_TYPE_COMPOSITE;
  throw new Error(`invalid price oracle asset type: ${t}`);
}

export function getPriceOracleAssetPlatform(type: bigint): string {
  const t = Number(type);
  if (t === 1) return PRICE_ORACLE_ASSET_PLATFORM_SIMPLE;
  if (t === 2) return PRICE_ORACLE_ASSET_PLATFORM_UNISWAP;
  return PRICE_ORACLE_ASSET_PLATFORM_SIMPLE;
}

// Returns the block at which the given chain's market was updated to v3.0.1
// (affects BalanceTransfer event interpretation)
export function getUpdateBlock(chainId: number): number {
  const updateBlocks: Record<number, number> = {
    10: 775471,    // Optimism
    137: 42535602, // Polygon
    42161: 89267099, // Arbitrum
    43114: 29829396, // Avalanche
  };
  return updateBlocks[chainId] ?? 0;
}

export function zeroBI(): bigint {
  return ZERO_BI;
}

export function zeroBD(): BigDecimal {
  return ZERO_BD;
}
