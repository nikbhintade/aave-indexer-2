import { LendingPool } from "generated";
import type {
  HandlerContext,
  Deposit,
  RedeemUnderlying,
  Borrow,
  Repay,
  SwapBorrowRate,
  RebalanceStableBorrowRate,
  LiquidationCall,
  FlashLoan,
  UsageAsCollateral,
  Reserve,
} from "generated";
import {
  getOrInitReserve,
  getOrInitUserReserve,
  getOrInitUser,
  getOrInitReferrer,
  getPoolByContract,
  getOrInitDefaultPriceOracle,
} from "../../helpers/v3/initializers";
import { getHistoryEntityId } from "../../utils/id-generation";
import { BigDecimal } from "generated";
import { ZERO_BI, ZERO_BD } from "../../utils/constants";
import { calculateGrowth } from "../../helpers/math";

const ETH_PRECISION = new BigDecimal("1000000000000000000"); // 1e18
const USD_PRECISION = new BigDecimal("100000000"); // 1e8

async function getAssetPriceUSD(
  priceId: string,
  oracleId: string,
  chainId: number,
  context: HandlerContext
): Promise<BigDecimal> {
  const priceAsset = await context.PriceOracleAsset.get(priceId);
  if (!priceAsset) return ZERO_BD;

  const oracle = await context.PriceOracle.get(oracleId);
  if (oracle && oracle.usdPriceEth > 0n) {
    const ethPriceUSD = new BigDecimal(1).div(
      new BigDecimal(oracle.usdPriceEth).div(ETH_PRECISION)
    );
    return new BigDecimal(priceAsset.priceInEth).div(ETH_PRECISION).times(ethPriceUSD);
  }
  return new BigDecimal(priceAsset.priceInEth).div(USD_PRECISION);
}

// ─── LendingPool.Deposit ──────────────────────────────────────────────────────

LendingPool.Deposit.handler(async ({ event, context }) => {
  const chainId = event.chainId;
  const asset = event.params.reserve.toLowerCase();
  const onBehalfOf = event.params.onBehalfOf.toLowerCase();
  const caller = event.params.user.toLowerCase();

  const poolId = await getPoolByContract(chainId, event.srcAddress, context).catch(() => null);
  if (!poolId) return;

  const reserve = await getOrInitReserve(asset, poolId, chainId, context);
  const userReserve = await getOrInitUserReserve(onBehalfOf, asset, poolId, chainId, context);
  const callerUser = await getOrInitUser(caller, chainId, context);

  // Update reserve: V2 deposit = supply
  context.Reserve.set({
    ...reserve,
    totalLiquidity: reserve.totalLiquidity + event.params.amount,
    availableLiquidity: reserve.availableLiquidity + event.params.amount,
    totalSupplies: reserve.totalSupplies + event.params.amount,
    lifetimeLiquidity: reserve.lifetimeLiquidity + event.params.amount,
    lastUpdateTimestamp: event.block.timestamp,
  });

  const pool = await context.Pool.get(poolId);
  const oracleId = pool?.proxyPriceProvider ? `${chainId}-${pool.proxyPriceProvider}` : `${chainId}-0`;

  const id = `${chainId}:${getHistoryEntityId(chainId, event.block.number, event.transaction?.hash ?? "", event.logIndex)}`;
  const priceId = `${chainId}-${asset}`;

  const deposit: Deposit = {
    id,
    txHash: event.transaction?.hash ?? "",
    action: "Deposit",
    pool_id: poolId,
    user_id: userReserve.user_id,
    caller_id: callerUser.id,
    reserve_id: reserve.id,
    userReserve_id: userReserve.id,
    amount: event.params.amount,
    timestamp: event.block.timestamp,
    assetPriceUSD: await getAssetPriceUSD(priceId, oracleId, chainId, context),
    referrer_id: event.params.referral
      ? (await getOrInitReferrer(Number(event.params.referral), chainId, context)).id
      : undefined,
  };
  context.Deposit.set(deposit);
});

// ─── LendingPool.Withdraw ─────────────────────────────────────────────────────

LendingPool.Withdraw.handler(async ({ event, context }) => {
  const chainId = event.chainId;
  const asset = event.params.reserve.toLowerCase();
  const userAddress = event.params.user.toLowerCase();
  const toAddress = event.params.to.toLowerCase();

  const poolId = await getPoolByContract(chainId, event.srcAddress, context).catch(() => null);
  if (!poolId) return;

  const reserve = await getOrInitReserve(asset, poolId, chainId, context);
  const userReserve = await getOrInitUserReserve(userAddress, asset, poolId, chainId, context);
  const toUser = await getOrInitUser(toAddress, chainId, context);

  context.Reserve.set({
    ...reserve,
    availableLiquidity: reserve.availableLiquidity - event.params.amount,
    lifetimeWithdrawals: reserve.lifetimeWithdrawals + event.params.amount,
    lastUpdateTimestamp: event.block.timestamp,
  });

  const pool = await context.Pool.get(poolId);
  const oracleId = pool?.proxyPriceProvider ? `${chainId}-${pool.proxyPriceProvider}` : `${chainId}-0`;
  const priceId = `${chainId}-${asset}`;

  const id = `${chainId}:${getHistoryEntityId(chainId, event.block.number, event.transaction?.hash ?? "", event.logIndex)}`;
  const redeem: RedeemUnderlying = {
    id,
    txHash: event.transaction?.hash ?? "",
    action: "RedeemUnderlying",
    pool_id: poolId,
    user_id: userReserve.user_id,
    to_id: toUser.id,
    reserve_id: reserve.id,
    userReserve_id: userReserve.id,
    amount: event.params.amount,
    timestamp: event.block.timestamp,
    assetPriceUSD: await getAssetPriceUSD(priceId, oracleId, chainId, context),
  };
  context.RedeemUnderlying.set(redeem);
});

// ─── LendingPool.Borrow ───────────────────────────────────────────────────────

LendingPool.Borrow.handler(async ({ event, context }) => {
  const chainId = event.chainId;
  const asset = event.params.reserve.toLowerCase();
  const onBehalfOf = event.params.onBehalfOf.toLowerCase();
  const caller = event.params.user.toLowerCase();

  const poolId = await getPoolByContract(chainId, event.srcAddress, context).catch(() => null);
  if (!poolId) return;

  const reserve = await getOrInitReserve(asset, poolId, chainId, context);
  const userReserve = await getOrInitUserReserve(onBehalfOf, asset, poolId, chainId, context);
  const callerUser = await getOrInitUser(caller, chainId, context);
  const borrowRateMode = Number(event.params.borrowRateMode);

  context.Reserve.set({
    ...reserve,
    availableLiquidity: reserve.availableLiquidity - event.params.amount,
    lifetimeBorrows: reserve.lifetimeBorrows + event.params.amount,
    lastUpdateTimestamp: event.block.timestamp,
  });

  const pool = await context.Pool.get(poolId);
  const oracleId = pool?.proxyPriceProvider ? `${chainId}-${pool.proxyPriceProvider}` : `${chainId}-0`;
  const priceId = `${chainId}-${asset}`;

  const id = `${chainId}:${getHistoryEntityId(chainId, event.block.number, event.transaction?.hash ?? "", event.logIndex)}`;
  const borrow: Borrow = {
    id,
    txHash: event.transaction?.hash ?? "",
    action: "Borrow",
    pool_id: poolId,
    user_id: userReserve.user_id,
    caller_id: callerUser.id,
    reserve_id: reserve.id,
    userReserve_id: userReserve.id,
    amount: event.params.amount,
    borrowRate: event.params.borrowRate,
    borrowRateMode,
    stableTokenDebt: userReserve.principalStableDebt,
    variableTokenDebt: userReserve.scaledVariableDebt,
    timestamp: event.block.timestamp,
    assetPriceUSD: await getAssetPriceUSD(priceId, oracleId, chainId, context),
    referrer_id: event.params.referral
      ? (await getOrInitReferrer(Number(event.params.referral), chainId, context)).id
      : undefined,
  };
  context.Borrow.set(borrow);
});

// ─── LendingPool.Repay ────────────────────────────────────────────────────────

LendingPool.Repay.handler(async ({ event, context }) => {
  const chainId = event.chainId;
  const asset = event.params.reserve.toLowerCase();
  const userAddress = event.params.user.toLowerCase();
  const repayerAddress = event.params.repayer.toLowerCase();

  const poolId = await getPoolByContract(chainId, event.srcAddress, context).catch(() => null);
  if (!poolId) return;

  const reserve = await getOrInitReserve(asset, poolId, chainId, context);
  const userReserve = await getOrInitUserReserve(userAddress, asset, poolId, chainId, context);
  const repayer = await getOrInitUser(repayerAddress, chainId, context);

  context.Reserve.set({
    ...reserve,
    availableLiquidity: reserve.availableLiquidity + event.params.amount,
    lifetimeRepayments: reserve.lifetimeRepayments + event.params.amount,
    lastUpdateTimestamp: event.block.timestamp,
  });

  const pool = await context.Pool.get(poolId);
  const oracleId = pool?.proxyPriceProvider ? `${chainId}-${pool.proxyPriceProvider}` : `${chainId}-0`;
  const priceId = `${chainId}-${asset}`;

  const id = `${chainId}:${getHistoryEntityId(chainId, event.block.number, event.transaction?.hash ?? "", event.logIndex)}`;
  const repay: Repay = {
    id,
    txHash: event.transaction?.hash ?? "",
    action: "Repay",
    pool_id: poolId,
    user_id: userReserve.user_id,
    repayer_id: repayer.id,
    reserve_id: reserve.id,
    userReserve_id: userReserve.id,
    amount: event.params.amount,
    timestamp: event.block.timestamp,
    assetPriceUSD: await getAssetPriceUSD(priceId, oracleId, chainId, context),
    useATokens: undefined, // V2 doesn't have this field
  };
  context.Repay.set(repay);
});

// ─── LendingPool.Swap ─────────────────────────────────────────────────────────

LendingPool.Swap.handler(async ({ event, context }) => {
  const chainId = event.chainId;
  const asset = event.params.reserve.toLowerCase();
  const userAddress = event.params.user.toLowerCase();

  const poolId = await getPoolByContract(chainId, event.srcAddress, context).catch(() => null);
  if (!poolId) return;

  const reserve = await getOrInitReserve(asset, poolId, chainId, context);
  const userReserve = await getOrInitUserReserve(userAddress, asset, poolId, chainId, context);

  const rateModeFrom = Number(event.params.rateMode);
  const rateModeTo = rateModeFrom === 1 ? 2 : 1;

  const id = `${chainId}:${getHistoryEntityId(chainId, event.block.number, event.transaction?.hash ?? "", event.logIndex)}`;
  const swapItem: SwapBorrowRate = {
    id,
    txHash: event.transaction?.hash ?? "",
    action: "Swap",
    pool_id: poolId,
    user_id: userReserve.user_id,
    reserve_id: reserve.id,
    userReserve_id: userReserve.id,
    borrowRateModeFrom: rateModeFrom,
    borrowRateModeTo: rateModeTo,
    stableBorrowRate: reserve.stableBorrowRate,
    variableBorrowRate: reserve.variableBorrowRate,
    timestamp: event.block.timestamp,
  };
  context.SwapBorrowRate.set(swapItem);
});

// ─── LendingPool.RebalanceStableBorrowRate ───────────────────────────────────

LendingPool.RebalanceStableBorrowRate.handler(async ({ event, context }) => {
  const chainId = event.chainId;
  const asset = event.params.reserve.toLowerCase();
  const userAddress = event.params.user.toLowerCase();

  const poolId = await getPoolByContract(chainId, event.srcAddress, context).catch(() => null);
  if (!poolId) return;

  const reserve = await getOrInitReserve(asset, poolId, chainId, context);
  const userReserve = await getOrInitUserReserve(userAddress, asset, poolId, chainId, context);

  const id = `${chainId}:${getHistoryEntityId(chainId, event.block.number, event.transaction?.hash ?? "", event.logIndex)}`;
  const rebalance: RebalanceStableBorrowRate = {
    id,
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

// ─── LendingPool.LiquidationCall ─────────────────────────────────────────────

LendingPool.LiquidationCall.handler(async ({ event, context }) => {
  const chainId = event.chainId;
  const collateralAsset = event.params.collateralAsset.toLowerCase();
  const debtAsset = event.params.debtAsset.toLowerCase();
  const userAddress = event.params.user.toLowerCase();

  const poolId = await getPoolByContract(chainId, event.srcAddress, context).catch(() => null);
  if (!poolId) return;

  const collateralReserve = await getOrInitReserve(collateralAsset, poolId, chainId, context);
  const collateralUserReserve = await getOrInitUserReserve(userAddress, collateralAsset, poolId, chainId, context);
  const principalReserve = await getOrInitReserve(debtAsset, poolId, chainId, context);
  const principalUserReserve = await getOrInitUserReserve(userAddress, debtAsset, poolId, chainId, context);
  const user = await getOrInitUser(userAddress, chainId, context);

  context.Reserve.set({
    ...collateralReserve,
    lifetimeLiquidated: collateralReserve.lifetimeLiquidated + event.params.liquidatedCollateralAmount,
    lastUpdateTimestamp: event.block.timestamp,
  });

  const pool = await context.Pool.get(poolId);
  const oracleId = pool?.proxyPriceProvider ? `${chainId}-${pool.proxyPriceProvider}` : `${chainId}-0`;

  const id = `${chainId}:${getHistoryEntityId(chainId, event.block.number, event.transaction?.hash ?? "", event.logIndex)}`;
  const liquidation: LiquidationCall = {
    id,
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
    collateralAssetPriceUSD: await getAssetPriceUSD(`${chainId}-${collateralAsset}`, oracleId, chainId, context),
    borrowAssetPriceUSD: await getAssetPriceUSD(`${chainId}-${debtAsset}`, oracleId, chainId, context),
  };
  context.LiquidationCall.set(liquidation);
});

// ─── LendingPool.FlashLoan ────────────────────────────────────────────────────

LendingPool.FlashLoan.handler(async ({ event, context }) => {
  const chainId = event.chainId;
  const asset = event.params.asset.toLowerCase();

  const poolId = await getPoolByContract(chainId, event.srcAddress, context).catch(() => null);
  if (!poolId) return;

  const reserve = await getOrInitReserve(asset, poolId, chainId, context);
  const initiator = await getOrInitUser(event.params.initiator.toLowerCase(), chainId, context);

  const premium = event.params.premium;
  context.Reserve.set({
    ...reserve,
    availableLiquidity: reserve.availableLiquidity + premium,
    lifetimeFlashLoans: reserve.lifetimeFlashLoans + event.params.amount,
    lifetimeFlashLoanPremium: reserve.lifetimeFlashLoanPremium + premium,
    totalATokenSupply: reserve.totalATokenSupply + premium,
    lastUpdateTimestamp: event.block.timestamp,
  });

  const pool = await context.Pool.get(poolId);
  const oracleId = pool?.proxyPriceProvider ? `${chainId}-${pool.proxyPriceProvider}` : `${chainId}-0`;
  const priceId = `${chainId}-${asset}`;

  const id = `${chainId}:${getHistoryEntityId(chainId, event.block.number, event.transaction?.hash ?? "", event.logIndex)}`;
  const flashLoan: FlashLoan = {
    id,
    pool_id: poolId,
    reserve_id: reserve.id,
    target: event.params.target.toLowerCase(),
    initiator_id: initiator.id,
    amount: event.params.amount,
    totalFee: premium,
    lpFee: undefined,    // V2 has no split
    protocolFee: undefined,
    timestamp: event.block.timestamp,
    assetPriceUSD: await getAssetPriceUSD(priceId, oracleId, chainId, context),
  };
  context.FlashLoan.set(flashLoan);
});

// ─── LendingPool.ReserveDataUpdated ──────────────────────────────────────────

LendingPool.ReserveDataUpdated.handler(async ({ event, context }) => {
  const chainId = event.chainId;
  const asset = event.params.reserve.toLowerCase();

  const poolId = await getPoolByContract(chainId, event.srcAddress, context).catch(() => null);
  if (!poolId) return;

  const reserve = await getOrInitReserve(asset, poolId, chainId, context);
  const timestamp = event.block.timestamp;
  const prevTimestamp = reserve.lastUpdateTimestamp;

  let totalATokenSupply = reserve.totalATokenSupply;
  let lifetimeSuppliersInterestEarned = reserve.lifetimeSuppliersInterestEarned;
  if (timestamp > prevTimestamp) {
    const growth = calculateGrowth(reserve.totalATokenSupply, reserve.liquidityRate, BigInt(prevTimestamp), BigInt(timestamp));
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
    lastUpdateTimestamp: timestamp,
  });
});

// ─── LendingPool.ReserveUsedAsCollateral events ───────────────────────────────

LendingPool.ReserveUsedAsCollateralEnabled.handler(async ({ event, context }) => {
  const chainId = event.chainId;
  const asset = event.params.reserve.toLowerCase();
  const userAddress = event.params.user.toLowerCase();

  const poolId = await getPoolByContract(chainId, event.srcAddress, context).catch(() => null);
  if (!poolId) return;

  const reserve = await getOrInitReserve(asset, poolId, chainId, context);
  const userReserve = await getOrInitUserReserve(userAddress, asset, poolId, chainId, context);

  context.UserReserve.set({ ...userReserve, usageAsCollateralEnabledOnUser: true, lastUpdateTimestamp: event.block.timestamp });

  const id = `${chainId}:${getHistoryEntityId(chainId, event.block.number, event.transaction?.hash ?? "", event.logIndex)}`;
  const collateral: UsageAsCollateral = {
    id,
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
  context.UsageAsCollateral.set(collateral);
});

LendingPool.ReserveUsedAsCollateralDisabled.handler(async ({ event, context }) => {
  const chainId = event.chainId;
  const asset = event.params.reserve.toLowerCase();
  const userAddress = event.params.user.toLowerCase();

  const poolId = await getPoolByContract(chainId, event.srcAddress, context).catch(() => null);
  if (!poolId) return;

  const reserve = await getOrInitReserve(asset, poolId, chainId, context);
  const userReserve = await getOrInitUserReserve(userAddress, asset, poolId, chainId, context);

  context.UserReserve.set({ ...userReserve, usageAsCollateralEnabledOnUser: false, lastUpdateTimestamp: event.block.timestamp });

  const id = `${chainId}:${getHistoryEntityId(chainId, event.block.number, event.transaction?.hash ?? "", event.logIndex)}`;
  const collateral: UsageAsCollateral = {
    id,
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
  context.UsageAsCollateral.set(collateral);
});

// ─── LendingPool.Paused / Unpaused ───────────────────────────────────────────

LendingPool.Paused.handler(async ({ event, context }) => {
  const chainId = event.chainId;
  const poolId = await getPoolByContract(chainId, event.srcAddress, context).catch(() => null);
  if (!poolId) return;
  const pool = await context.Pool.get(poolId);
  if (!pool) return;
  context.Pool.set({ ...pool, paused: true });
});

LendingPool.Unpaused.handler(async ({ event, context }) => {
  const chainId = event.chainId;
  const poolId = await getPoolByContract(chainId, event.srcAddress, context).catch(() => null);
  if (!poolId) return;
  const pool = await context.Pool.get(poolId);
  if (!pool) return;
  context.Pool.set({ ...pool, paused: false });
});
