import type {
  HandlerContext,
  Entity,
  Protocol,
  User,
  UserReserve,
  PriceOracle,
  PriceOracleAsset,
  ContractToPoolMapping,
  SubToken,
  ReserveParamsHistoryItem,
  ReserveConfigurationHistoryItem,
  Referrer,
  Reserve,
} from "generated";

// Names that collide with contract handler values — use Entity<"Name"> form
type Pool = Entity<"Pool">;
type ChainlinkAggregator = Entity<"ChainlinkAggregator">;
import { ZERO_ADDRESS, ZERO_BI, ZERO_BD } from "../../utils/constants";
import {
  getReserveId,
  getUserReserveId,
  getSubTokenId,
} from "../../utils/id-generation";
import {
  PRICE_ORACLE_ASSET_TYPE_SIMPLE,
  PRICE_ORACLE_ASSET_PLATFORM_SIMPLE,
} from "../../utils/converters";

// ─── bytes32 helper ─────────────────────────────────────────────────────────

export function bytes32ToString(hex: string): string {
  const h = hex.startsWith("0x") ? hex.slice(2) : hex;
  let result = "";
  for (let i = 0; i < h.length; i += 2) {
    const byte = parseInt(h.slice(i, i + 2), 16);
    if (byte === 0) break;
    result += String.fromCharCode(byte);
  }
  return result;
}

// ─── Protocol ────────────────────────────────────────────────────────────────

export async function getProtocol(
  chainId: number,
  context: HandlerContext
): Promise<Protocol> {
  const id = `${chainId}-1`;
  const existing = await context.Protocol.get(id);
  if (existing) return existing;
  const protocol: Protocol = { id };
  context.Protocol.set(protocol);
  return protocol;
}

// ─── ContractToPoolMapping ────────────────────────────────────────────────────

export function getContractMappingId(
  chainId: number,
  contractAddress: string
): string {
  return `${chainId}-${contractAddress.toLowerCase()}`;
}

export async function getPoolByContract(
  chainId: number,
  contractAddress: string,
  context: HandlerContext
): Promise<string> {
  const id = getContractMappingId(chainId, contractAddress);
  const mapping = await context.ContractToPoolMapping.get(id);
  if (!mapping) {
    throw new Error(`${contractAddress} not in ContractToPoolMapping (chain ${chainId})`);
  }
  return mapping.pool_id;
}

export async function createMapContractToPool(
  chainId: number,
  contractAddress: string,
  poolId: string,
  context: HandlerContext
): Promise<void> {
  const id = getContractMappingId(chainId, contractAddress);
  const existing = await context.ContractToPoolMapping.get(id);
  if (existing) return;
  const mapping: ContractToPoolMapping = {
    id,
    pool_id: poolId,
  };
  context.ContractToPoolMapping.set(mapping);
}

// ─── User ────────────────────────────────────────────────────────────────────

export async function getOrInitUser(
  userAddress: string,
  chainId: number,
  context: HandlerContext
): Promise<User> {
  const id = `${chainId}-${userAddress.toLowerCase()}`;
  const existing = await context.User.get(id);
  if (existing) return existing;
  const user: User = {
    id,
    borrowedReservesCount: 0,
    unclaimedRewards: ZERO_BI,
    lifetimeRewards: ZERO_BI,
    rewardsLastUpdated: 0,
    eModeCategoryId_id: undefined,
  };
  context.User.set(user);
  return user;
}

// ─── UserReserve ──────────────────────────────────────────────────────────────

export async function getOrInitUserReserve(
  userAddress: string,
  underlyingAsset: string,
  poolId: string,
  chainId: number,
  context: HandlerContext
): Promise<UserReserve> {
  const reserveId = getReserveId(underlyingAsset, poolId, chainId);
  const id = getUserReserveId(userAddress, underlyingAsset, poolId, chainId);
  const existing = await context.UserReserve.get(id);
  if (existing) return existing;

  const user = await getOrInitUser(userAddress, chainId, context);

  const userReserve: UserReserve = {
    id,
    pool_id: poolId,
    reserve_id: reserveId,
    user_id: user.id,
    usageAsCollateralEnabledOnUser: false,
    scaledATokenBalance: ZERO_BI,
    currentATokenBalance: ZERO_BI,
    scaledVariableDebt: ZERO_BI,
    currentVariableDebt: ZERO_BI,
    principalStableDebt: ZERO_BI,
    currentStableDebt: ZERO_BI,
    currentTotalDebt: ZERO_BI,
    stableBorrowRate: ZERO_BI,
    oldStableBorrowRate: ZERO_BI,
    liquidityRate: ZERO_BI,
    stableBorrowLastUpdateTimestamp: 0,
    variableBorrowIndex: ZERO_BI,
    lastUpdateTimestamp: 0,
    aTokenincentivesUserIndex: undefined,
    vTokenincentivesUserIndex: undefined,
    sTokenincentivesUserIndex: undefined,
    aIncentivesLastUpdateTimestamp: undefined,
    vIncentivesLastUpdateTimestamp: undefined,
    sIncentivesLastUpdateTimestamp: undefined,
  };
  context.UserReserve.set(userReserve);
  return userReserve;
}

// ─── PriceOracle ─────────────────────────────────────────────────────────────

// Per-chain default oracle used as placeholder before real oracle is configured
export async function getOrInitDefaultPriceOracle(
  chainId: number,
  context: HandlerContext
): Promise<PriceOracle> {
  return getOrInitPriceOracle(`${chainId}-0`, chainId, context);
}

export async function getOrInitPriceOracle(
  oracleAddress: string,
  chainId: number,
  context: HandlerContext
): Promise<PriceOracle> {
  const id = `${chainId}-${oracleAddress.toLowerCase()}`;
  const existing = await context.PriceOracle.get(id);
  if (existing) return existing;
  const oracle: PriceOracle = {
    id,
    proxyPriceProvider: ZERO_ADDRESS,
    usdPriceEth: ZERO_BI,
    usdPriceEthMainSource: ZERO_ADDRESS,
    usdPriceEthFallbackRequired: false,
    fallbackPriceOracle: ZERO_ADDRESS,
    lastUpdateTimestamp: 0,
    version: 3,
    baseCurrency: ZERO_ADDRESS,
    baseCurrencyUnit: ZERO_BI,
  };
  context.PriceOracle.set(oracle);
  return oracle;
}

// ─── PriceOracleAsset ─────────────────────────────────────────────────────────

export async function getPriceOracleAsset(
  assetAddress: string,
  oracleId: string,
  chainId: number,
  context: HandlerContext
): Promise<PriceOracleAsset> {
  const id = `${chainId}-${assetAddress.toLowerCase()}`;
  const existing = await context.PriceOracleAsset.get(id);
  if (existing) return existing;
  const asset: PriceOracleAsset = {
    id,
    oracle_id: oracleId,
    priceSource: ZERO_ADDRESS,
    type: PRICE_ORACLE_ASSET_TYPE_SIMPLE,
    platform: PRICE_ORACLE_ASSET_PLATFORM_SIMPLE,
    priceInEth: ZERO_BI,
    isFallbackRequired: false,
    lastUpdateTimestamp: 0,
    fromChainlinkSourcesRegistry: false,
  };
  context.PriceOracleAsset.set(asset);
  return asset;
}

// ─── Reserve ─────────────────────────────────────────────────────────────────

export async function getOrInitReserve(
  underlyingAsset: string,
  poolId: string,
  chainId: number,
  context: HandlerContext
): Promise<Reserve> {
  const id = getReserveId(underlyingAsset, poolId, chainId);
  const existing = await context.Reserve.get(id);
  if (existing) return existing;

  // Ensure PriceOracle and PriceOracleAsset exist
  const defaultOracle = await getOrInitDefaultPriceOracle(chainId, context);
  const priceAssetId = `${chainId}-${underlyingAsset.toLowerCase()}`;
  const priceAsset = await context.PriceOracleAsset.get(priceAssetId);
  if (!priceAsset) {
    const asset: PriceOracleAsset = {
      id: priceAssetId,
      oracle_id: defaultOracle.id,
      priceSource: ZERO_ADDRESS,
      type: PRICE_ORACLE_ASSET_TYPE_SIMPLE,
      platform: PRICE_ORACLE_ASSET_PLATFORM_SIMPLE,
      priceInEth: ZERO_BI,
      isFallbackRequired: false,
      lastUpdateTimestamp: 0,
      fromChainlinkSourcesRegistry: false,
    };
    context.PriceOracleAsset.set(asset);
  }

  const placeholderTokenId = `${chainId}-${ZERO_ADDRESS}`;

  const reserve: Reserve = {
    id,
    underlyingAsset: underlyingAsset.toLowerCase(),
    pool_id: poolId,
    symbol: "",
    name: "",
    decimals: 0,
    usageAsCollateralEnabled: false,
    borrowingEnabled: false,
    stableBorrowRateEnabled: false,
    isActive: false,
    isFrozen: false,
    price_id: priceAssetId,
    reserveInterestRateStrategy: ZERO_ADDRESS,
    optimalUtilisationRate: ZERO_BI,
    variableRateSlope1: ZERO_BI,
    variableRateSlope2: ZERO_BI,
    stableRateSlope1: ZERO_BI,
    stableRateSlope2: ZERO_BI,
    baseVariableBorrowRate: ZERO_BI,
    baseLTVasCollateral: ZERO_BI,
    reserveLiquidationThreshold: ZERO_BI,
    reserveLiquidationBonus: ZERO_BI,
    utilizationRate: ZERO_BD,
    totalLiquidity: ZERO_BI,
    totalATokenSupply: ZERO_BI,
    totalLiquidityAsCollateral: ZERO_BI,
    availableLiquidity: ZERO_BI,
    totalPrincipalStableDebt: ZERO_BI,
    totalScaledVariableDebt: ZERO_BI,
    totalCurrentVariableDebt: ZERO_BI,
    totalSupplies: ZERO_BI,
    liquidityRate: ZERO_BI,
    accruedToTreasury: ZERO_BI,
    averageStableRate: ZERO_BI,
    variableBorrowRate: ZERO_BI,
    stableBorrowRate: ZERO_BI,
    liquidityIndex: ZERO_BI,
    variableBorrowIndex: ZERO_BI,
    aToken_id: placeholderTokenId,
    vToken_id: placeholderTokenId,
    sToken_id: placeholderTokenId,
    reserveFactor: ZERO_BI,
    lastUpdateTimestamp: 0,
    stableDebtLastUpdateTimestamp: 0,
    isPaused: false,
    isDropped: false,
    siloedBorrowing: false,
    lifetimeLiquidity: ZERO_BI,
    lifetimePrincipalStableDebt: ZERO_BI,
    lifetimeScaledVariableDebt: ZERO_BI,
    lifetimeCurrentVariableDebt: ZERO_BI,
    lifetimeRepayments: ZERO_BI,
    lifetimeWithdrawals: ZERO_BI,
    lifetimeBorrows: ZERO_BI,
    lifetimeLiquidated: ZERO_BI,
    lifetimeFlashLoans: ZERO_BI,
    lifetimeFlashLoanPremium: ZERO_BI,
    lifetimeFlashLoanLPPremium: ZERO_BI,
    lifetimeFlashLoanProtocolPremium: ZERO_BI,
    lifetimePortalLPFee: ZERO_BI,
    lifetimePortalProtocolFee: ZERO_BI,
    lifetimeSuppliersInterestEarned: ZERO_BI,
    lifetimeReserveFactorAccrued: ZERO_BI,
    // nullable / optional fields
    borrowCap: undefined,
    supplyCap: undefined,
    debtCeiling: undefined,
    unbackedMintCap: undefined,
    liquidationProtocolFee: undefined,
    borrowableInIsolation: undefined,
    eMode_id: undefined,
    aEmissionPerSecond: undefined,
    vEmissionPerSecond: undefined,
    sEmissionPerSecond: undefined,
    aTokenIncentivesIndex: undefined,
    vTokenIncentivesIndex: undefined,
    sTokenIncentivesIndex: undefined,
    aIncentivesLastUpdateTimestamp: undefined,
    vIncentivesLastUpdateTimestamp: undefined,
    sIncentivesLastUpdateTimestamp: undefined,
  };
  context.Reserve.set(reserve);
  return reserve;
}

// ─── SubToken ─────────────────────────────────────────────────────────────────

export async function getOrInitSubToken(
  tokenAddress: string,
  chainId: number,
  context: HandlerContext
): Promise<SubToken> {
  const id = getSubTokenId(tokenAddress, chainId);
  const existing = await context.SubToken.get(id);
  if (existing) return existing;
  // Placeholder pool_id — will be set during Initialized event
  const placeholderPoolId = `${chainId}-1`;
  const subToken: SubToken = {
    id,
    pool_id: placeholderPoolId,
    underlyingAssetAddress: ZERO_ADDRESS,
    underlyingAssetDecimals: 18,
    tokenContractImpl: undefined,
  };
  context.SubToken.set(subToken);
  return subToken;
}

// ─── ChainlinkAggregator ──────────────────────────────────────────────────────

export async function getChainlinkAggregator(
  aggregatorAddress: string,
  chainId: number,
  context: HandlerContext
): Promise<ChainlinkAggregator> {
  const id = `${chainId}-${aggregatorAddress.toLowerCase()}`;
  const existing = await context.ChainlinkAggregator.get(id);
  if (existing) return existing;
  const agg: ChainlinkAggregator = {
    id,
    oracleAsset_id: `${chainId}-${ZERO_ADDRESS}`,
  };
  context.ChainlinkAggregator.set(agg);
  return agg;
}

// ─── ReserveParamsHistoryItem ─────────────────────────────────────────────────

export async function getOrInitReserveParamsHistoryItem(
  id: string,
  reserve: Reserve,
  context: HandlerContext
): Promise<ReserveParamsHistoryItem> {
  const existing = await context.ReserveParamsHistoryItem.get(id);
  if (existing) return existing;
  const item: ReserveParamsHistoryItem = {
    id,
    reserve_id: reserve.id,
    variableBorrowRate: ZERO_BI,
    variableBorrowIndex: ZERO_BI,
    utilizationRate: ZERO_BD,
    stableBorrowRate: ZERO_BI,
    averageStableBorrowRate: ZERO_BI,
    liquidityIndex: ZERO_BI,
    liquidityRate: ZERO_BI,
    totalLiquidity: ZERO_BI,
    totalATokenSupply: ZERO_BI,
    totalLiquidityAsCollateral: ZERO_BI,
    availableLiquidity: ZERO_BI,
    priceInEth: ZERO_BI,
    priceInUsd: ZERO_BD,
    timestamp: 0,
    accruedToTreasury: ZERO_BI,
    totalScaledVariableDebt: ZERO_BI,
    totalCurrentVariableDebt: ZERO_BI,
    totalPrincipalStableDebt: ZERO_BI,
    lifetimePrincipalStableDebt: ZERO_BI,
    lifetimeScaledVariableDebt: ZERO_BI,
    lifetimeCurrentVariableDebt: ZERO_BI,
    lifetimeLiquidity: ZERO_BI,
    lifetimeBorrows: ZERO_BI,
    lifetimeRepayments: ZERO_BI,
    lifetimeWithdrawals: ZERO_BI,
    lifetimeLiquidated: ZERO_BI,
    lifetimeFlashLoans: ZERO_BI,
    lifetimeFlashLoanPremium: ZERO_BI,
    lifetimeFlashLoanLPPremium: ZERO_BI,
    lifetimeFlashLoanProtocolPremium: ZERO_BI,
    lifetimeReserveFactorAccrued: ZERO_BI,
    lifetimeSuppliersInterestEarned: ZERO_BI,
    lifetimePortalLPFee: ZERO_BI,
    lifetimePortalProtocolFee: ZERO_BI,
  };
  context.ReserveParamsHistoryItem.set(item);
  return item;
}

// ─── ReserveConfigurationHistoryItem ─────────────────────────────────────────

export async function getOrInitReserveConfigHistoryItem(
  id: string,
  reserve: Reserve,
  context: HandlerContext
): Promise<ReserveConfigurationHistoryItem> {
  const existing = await context.ReserveConfigurationHistoryItem.get(id);
  if (existing) return existing;
  const item: ReserveConfigurationHistoryItem = {
    id,
    reserve_id: reserve.id,
    usageAsCollateralEnabled: false,
    borrowingEnabled: false,
    stableBorrowRateEnabled: false,
    isActive: false,
    isFrozen: false,
    reserveInterestRateStrategy: ZERO_ADDRESS,
    baseLTVasCollateral: ZERO_BI,
    reserveLiquidationThreshold: ZERO_BI,
    reserveLiquidationBonus: ZERO_BI,
    timestamp: 0,
  };
  context.ReserveConfigurationHistoryItem.set(item);
  return item;
}

// ─── Referrer ─────────────────────────────────────────────────────────────────

export async function getOrInitReferrer(
  referralCode: number,
  chainId: number,
  context: HandlerContext
): Promise<Referrer> {
  const id = `${chainId}-${referralCode}`;
  const existing = await context.Referrer.get(id);
  if (existing) return existing;
  const referrer: Referrer = { id };
  context.Referrer.set(referrer);
  return referrer;
}
