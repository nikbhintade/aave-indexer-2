import { AToken, StableDebtToken, VariableDebtToken } from "generated";
import type {
  HandlerContext,
  ATokenBalanceHistoryItem,
  VTokenBalanceHistoryItem,
  STokenBalanceHistoryItem,
  StableTokenDelegatedAllowance,
  VariableTokenDelegatedAllowance,
  Reserve,
} from "generated";
import { BigDecimal } from "generated";
import {
  getOrInitReserve,
  getOrInitUserReserve,
  getOrInitUser,
  getOrInitSubToken,
  getOrInitReserveParamsHistoryItem,
  getPriceOracleAsset,
  getPoolByContract,
} from "../helpers/v3/initializers";
import { getHistoryEntityId } from "../utils/id-generation";
import { rayDiv, rayMul } from "../helpers/math";
import { ZERO_BI, ZERO_BD } from "../utils/constants";
import { getUpdateBlock } from "../utils/converters";

// Treasury addresses to exclude from user-side mint tracking
const TREASURY_ADDRESSES = new Set([
  "0xb2289e329d2f85f1ed31adbb30ea345278f21bcf",
  "0xe8599f3cc5d38a9ad6f3684cd5cea72f10dbc383",
  "0xbe85413851d195fc6341619cd68bfdc26a25b928",
  "0x5ba7fd868c40c16f7adfae6cf87121e13fc2f7a0",
  "0x8a020d92d6b119978582be4d3edfdc9f7b28bf31",
  "0x053d55f9b5af8694c503eb288a1b7e552f590710",
  "0x464c71f6c2f760dda6093dcb91c24c39e5d6e18c",
]);

// ─── calculateUtilizationRate ────────────────────────────────────────────────

function calculateUtilizationRate(reserve: Reserve): BigDecimal {
  if (reserve.totalLiquidity === ZERO_BI) return ZERO_BD;
  return new BigDecimal(1).minus(
    new BigDecimal(reserve.availableLiquidity).div(new BigDecimal(reserve.totalLiquidity))
  );
}

// ─── saveReserve ─────────────────────────────────────────────────────────────

async function saveReserveWithParamsHistory(
  reserve: Reserve,
  historyId: string,
  timestamp: number,
  priceId: string,
  context: HandlerContext
): Promise<Reserve> {
  const updatedReserve = { ...reserve, utilizationRate: calculateUtilizationRate(reserve) };
  context.Reserve.set(updatedReserve);

  const priceAsset = await getPriceOracleAsset(
    reserve.underlyingAsset,
    priceId,
    Number(reserve.id.split("-")[0]),
    context
  );

  const item = await getOrInitReserveParamsHistoryItem(historyId, updatedReserve, context);
  context.ReserveParamsHistoryItem.set({
    ...item,
    totalScaledVariableDebt: updatedReserve.totalScaledVariableDebt,
    totalCurrentVariableDebt: updatedReserve.totalCurrentVariableDebt,
    totalPrincipalStableDebt: updatedReserve.totalPrincipalStableDebt,
    lifetimePrincipalStableDebt: updatedReserve.lifetimePrincipalStableDebt,
    lifetimeScaledVariableDebt: updatedReserve.lifetimeScaledVariableDebt,
    lifetimeCurrentVariableDebt: updatedReserve.lifetimeCurrentVariableDebt,
    lifetimeLiquidity: updatedReserve.lifetimeLiquidity,
    lifetimeBorrows: updatedReserve.lifetimeBorrows,
    lifetimeRepayments: updatedReserve.lifetimeRepayments,
    lifetimeWithdrawals: updatedReserve.lifetimeWithdrawals,
    lifetimeLiquidated: updatedReserve.lifetimeLiquidated,
    lifetimeFlashLoanPremium: updatedReserve.lifetimeFlashLoanPremium,
    lifetimeFlashLoanLPPremium: updatedReserve.lifetimeFlashLoanLPPremium,
    lifetimeFlashLoanProtocolPremium: updatedReserve.lifetimeFlashLoanProtocolPremium,
    lifetimeFlashLoans: updatedReserve.lifetimeFlashLoans,
    lifetimeReserveFactorAccrued: updatedReserve.lifetimeReserveFactorAccrued,
    lifetimeSuppliersInterestEarned: updatedReserve.lifetimeSuppliersInterestEarned,
    availableLiquidity: updatedReserve.availableLiquidity,
    totalLiquidity: updatedReserve.totalLiquidity,
    totalLiquidityAsCollateral: updatedReserve.totalLiquidityAsCollateral,
    utilizationRate: updatedReserve.utilizationRate,
    variableBorrowRate: updatedReserve.variableBorrowRate,
    variableBorrowIndex: updatedReserve.variableBorrowIndex,
    stableBorrowRate: updatedReserve.stableBorrowRate,
    liquidityIndex: updatedReserve.liquidityIndex,
    liquidityRate: updatedReserve.liquidityRate,
    totalATokenSupply: updatedReserve.totalATokenSupply,
    averageStableBorrowRate: updatedReserve.averageStableRate,
    accruedToTreasury: updatedReserve.accruedToTreasury,
    priceInEth: priceAsset.priceInEth,
    priceInUsd: new BigDecimal(priceAsset.priceInEth),
    timestamp,
  });

  return updatedReserve;
}

// ─── AToken Initialized ───────────────────────────────────────────────────────

AToken.Initialized.handler(async ({ event, context }) => {
  const chainId = event.chainId;
  const tokenAddress = event.srcAddress.toLowerCase();
  const underlyingAsset = event.params.underlyingAsset.toLowerCase();

  const token = await getOrInitSubToken(tokenAddress, chainId, context);
  context.SubToken.set({ ...token, underlyingAssetAddress: underlyingAsset });
});

// ─── StableDebtToken Initialized ─────────────────────────────────────────────

StableDebtToken.Initialized.handler(async ({ event, context }) => {
  const chainId = event.chainId;
  const tokenAddress = event.srcAddress.toLowerCase();
  const underlyingAsset = event.params.underlyingAsset.toLowerCase();

  const token = await getOrInitSubToken(tokenAddress, chainId, context);
  context.SubToken.set({ ...token, underlyingAssetAddress: underlyingAsset });
});

// ─── VariableDebtToken Initialized ───────────────────────────────────────────

VariableDebtToken.Initialized.handler(async ({ event, context }) => {
  const chainId = event.chainId;
  const tokenAddress = event.srcAddress.toLowerCase();
  const underlyingAsset = event.params.underlyingAsset.toLowerCase();

  const token = await getOrInitSubToken(tokenAddress, chainId, context);
  context.SubToken.set({ ...token, underlyingAssetAddress: underlyingAsset });
});

// ─── AToken Mint ─────────────────────────────────────────────────────────────

AToken.Mint.handler(async ({ event, context }) => {
  const chainId = event.chainId;
  const tokenAddress = event.srcAddress.toLowerCase();
  const aToken = await getOrInitSubToken(tokenAddress, chainId, context);
  const poolId = await getPoolByContract(chainId, tokenAddress, context).catch(() => null);
  if (!poolId) return;

  let reserve = await getOrInitReserve(aToken.underlyingAssetAddress, poolId, chainId, context);

  const value = event.params.value;
  const balanceIncrease = event.params.balanceIncrease;
  const index = event.params.index;
  const userBalanceChange = value - balanceIncrease;
  const onBehalf = event.params.onBehalfOf.toLowerCase();

  if (!TREASURY_ADDRESSES.has(onBehalf)) {
    const userReserve = await getOrInitUserReserve(onBehalf, aToken.underlyingAssetAddress, poolId, chainId, context);
    const calculatedAmount = rayDiv(userBalanceChange, index);

    const updatedUserReserve = {
      ...userReserve,
      scaledATokenBalance: userReserve.scaledATokenBalance + calculatedAmount,
      currentATokenBalance: rayMul(userReserve.scaledATokenBalance + calculatedAmount, index),
      liquidityRate: reserve.liquidityRate,
      variableBorrowIndex: reserve.variableBorrowIndex,
      lastUpdateTimestamp: event.block.timestamp,
    };
    context.UserReserve.set(updatedUserReserve);

    reserve = {
      ...reserve,
      totalATokenSupply: reserve.totalATokenSupply + userBalanceChange,
      totalSupplies: reserve.totalSupplies + userBalanceChange,
      availableLiquidity: reserve.availableLiquidity + userBalanceChange,
      totalLiquidity: reserve.totalLiquidity + userBalanceChange,
      lifetimeLiquidity: reserve.lifetimeLiquidity + userBalanceChange,
    };
    if (updatedUserReserve.usageAsCollateralEnabledOnUser) {
      reserve = { ...reserve, totalLiquidityAsCollateral: reserve.totalLiquidityAsCollateral + userBalanceChange };
    }

    const historyId = `${chainId}:${updatedUserReserve.id}:${event.transaction?.hash ?? ""}`;
    const aHistory: ATokenBalanceHistoryItem = {
      id: historyId,
      userReserve_id: updatedUserReserve.id,
      scaledATokenBalance: updatedUserReserve.scaledATokenBalance,
      currentATokenBalance: updatedUserReserve.currentATokenBalance,
      index,
      timestamp: event.block.timestamp,
    };
    context.ATokenBalanceHistoryItem.set(aHistory);
  } else {
    reserve = {
      ...reserve,
      lifetimeReserveFactorAccrued: reserve.lifetimeReserveFactorAccrued + userBalanceChange,
    };
  }

  const historyId = `${chainId}:${getHistoryEntityId(chainId, event.block.number, event.transaction?.hash ?? "", event.logIndex)}`;
  await saveReserveWithParamsHistory(reserve, historyId, event.block.timestamp, reserve.price_id, context);
});

// ─── AToken Burn ─────────────────────────────────────────────────────────────

AToken.Burn.handler(async ({ event, context }) => {
  const chainId = event.chainId;
  const tokenAddress = event.srcAddress.toLowerCase();
  const aToken = await getOrInitSubToken(tokenAddress, chainId, context);
  const poolId = await getPoolByContract(chainId, tokenAddress, context).catch(() => null);
  if (!poolId) return;

  let reserve = await getOrInitReserve(aToken.underlyingAssetAddress, poolId, chainId, context);
  const userReserve = await getOrInitUserReserve(
    event.params.from.toLowerCase(),
    aToken.underlyingAssetAddress,
    poolId,
    chainId,
    context
  );

  const value = event.params.value;
  const balanceIncrease = event.params.balanceIncrease;
  const index = event.params.index;
  const userBalanceChange = value + balanceIncrease;
  const calculatedAmount = rayDiv(userBalanceChange, index);

  const newScaled = userReserve.scaledATokenBalance - calculatedAmount;
  const updatedUserReserve = {
    ...userReserve,
    scaledATokenBalance: newScaled,
    currentATokenBalance: rayMul(newScaled, index),
    variableBorrowIndex: reserve.variableBorrowIndex,
    liquidityRate: reserve.liquidityRate,
    lastUpdateTimestamp: event.block.timestamp,
  };
  context.UserReserve.set(updatedUserReserve);

  reserve = {
    ...reserve,
    totalSupplies: reserve.totalSupplies - userBalanceChange,
    availableLiquidity: reserve.availableLiquidity - userBalanceChange,
    totalATokenSupply: reserve.totalATokenSupply - userBalanceChange,
    totalLiquidity: reserve.totalLiquidity - userBalanceChange,
    lifetimeWithdrawals: reserve.lifetimeWithdrawals + userBalanceChange,
  };
  if (updatedUserReserve.usageAsCollateralEnabledOnUser) {
    reserve = { ...reserve, totalLiquidityAsCollateral: reserve.totalLiquidityAsCollateral - userBalanceChange };
  }

  const historyId = `${chainId}:${getHistoryEntityId(chainId, event.block.number, event.transaction?.hash ?? "", event.logIndex)}`;
  await saveReserveWithParamsHistory(reserve, historyId, event.block.timestamp, reserve.price_id, context);

  const aHistory: ATokenBalanceHistoryItem = {
    id: `${chainId}:${updatedUserReserve.id}:${event.transaction?.hash ?? ""}`,
    userReserve_id: updatedUserReserve.id,
    scaledATokenBalance: updatedUserReserve.scaledATokenBalance,
    currentATokenBalance: updatedUserReserve.currentATokenBalance,
    index,
    timestamp: event.block.timestamp,
  };
  context.ATokenBalanceHistoryItem.set(aHistory);
});

// ─── AToken BalanceTransfer ───────────────────────────────────────────────────

AToken.BalanceTransfer.handler(async ({ event, context }) => {
  const chainId = event.chainId;
  const tokenAddress = event.srcAddress.toLowerCase();
  const aToken = await getOrInitSubToken(tokenAddress, chainId, context);
  const poolId = await getPoolByContract(chainId, tokenAddress, context).catch(() => null);
  if (!poolId) return;

  let reserve = await getOrInitReserve(aToken.underlyingAssetAddress, poolId, chainId, context);
  const index = event.params.index;

  // Post-v3.0.1 block: value represents amount; pre: value is scaled
  const v301Block = getUpdateBlock(chainId);
  let transferValue = event.params.value;
  if (event.block.number > v301Block) {
    transferValue = rayMul(transferValue, index);
  }

  // Burn from sender
  const fromReserve = await getOrInitUserReserve(
    event.params.from.toLowerCase(),
    aToken.underlyingAssetAddress,
    poolId,
    chainId,
    context
  );
  const burnCalculated = rayDiv(transferValue, index);
  const fromNewScaled = fromReserve.scaledATokenBalance - burnCalculated;
  const updatedFrom = {
    ...fromReserve,
    scaledATokenBalance: fromNewScaled,
    currentATokenBalance: rayMul(fromNewScaled, index),
    lastUpdateTimestamp: event.block.timestamp,
  };
  context.UserReserve.set(updatedFrom);

  // Mint to receiver
  const toReserve = await getOrInitUserReserve(
    event.params.to.toLowerCase(),
    aToken.underlyingAssetAddress,
    poolId,
    chainId,
    context
  );
  const toNewScaled = toReserve.scaledATokenBalance + burnCalculated;
  const updatedTo = {
    ...toReserve,
    scaledATokenBalance: toNewScaled,
    currentATokenBalance: rayMul(toNewScaled, index),
    lastUpdateTimestamp: event.block.timestamp,
  };
  context.UserReserve.set(updatedTo);

  // Adjust totalLiquidityAsCollateral if collateral status differs
  if (updatedFrom.usageAsCollateralEnabledOnUser && !updatedTo.usageAsCollateralEnabledOnUser) {
    reserve = { ...reserve, totalLiquidityAsCollateral: reserve.totalLiquidityAsCollateral - event.params.value };
    const historyId = `${chainId}:${getHistoryEntityId(chainId, event.block.number, event.transaction?.hash ?? "", event.logIndex)}`;
    await saveReserveWithParamsHistory(reserve, historyId, event.block.timestamp, reserve.price_id, context);
  } else if (!updatedFrom.usageAsCollateralEnabledOnUser && updatedTo.usageAsCollateralEnabledOnUser) {
    reserve = { ...reserve, totalLiquidityAsCollateral: reserve.totalLiquidityAsCollateral + event.params.value };
    const historyId = `${chainId}:${getHistoryEntityId(chainId, event.block.number, event.transaction?.hash ?? "", event.logIndex)}`;
    await saveReserveWithParamsHistory(reserve, historyId, event.block.timestamp, reserve.price_id, context);
  }

  // History items
  const fromHistory: ATokenBalanceHistoryItem = {
    id: `${chainId}:${updatedFrom.id}:${event.transaction?.hash ?? ""}:from`,
    userReserve_id: updatedFrom.id,
    scaledATokenBalance: updatedFrom.scaledATokenBalance,
    currentATokenBalance: updatedFrom.currentATokenBalance,
    index,
    timestamp: event.block.timestamp,
  };
  context.ATokenBalanceHistoryItem.set(fromHistory);

  const toHistory: ATokenBalanceHistoryItem = {
    id: `${chainId}:${updatedTo.id}:${event.transaction?.hash ?? ""}:to`,
    userReserve_id: updatedTo.id,
    scaledATokenBalance: updatedTo.scaledATokenBalance,
    currentATokenBalance: updatedTo.currentATokenBalance,
    index,
    timestamp: event.block.timestamp,
  };
  context.ATokenBalanceHistoryItem.set(toHistory);
});

// ─── VariableDebtToken Mint ───────────────────────────────────────────────────

VariableDebtToken.Mint.handler(async ({ event, context }) => {
  const chainId = event.chainId;
  const tokenAddress = event.srcAddress.toLowerCase();
  const vToken = await getOrInitSubToken(tokenAddress, chainId, context);
  const poolId = await getPoolByContract(chainId, tokenAddress, context).catch(() => null);
  if (!poolId) return;

  let reserve = await getOrInitReserve(vToken.underlyingAssetAddress, poolId, chainId, context);
  const from = event.params.onBehalfOf.toLowerCase();
  const value = event.params.value;
  const balanceIncrease = event.params.balanceIncrease;
  const userBalanceChange = value - balanceIncrease;
  const index = event.params.index;

  const userReserve = await getOrInitUserReserve(from, vToken.underlyingAssetAddress, poolId, chainId, context);
  const user = await getOrInitUser(from, chainId, context);

  if (userReserve.scaledVariableDebt === ZERO_BI && userReserve.principalStableDebt === ZERO_BI) {
    context.User.set({ ...user, borrowedReservesCount: user.borrowedReservesCount + 1 });
  }

  const calculatedAmount = rayDiv(userBalanceChange, index);
  const newScaled = userReserve.scaledVariableDebt + calculatedAmount;
  const updatedUserReserve = {
    ...userReserve,
    scaledVariableDebt: newScaled,
    currentVariableDebt: rayMul(newScaled, index),
    currentTotalDebt: userReserve.currentStableDebt + rayMul(newScaled, index),
    liquidityRate: reserve.liquidityRate,
    variableBorrowIndex: reserve.variableBorrowIndex,
    lastUpdateTimestamp: event.block.timestamp,
  };
  context.UserReserve.set(updatedUserReserve);

  const reserveNewScaledDebt = reserve.totalScaledVariableDebt + calculatedAmount;
  reserve = {
    ...reserve,
    totalScaledVariableDebt: reserveNewScaledDebt,
    totalCurrentVariableDebt: rayMul(reserveNewScaledDebt, index),
    lifetimeScaledVariableDebt: reserve.lifetimeScaledVariableDebt + calculatedAmount,
    lifetimeCurrentVariableDebt: rayMul(reserve.lifetimeScaledVariableDebt + calculatedAmount, index),
    availableLiquidity: reserve.availableLiquidity - userBalanceChange,
    lifetimeBorrows: reserve.lifetimeBorrows + userBalanceChange,
  };

  const historyId = `${chainId}:${getHistoryEntityId(chainId, event.block.number, event.transaction?.hash ?? "", event.logIndex)}`;
  await saveReserveWithParamsHistory(reserve, historyId, event.block.timestamp, reserve.price_id, context);

  const vHistory: VTokenBalanceHistoryItem = {
    id: `${chainId}:${updatedUserReserve.id}:${event.transaction?.hash ?? ""}`,
    userReserve_id: updatedUserReserve.id,
    scaledVariableDebt: updatedUserReserve.scaledVariableDebt,
    currentVariableDebt: updatedUserReserve.currentVariableDebt,
    index,
    timestamp: event.block.timestamp,
  };
  context.VTokenBalanceHistoryItem.set(vHistory);
});

// ─── VariableDebtToken Burn ───────────────────────────────────────────────────

VariableDebtToken.Burn.handler(async ({ event, context }) => {
  const chainId = event.chainId;
  const tokenAddress = event.srcAddress.toLowerCase();
  const vToken = await getOrInitSubToken(tokenAddress, chainId, context);
  const poolId = await getPoolByContract(chainId, tokenAddress, context).catch(() => null);
  if (!poolId) return;

  let reserve = await getOrInitReserve(vToken.underlyingAssetAddress, poolId, chainId, context);
  const from = event.params.from.toLowerCase();
  const value = event.params.value;
  const balanceIncrease = event.params.balanceIncrease;
  const userBalanceChange = value + balanceIncrease;
  const index = event.params.index;

  const userReserve = await getOrInitUserReserve(from, vToken.underlyingAssetAddress, poolId, chainId, context);
  const calculatedAmount = rayDiv(userBalanceChange, index);
  const newScaled = userReserve.scaledVariableDebt - calculatedAmount;
  const updatedUserReserve = {
    ...userReserve,
    scaledVariableDebt: newScaled,
    currentVariableDebt: rayMul(newScaled, index),
    currentTotalDebt: userReserve.currentStableDebt + rayMul(newScaled, index),
    liquidityRate: reserve.liquidityRate,
    variableBorrowIndex: reserve.variableBorrowIndex,
    lastUpdateTimestamp: event.block.timestamp,
  };
  context.UserReserve.set(updatedUserReserve);

  const user = await getOrInitUser(from, chainId, context);
  if (newScaled === ZERO_BI && updatedUserReserve.principalStableDebt === ZERO_BI) {
    context.User.set({ ...user, borrowedReservesCount: Math.max(0, user.borrowedReservesCount - 1) });
  }

  const reserveNewScaledDebt = reserve.totalScaledVariableDebt - calculatedAmount;
  reserve = {
    ...reserve,
    totalScaledVariableDebt: reserveNewScaledDebt,
    totalCurrentVariableDebt: rayMul(reserveNewScaledDebt, index),
    availableLiquidity: reserve.availableLiquidity + userBalanceChange,
    lifetimeRepayments: reserve.lifetimeRepayments + userBalanceChange,
  };

  const historyId = `${chainId}:${getHistoryEntityId(chainId, event.block.number, event.transaction?.hash ?? "", event.logIndex)}`;
  await saveReserveWithParamsHistory(reserve, historyId, event.block.timestamp, reserve.price_id, context);

  const vHistory: VTokenBalanceHistoryItem = {
    id: `${chainId}:${updatedUserReserve.id}:${event.transaction?.hash ?? ""}`,
    userReserve_id: updatedUserReserve.id,
    scaledVariableDebt: updatedUserReserve.scaledVariableDebt,
    currentVariableDebt: updatedUserReserve.currentVariableDebt,
    index,
    timestamp: event.block.timestamp,
  };
  context.VTokenBalanceHistoryItem.set(vHistory);
});

// ─── StableDebtToken Mint ─────────────────────────────────────────────────────

StableDebtToken.Mint.handler(async ({ event, context }) => {
  const chainId = event.chainId;
  const tokenAddress = event.srcAddress.toLowerCase();
  const sToken = await getOrInitSubToken(tokenAddress, chainId, context);
  const poolId = await getPoolByContract(chainId, tokenAddress, context).catch(() => null);
  if (!poolId) return;

  let reserve = await getOrInitReserve(sToken.underlyingAssetAddress, poolId, chainId, context);

  let from = event.params.user.toLowerCase();
  const onBehalfOf = event.params.onBehalfOf.toLowerCase();
  if (from !== onBehalfOf) from = onBehalfOf;

  const amount = event.params.amount;
  const balanceIncrease = event.params.balanceIncrease;
  const balanceChangeIncludingInterest = amount;
  const borrowedAmount = amount - balanceIncrease;

  const userReserve = await getOrInitUserReserve(from, sToken.underlyingAssetAddress, poolId, chainId, context);
  const user = await getOrInitUser(from, chainId, context);

  if (userReserve.scaledVariableDebt === ZERO_BI && userReserve.principalStableDebt === ZERO_BI) {
    context.User.set({ ...user, borrowedReservesCount: user.borrowedReservesCount + 1 });
  }

  reserve = {
    ...reserve,
    totalPrincipalStableDebt: event.params.newTotalSupply,
    lifetimePrincipalStableDebt: reserve.lifetimePrincipalStableDebt + balanceChangeIncludingInterest,
    averageStableRate: event.params.avgStableRate,
    lifetimeBorrows: reserve.lifetimeBorrows + borrowedAmount,
    availableLiquidity: reserve.availableLiquidity - borrowedAmount,
    totalLiquidity: reserve.totalLiquidity + balanceIncrease,
    stableDebtLastUpdateTimestamp: event.block.timestamp,
  };

  const historyId = `${chainId}:${getHistoryEntityId(chainId, event.block.number, event.transaction?.hash ?? "", event.logIndex)}`;
  await saveReserveWithParamsHistory(reserve, historyId, event.block.timestamp, reserve.price_id, context);

  const newPrincipal = userReserve.principalStableDebt + balanceChangeIncludingInterest;
  const updatedUserReserve = {
    ...userReserve,
    principalStableDebt: newPrincipal,
    currentStableDebt: newPrincipal,
    currentTotalDebt: newPrincipal + userReserve.currentVariableDebt,
    oldStableBorrowRate: userReserve.stableBorrowRate,
    stableBorrowRate: event.params.newRate,
    liquidityRate: reserve.liquidityRate,
    variableBorrowIndex: reserve.variableBorrowIndex,
    stableBorrowLastUpdateTimestamp: event.block.timestamp,
    lastUpdateTimestamp: event.block.timestamp,
  };
  context.UserReserve.set(updatedUserReserve);

  const sHistory: STokenBalanceHistoryItem = {
    id: historyId,
    userReserve_id: updatedUserReserve.id,
    principalStableDebt: updatedUserReserve.principalStableDebt,
    currentStableDebt: updatedUserReserve.currentStableDebt,
    avgStableBorrowRate: event.params.avgStableRate,
    timestamp: event.block.timestamp,
  };
  context.STokenBalanceHistoryItem.set(sHistory);
});

// ─── StableDebtToken Burn ─────────────────────────────────────────────────────

StableDebtToken.Burn.handler(async ({ event, context }) => {
  const chainId = event.chainId;
  const tokenAddress = event.srcAddress.toLowerCase();
  const sToken = await getOrInitSubToken(tokenAddress, chainId, context);
  const poolId = await getPoolByContract(chainId, tokenAddress, context).catch(() => null);
  if (!poolId) return;

  let reserve = await getOrInitReserve(sToken.underlyingAssetAddress, poolId, chainId, context);
  const from = event.params.from.toLowerCase();
  const amount = event.params.amount;
  const balanceIncrease = event.params.balanceIncrease;

  reserve = {
    ...reserve,
    totalPrincipalStableDebt: event.params.newTotalSupply,
    lifetimeRepayments: reserve.lifetimeRepayments + amount,
    averageStableRate: event.params.avgStableRate,
    stableDebtLastUpdateTimestamp: event.block.timestamp,
    availableLiquidity: reserve.availableLiquidity + amount + balanceIncrease,
    totalLiquidity: reserve.totalLiquidity + balanceIncrease,
    totalATokenSupply: reserve.totalATokenSupply + balanceIncrease,
  };

  const historyId = `${chainId}:${getHistoryEntityId(chainId, event.block.number, event.transaction?.hash ?? "", event.logIndex)}`;
  await saveReserveWithParamsHistory(reserve, historyId, event.block.timestamp, reserve.price_id, context);

  const userReserve = await getOrInitUserReserve(from, sToken.underlyingAssetAddress, poolId, chainId, context);
  const newPrincipal = userReserve.principalStableDebt - amount;
  const updatedUserReserve = {
    ...userReserve,
    principalStableDebt: newPrincipal,
    currentStableDebt: newPrincipal,
    currentTotalDebt: newPrincipal + userReserve.currentVariableDebt,
    liquidityRate: reserve.liquidityRate,
    variableBorrowIndex: reserve.variableBorrowIndex,
    stableBorrowLastUpdateTimestamp: event.block.timestamp,
    lastUpdateTimestamp: event.block.timestamp,
  };
  context.UserReserve.set(updatedUserReserve);

  const user = await getOrInitUser(from, chainId, context);
  if (newPrincipal === ZERO_BI && updatedUserReserve.scaledVariableDebt === ZERO_BI) {
    context.User.set({ ...user, borrowedReservesCount: Math.max(0, user.borrowedReservesCount - 1) });
  }

  const sHistory: STokenBalanceHistoryItem = {
    id: historyId,
    userReserve_id: updatedUserReserve.id,
    principalStableDebt: updatedUserReserve.principalStableDebt,
    currentStableDebt: updatedUserReserve.currentStableDebt,
    avgStableBorrowRate: event.params.avgStableRate,
    timestamp: event.block.timestamp,
  };
  context.STokenBalanceHistoryItem.set(sHistory);
});

// ─── StableDebtToken BorrowAllowanceDelegated ─────────────────────────────────

StableDebtToken.BorrowAllowanceDelegated.handler(async ({ event, context }) => {
  const chainId = event.chainId;
  const fromUser = event.params.fromUser.toLowerCase();
  const toUser = event.params.toUser.toLowerCase();
  const asset = event.params.asset.toLowerCase();
  const poolId = await getPoolByContract(chainId, event.srcAddress.toLowerCase(), context).catch(() => null);
  if (!poolId) return;

  const userReserve = await getOrInitUserReserve(fromUser, asset, poolId, chainId, context);
  const fromUserEntity = await getOrInitUser(fromUser, chainId, context);
  const toUserEntity = await getOrInitUser(toUser, chainId, context);

  const delegatedId = `${chainId}-stable-${fromUser}-${toUser}-${asset}`;
  const existing = await context.StableTokenDelegatedAllowance.get(delegatedId);

  const delegation: StableTokenDelegatedAllowance = {
    id: delegatedId,
    fromUser_id: fromUserEntity.id,
    toUser_id: toUserEntity.id,
    amountAllowed: event.params.amount,
    userReserve_id: userReserve.id,
  };
  context.StableTokenDelegatedAllowance.set(delegation);
});

// ─── VariableDebtToken BorrowAllowanceDelegated ───────────────────────────────

VariableDebtToken.BorrowAllowanceDelegated.handler(async ({ event, context }) => {
  const chainId = event.chainId;
  const fromUser = event.params.fromUser.toLowerCase();
  const toUser = event.params.toUser.toLowerCase();
  const asset = event.params.asset.toLowerCase();
  const poolId = await getPoolByContract(chainId, event.srcAddress.toLowerCase(), context).catch(() => null);
  if (!poolId) return;

  const userReserve = await getOrInitUserReserve(fromUser, asset, poolId, chainId, context);
  const fromUserEntity = await getOrInitUser(fromUser, chainId, context);
  const toUserEntity = await getOrInitUser(toUser, chainId, context);

  const delegatedId = `${chainId}-variable-${fromUser}-${toUser}-${asset}`;

  const delegation: VariableTokenDelegatedAllowance = {
    id: delegatedId,
    fromUser_id: fromUserEntity.id,
    toUser_id: toUserEntity.id,
    amountAllowed: event.params.amount,
    userReserve_id: userReserve.id,
  };
  context.VariableTokenDelegatedAllowance.set(delegation);
});
