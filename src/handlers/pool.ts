import { Pool } from "generated";
import type {
  Entity,
  HandlerContext,
  Supply,
  RedeemUnderlying,
  Borrow,
  Repay,
  SwapBorrowRate,
  RebalanceStableBorrowRate,
  LiquidationCall,
  FlashLoan,
  UsageAsCollateral,
  MintUnbacked,
  BackUnbacked,
  MintedToTreasury,
  UserEModeSet,
  IsolationModeTotalDebtUpdated,
} from "generated";
import { BigDecimal } from "generated";
import {
  getOrInitReserve,
  getOrInitUserReserve,
  getOrInitUser,
  getOrInitReferrer,
  getPoolByContract,
} from "../helpers/v3/initializers";
import { getHistoryEntityId } from "../utils/id-generation";
import { calculateGrowth } from "../helpers/math";
import { USD_PRECISION, ZERO_BD } from "../utils/constants";

// Pool entity name conflicts with contract handler value
type PoolEntity = Entity<"Pool">;

async function getAssetPriceUSD(
  priceId: string,
  context: HandlerContext
): Promise<BigDecimal> {
  const priceAsset = await context.PriceOracleAsset.get(priceId);
  if (!priceAsset) return ZERO_BD;
  return new BigDecimal(priceAsset.priceInEth).div(USD_PRECISION);
}

Pool.Supply.handler(async ({ event, context }) => {
  const chainId = event.chainId;
  const poolId = await getPoolByContract(chainId, event.srcAddress, context).catch(() => null);
  if (!poolId) return;

  const reserve = await getOrInitReserve(event.params.reserve.toLowerCase(), poolId, chainId, context);
  const userReserve = await getOrInitUserReserve(
    event.params.onBehalfOf.toLowerCase(),
    event.params.reserve.toLowerCase(),
    poolId,
    chainId,
    context
  );
  const caller = await getOrInitUser(event.params.user.toLowerCase(), chainId, context);

  const id = `${chainId}:${getHistoryEntityId(chainId, event.block.number, event.transaction?.hash ?? "", event.logIndex)}`;

  const supply: Supply = {
    id,
    txHash: event.transaction?.hash ?? "",
    action: "Supply",
    pool_id: poolId,
    user_id: userReserve.user_id,
    caller_id: caller.id,
    reserve_id: reserve.id,
    userReserve_id: userReserve.id,
    amount: event.params.amount,
    timestamp: event.block.timestamp,
    assetPriceUSD: await getAssetPriceUSD(reserve.price_id, context),
    referrer_id: event.params.referralCode
      ? (await getOrInitReferrer(Number(event.params.referralCode), chainId, context)).id
      : undefined,
  };
  context.Supply.set(supply);
});

Pool.Withdraw.handler(async ({ event, context }) => {
  const chainId = event.chainId;
  const poolId = await getPoolByContract(chainId, event.srcAddress, context).catch(() => null);
  if (!poolId) return;

  const reserve = await getOrInitReserve(event.params.reserve.toLowerCase(), poolId, chainId, context);
  const userReserve = await getOrInitUserReserve(
    event.params.user.toLowerCase(),
    event.params.reserve.toLowerCase(),
    poolId,
    chainId,
    context
  );
  const toUser = await getOrInitUser(event.params.to.toLowerCase(), chainId, context);

  const redeemUnderlying: RedeemUnderlying = {
    id: `${chainId}:${getHistoryEntityId(chainId, event.block.number, event.transaction?.hash ?? "", event.logIndex)}`,
    txHash: event.transaction?.hash ?? "",
    action: "RedeemUnderlying",
    pool_id: poolId,
    user_id: userReserve.user_id,
    to_id: toUser.id,
    reserve_id: reserve.id,
    userReserve_id: userReserve.id,
    amount: event.params.amount,
    timestamp: event.block.timestamp,
    assetPriceUSD: await getAssetPriceUSD(reserve.price_id, context),
  };
  context.RedeemUnderlying.set(redeemUnderlying);
});

Pool.Borrow.handler(async ({ event, context }) => {
  const chainId = event.chainId;
  const poolId = await getPoolByContract(chainId, event.srcAddress, context).catch(() => null);
  if (!poolId) return;

  const reserve = await getOrInitReserve(event.params.reserve.toLowerCase(), poolId, chainId, context);
  const userReserve = await getOrInitUserReserve(
    event.params.onBehalfOf.toLowerCase(),
    event.params.reserve.toLowerCase(),
    poolId,
    chainId,
    context
  );
  const caller = await getOrInitUser(event.params.user.toLowerCase(), chainId, context);

  const borrow: Borrow = {
    id: `${chainId}:${getHistoryEntityId(chainId, event.block.number, event.transaction?.hash ?? "", event.logIndex)}`,
    txHash: event.transaction?.hash ?? "",
    action: "Borrow",
    pool_id: poolId,
    user_id: userReserve.user_id,
    caller_id: caller.id,
    reserve_id: reserve.id,
    userReserve_id: userReserve.id,
    amount: event.params.amount,
    borrowRate: event.params.borrowRate,
    borrowRateMode: Number(event.params.interestRateMode),
    stableTokenDebt: userReserve.principalStableDebt,
    variableTokenDebt: userReserve.scaledVariableDebt,
    timestamp: event.block.timestamp,
    assetPriceUSD: await getAssetPriceUSD(reserve.price_id, context),
    referrer_id: event.params.referralCode
      ? (await getOrInitReferrer(Number(event.params.referralCode), chainId, context)).id
      : undefined,
  };
  context.Borrow.set(borrow);
});

Pool.Repay.handler(async ({ event, context }) => {
  const chainId = event.chainId;
  const poolId = await getPoolByContract(chainId, event.srcAddress, context).catch(() => null);
  if (!poolId) return;

  const reserve = await getOrInitReserve(event.params.reserve.toLowerCase(), poolId, chainId, context);
  const userReserve = await getOrInitUserReserve(
    event.params.user.toLowerCase(),
    event.params.reserve.toLowerCase(),
    poolId,
    chainId,
    context
  );
  const repayer = await getOrInitUser(event.params.repayer.toLowerCase(), chainId, context);

  const repay: Repay = {
    id: `${chainId}:${getHistoryEntityId(chainId, event.block.number, event.transaction?.hash ?? "", event.logIndex)}`,
    txHash: event.transaction?.hash ?? "",
    action: "Repay",
    pool_id: poolId,
    user_id: userReserve.user_id,
    repayer_id: repayer.id,
    reserve_id: reserve.id,
    userReserve_id: userReserve.id,
    amount: event.params.amount,
    timestamp: event.block.timestamp,
    useATokens: event.params.useATokens,
    assetPriceUSD: await getAssetPriceUSD(reserve.price_id, context),
  };
  context.Repay.set(repay);
});

Pool.SwapBorrowRateMode.handler(async ({ event, context }) => {
  const chainId = event.chainId;
  const poolId = await getPoolByContract(chainId, event.srcAddress, context).catch(() => null);
  if (!poolId) return;

  const reserve = await getOrInitReserve(event.params.reserve.toLowerCase(), poolId, chainId, context);
  const userReserve = await getOrInitUserReserve(
    event.params.user.toLowerCase(),
    event.params.reserve.toLowerCase(),
    poolId,
    chainId,
    context
  );

  const modeFrom = Number(event.params.interestRateMode);
  const modeTo = modeFrom === 1 ? 2 : 1;

  const swapRate: SwapBorrowRate = {
    id: `${chainId}:${getHistoryEntityId(chainId, event.block.number, event.transaction?.hash ?? "", event.logIndex)}`,
    txHash: event.transaction?.hash ?? "",
    action: "SwapBorrowRate",
    pool_id: poolId,
    user_id: userReserve.user_id,
    reserve_id: reserve.id,
    userReserve_id: userReserve.id,
    borrowRateModeFrom: modeFrom,
    borrowRateModeTo: modeTo,
    stableBorrowRate: reserve.stableBorrowRate,
    variableBorrowRate: reserve.variableBorrowRate,
    timestamp: event.block.timestamp,
  };
  context.SwapBorrowRate.set(swapRate);
});

Pool.RebalanceStableBorrowRate.handler(async ({ event, context }) => {
  const chainId = event.chainId;
  const poolId = await getPoolByContract(chainId, event.srcAddress, context).catch(() => null);
  if (!poolId) return;

  const reserve = await getOrInitReserve(event.params.reserve.toLowerCase(), poolId, chainId, context);
  const userReserve = await getOrInitUserReserve(
    event.params.user.toLowerCase(),
    event.params.reserve.toLowerCase(),
    poolId,
    chainId,
    context
  );

  const rebalance: RebalanceStableBorrowRate = {
    id: `${chainId}:${getHistoryEntityId(chainId, event.block.number, event.transaction?.hash ?? "", event.logIndex)}`,
    txHash: event.transaction?.hash ?? "",
    action: "RebalanceStableBorrowRate",
    pool_id: poolId,
    user_id: userReserve.user_id,
    reserve_id: reserve.id,
    userReserve_id: userReserve.id,
    borrowRateFrom: userReserve.oldStableBorrowRate,
    borrowRateTo: userReserve.stableBorrowRate,
    timestamp: event.block.timestamp,
  };
  context.RebalanceStableBorrowRate.set(rebalance);
});

Pool.LiquidationCall.handler(async ({ event, context }) => {
  const chainId = event.chainId;
  const poolId = await getPoolByContract(chainId, event.srcAddress, context).catch(() => null);
  if (!poolId) return;

  const user = await getOrInitUser(event.params.user.toLowerCase(), chainId, context);
  const collateralReserve = await getOrInitReserve(event.params.collateralAsset.toLowerCase(), poolId, chainId, context);
  const collateralUserReserve = await getOrInitUserReserve(
    event.params.user.toLowerCase(),
    event.params.collateralAsset.toLowerCase(),
    poolId,
    chainId,
    context
  );
  const principalReserve = await getOrInitReserve(event.params.debtAsset.toLowerCase(), poolId, chainId, context);
  const principalUserReserve = await getOrInitUserReserve(
    event.params.user.toLowerCase(),
    event.params.debtAsset.toLowerCase(),
    poolId,
    chainId,
    context
  );

  context.Reserve.set({
    ...collateralReserve,
    lifetimeLiquidated: collateralReserve.lifetimeLiquidated + event.params.liquidatedCollateralAmount,
  });

  const liquidationCall: LiquidationCall = {
    id: `${chainId}:${getHistoryEntityId(chainId, event.block.number, event.transaction?.hash ?? "", event.logIndex)}`,
    txHash: event.transaction?.hash ?? "",
    action: "LiquidationCall",
    pool_id: poolId,
    user_id: user.id,
    collateralReserve_id: collateralReserve.id,
    collateralUserReserve_id: collateralUserReserve.id,
    collateralAmount: event.params.liquidatedCollateralAmount,
    principalReserve_id: principalReserve.id,
    principalUserReserve_id: principalUserReserve.id,
    principalAmount: event.params.debtToCover,
    liquidator: event.params.liquidator.toLowerCase(),
    timestamp: event.block.timestamp,
    collateralAssetPriceUSD: await getAssetPriceUSD(collateralReserve.price_id, context),
    borrowAssetPriceUSD: await getAssetPriceUSD(principalReserve.price_id, context),
  };
  context.LiquidationCall.set(liquidationCall);
});

Pool.FlashLoan.handler(async ({ event, context }) => {
  const chainId = event.chainId;
  const poolId = await getPoolByContract(chainId, event.srcAddress, context).catch(() => null);
  if (!poolId) return;

  const reserve = await getOrInitReserve(event.params.asset.toLowerCase(), poolId, chainId, context);
  const initiator = await getOrInitUser(event.params.initiator.toLowerCase(), chainId, context);

  const pool = await context.Pool.get(poolId) as PoolEntity | undefined;
  const flashloanPremiumToProtocol = pool?.flashloanPremiumToProtocol ?? 10000n;

  const premium = event.params.premium;
  const premiumToProtocol = (premium * flashloanPremiumToProtocol + 5000n) / 10000n;
  const premiumToLP = premium - premiumToProtocol;

  context.Reserve.set({
    ...reserve,
    availableLiquidity: reserve.availableLiquidity + premium,
    lifetimeFlashLoans: reserve.lifetimeFlashLoans + event.params.amount,
    lifetimeFlashLoanPremium: reserve.lifetimeFlashLoanPremium + premium,
    lifetimeFlashLoanLPPremium: reserve.lifetimeFlashLoanLPPremium + premiumToLP,
    lifetimeFlashLoanProtocolPremium: reserve.lifetimeFlashLoanProtocolPremium + premiumToProtocol,
    totalATokenSupply: reserve.totalATokenSupply + premium,
  });

  const flashLoan: FlashLoan = {
    id: `${chainId}:${getHistoryEntityId(chainId, event.block.number, event.transaction?.hash ?? "", event.logIndex)}`,
    pool_id: poolId,
    reserve_id: reserve.id,
    target: event.params.target.toLowerCase(),
    initiator_id: initiator.id,
    amount: event.params.amount,
    totalFee: premium,
    lpFee: premiumToLP,
    protocolFee: premiumToProtocol,
    timestamp: event.block.timestamp,
    assetPriceUSD: await getAssetPriceUSD(reserve.price_id, context),
  };
  context.FlashLoan.set(flashLoan);
});

Pool.ReserveUsedAsCollateralEnabled.handler(async ({ event, context }) => {
  const chainId = event.chainId;
  const poolId = await getPoolByContract(chainId, event.srcAddress, context).catch(() => null);
  if (!poolId) return;

  const reserve = await getOrInitReserve(event.params.reserve.toLowerCase(), poolId, chainId, context);
  const userReserve = await getOrInitUserReserve(
    event.params.user.toLowerCase(),
    event.params.reserve.toLowerCase(),
    poolId,
    chainId,
    context
  );

  const usageAsCollateral: UsageAsCollateral = {
    id: `${chainId}:${getHistoryEntityId(chainId, event.block.number, event.transaction?.hash ?? "", event.logIndex)}`,
    txHash: event.transaction?.hash ?? "",
    action: "UsageAsCollateral",
    pool_id: poolId,
    user_id: userReserve.user_id,
    reserve_id: reserve.id,
    userReserve_id: userReserve.id,
    fromState: userReserve.usageAsCollateralEnabledOnUser,
    toState: true,
    timestamp: event.block.timestamp,
  };
  context.UsageAsCollateral.set(usageAsCollateral);

  context.UserReserve.set({
    ...userReserve,
    usageAsCollateralEnabledOnUser: true,
    lastUpdateTimestamp: event.block.timestamp,
  });
});

Pool.ReserveUsedAsCollateralDisabled.handler(async ({ event, context }) => {
  const chainId = event.chainId;
  const poolId = await getPoolByContract(chainId, event.srcAddress, context).catch(() => null);
  if (!poolId) return;

  const reserve = await getOrInitReserve(event.params.reserve.toLowerCase(), poolId, chainId, context);
  const userReserve = await getOrInitUserReserve(
    event.params.user.toLowerCase(),
    event.params.reserve.toLowerCase(),
    poolId,
    chainId,
    context
  );

  const usageAsCollateral: UsageAsCollateral = {
    id: `${chainId}:${getHistoryEntityId(chainId, event.block.number, event.transaction?.hash ?? "", event.logIndex)}`,
    txHash: event.transaction?.hash ?? "",
    action: "UsageAsCollateral",
    pool_id: poolId,
    user_id: userReserve.user_id,
    reserve_id: reserve.id,
    userReserve_id: userReserve.id,
    fromState: userReserve.usageAsCollateralEnabledOnUser,
    toState: false,
    timestamp: event.block.timestamp,
  };
  context.UsageAsCollateral.set(usageAsCollateral);

  context.UserReserve.set({
    ...userReserve,
    usageAsCollateralEnabledOnUser: false,
    lastUpdateTimestamp: event.block.timestamp,
  });
});

Pool.ReserveDataUpdated.handler(async ({ event, context }) => {
  const chainId = event.chainId;
  const poolId = await getPoolByContract(chainId, event.srcAddress, context).catch(() => null);
  if (!poolId) return;

  const reserve = await getOrInitReserve(event.params.reserve.toLowerCase(), poolId, chainId, context);

  const prevTimestamp = BigInt(reserve.lastUpdateTimestamp);
  const timestamp = BigInt(event.block.timestamp);

  let totalATokenSupply = reserve.totalATokenSupply;
  let lifetimeSuppliersInterestEarned = reserve.lifetimeSuppliersInterestEarned;

  if (timestamp > prevTimestamp) {
    const growth = calculateGrowth(
      reserve.totalATokenSupply,
      reserve.liquidityRate,
      prevTimestamp,
      timestamp
    );
    totalATokenSupply = reserve.totalATokenSupply + growth;
    lifetimeSuppliersInterestEarned = reserve.lifetimeSuppliersInterestEarned + growth;
  }

  context.Reserve.set({
    ...reserve,
    stableBorrowRate: event.params.stableBorrowRate,
    variableBorrowRate: event.params.variableBorrowRate,
    variableBorrowIndex: event.params.variableBorrowIndex,
    liquidityRate: event.params.liquidityRate,
    liquidityIndex: event.params.liquidityIndex,
    totalATokenSupply,
    lifetimeSuppliersInterestEarned,
    lastUpdateTimestamp: event.block.timestamp,
  });
});

Pool.MintUnbacked.handler(async ({ event, context }) => {
  const chainId = event.chainId;
  const poolId = await getPoolByContract(chainId, event.srcAddress, context).catch(() => null);
  if (!poolId) return;

  const reserve = await getOrInitReserve(event.params.reserve.toLowerCase(), poolId, chainId, context);
  const userReserve = await getOrInitUserReserve(
    event.params.onBehalfOf.toLowerCase(),
    event.params.reserve.toLowerCase(),
    poolId,
    chainId,
    context
  );
  const caller = await getOrInitUser(event.params.user.toLowerCase(), chainId, context);

  const mintUnbacked: MintUnbacked = {
    id: `${chainId}:${getHistoryEntityId(chainId, event.block.number, event.transaction?.hash ?? "", event.logIndex)}`,
    pool_id: poolId,
    user_id: userReserve.user_id,
    caller_id: caller.id,
    reserve_id: reserve.id,
    userReserve_id: userReserve.id,
    amount: event.params.amount,
    referral: Number(event.params.referralCode),
    timestamp: event.block.timestamp,
  };
  context.MintUnbacked.set(mintUnbacked);
});

Pool.BackUnbacked.handler(async ({ event, context }) => {
  const chainId = event.chainId;
  const poolId = await getPoolByContract(chainId, event.srcAddress, context).catch(() => null);
  if (!poolId) return;

  const reserve = await getOrInitReserve(event.params.reserve.toLowerCase(), poolId, chainId, context);
  const userReserve = await getOrInitUserReserve(
    event.params.backer.toLowerCase(),
    event.params.reserve.toLowerCase(),
    poolId,
    chainId,
    context
  );

  const pool = await context.Pool.get(poolId) as PoolEntity | undefined;
  const bridgeProtocolFee = pool?.bridgeProtocolFee ?? 10000n;

  const fee = event.params.fee;
  const premiumToProtocol = (fee * bridgeProtocolFee + 5000n) / 10000n;
  const premiumToLP = fee - premiumToProtocol;

  context.Reserve.set({
    ...reserve,
    lifetimePortalLPFee: reserve.lifetimePortalLPFee + premiumToLP,
    lifetimePortalProtocolFee: reserve.lifetimePortalProtocolFee + premiumToProtocol,
  });

  const backUnbacked: BackUnbacked = {
    id: `${chainId}:${getHistoryEntityId(chainId, event.block.number, event.transaction?.hash ?? "", event.logIndex)}`,
    pool_id: poolId,
    reserve_id: reserve.id,
    userReserve_id: userReserve.id,
    backer_id: userReserve.user_id,
    amount: event.params.amount,
    fee,
    lpFee: premiumToLP,
    protocolFee: premiumToProtocol,
    timestamp: event.block.timestamp,
  };
  context.BackUnbacked.set(backUnbacked);
});

Pool.UserEModeSet.handler(async ({ event, context }) => {
  const chainId = event.chainId;
  const user = await getOrInitUser(event.params.user.toLowerCase(), chainId, context);

  const categoryId = Number(event.params.categoryId);
  const eModeId = categoryId === 0 ? undefined : `${chainId}-${categoryId}`;

  context.User.set({ ...user, eModeCategoryId_id: eModeId });

  const userEModeSet: UserEModeSet = {
    id: `${chainId}:${getHistoryEntityId(chainId, event.block.number, event.transaction?.hash ?? "", event.logIndex)}`,
    txHash: event.transaction?.hash ?? "",
    action: "UserEModeSet",
    user_id: user.id,
    categoryId,
    timestamp: event.block.timestamp,
  };
  context.UserEModeSet.set(userEModeSet);
});

Pool.MintedToTreasury.handler(async ({ event, context }) => {
  const chainId = event.chainId;
  const poolId = await getPoolByContract(chainId, event.srcAddress, context).catch(() => null);
  if (!poolId) return;

  const reserve = await getOrInitReserve(event.params.reserve.toLowerCase(), poolId, chainId, context);

  const mintedToTreasury: MintedToTreasury = {
    id: `${chainId}:${getHistoryEntityId(chainId, event.block.number, event.transaction?.hash ?? "", event.logIndex)}`,
    pool_id: poolId,
    reserve_id: reserve.id,
    amount: event.params.amountMinted,
    timestamp: event.block.timestamp,
  };
  context.MintedToTreasury.set(mintedToTreasury);
});

Pool.IsolationModeTotalDebtUpdated.handler(async ({ event, context }) => {
  const chainId = event.chainId;
  const poolId = await getPoolByContract(chainId, event.srcAddress, context).catch(() => null);
  if (!poolId) return;

  const reserve = await getOrInitReserve(event.params.asset.toLowerCase(), poolId, chainId, context);

  const isolationDebt: IsolationModeTotalDebtUpdated = {
    id: `${chainId}:${getHistoryEntityId(chainId, event.block.number, event.transaction?.hash ?? "", event.logIndex)}`,
    pool_id: poolId,
    reserve_id: reserve.id,
    isolatedDebt: event.params.totalDebt,
    timestamp: event.block.timestamp,
  };
  context.IsolationModeTotalDebtUpdated.set(isolationDebt);
});
