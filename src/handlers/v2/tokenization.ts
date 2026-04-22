import { V2AToken, V2StableDebtToken, V2VariableDebtToken } from "generated";
import type {
  HandlerContext,
  ATokenBalanceHistoryItem,
  VTokenBalanceHistoryItem,
  STokenBalanceHistoryItem,
  MapAssetPool,
  StableTokenDelegatedAllowance,
  VariableTokenDelegatedAllowance,
  Reserve,
} from "generated";
import {
  getOrInitUserReserve,
  getOrInitReserve,
  getPoolByContract,
} from "../../helpers/v3/initializers";
import { getHistoryEntityId } from "../../utils/id-generation";
import { ZERO_BI } from "../../utils/constants";
import { rayMul } from "../../helpers/math";

// ─── V2AToken.Initialized ─────────────────────────────────────────────────────

V2AToken.Initialized.handler(async ({ event, context }) => {
  const chainId = event.chainId;
  const tokenAddress = event.srcAddress.toLowerCase();
  const underlyingAsset = event.params.underlyingAsset.toLowerCase();
  const tokenId = `${chainId}-${tokenAddress}`;

  const existing = await context.SubToken.get(tokenId);
  if (existing) {
    context.SubToken.set({
      ...existing,
      underlyingAssetAddress: underlyingAsset,
      underlyingAssetDecimals: Number(event.params.aTokenDecimals),
    });
  } else {
    const poolId = `${chainId}-${event.params.pool.toLowerCase()}`;
    context.SubToken.set({
      id: tokenId,
      pool_id: poolId,
      underlyingAssetAddress: underlyingAsset,
      underlyingAssetDecimals: Number(event.params.aTokenDecimals),
      tokenContractImpl: undefined,
    });
  }

  // MapAssetPool: aToken → underlying + pool (for incentives controller)
  const mapId = `${chainId}-${tokenAddress}`;
  context.MapAssetPool.set({
    id: mapId,
    pool: `${chainId}-${event.params.pool.toLowerCase()}`,
    underlyingAsset,
  });
});

// ─── V2AToken.Mint ────────────────────────────────────────────────────────────

V2AToken.Mint.handler(async ({ event, context }) => {
  const chainId = event.chainId;
  const tokenAddress = event.srcAddress.toLowerCase();
  const userAddress = event.params.from.toLowerCase();

  const mapEntry = await context.MapAssetPool.get(`${chainId}-${tokenAddress}`);
  if (!mapEntry) return;

  const asset = mapEntry.underlyingAsset;
  const poolId = mapEntry.pool;

  const reserve = await getOrInitReserve(asset, poolId, chainId, context);
  const userReserve = await getOrInitUserReserve(userAddress, asset, poolId, chainId, context);

  const scaledBalance = userReserve.scaledATokenBalance + event.params.value;
  const currentBalance = rayMul(scaledBalance, event.params.index);

  context.UserReserve.set({
    ...userReserve,
    scaledATokenBalance: scaledBalance,
    currentATokenBalance: currentBalance,
    lastUpdateTimestamp: event.block.timestamp,
  });

  context.Reserve.set({
    ...reserve,
    totalATokenSupply: reserve.totalATokenSupply + event.params.value,
    lifetimeLiquidity: reserve.lifetimeLiquidity + event.params.value,
    lastUpdateTimestamp: event.block.timestamp,
  });

  const historyId = `${userReserve.id}:${getHistoryEntityId(chainId, event.block.number, event.transaction?.hash ?? "", event.logIndex)}`;
  const history: ATokenBalanceHistoryItem = {
    id: historyId,
    userReserve_id: userReserve.id,
    timestamp: event.block.timestamp,
    scaledATokenBalance: scaledBalance,
    currentATokenBalance: currentBalance,
    index: event.params.index,
  };
  context.ATokenBalanceHistoryItem.set(history);
});

// ─── V2AToken.Burn ────────────────────────────────────────────────────────────

V2AToken.Burn.handler(async ({ event, context }) => {
  const chainId = event.chainId;
  const tokenAddress = event.srcAddress.toLowerCase();
  const userAddress = event.params.from.toLowerCase();

  const mapEntry = await context.MapAssetPool.get(`${chainId}-${tokenAddress}`);
  if (!mapEntry) return;

  const asset = mapEntry.underlyingAsset;
  const poolId = mapEntry.pool;

  const reserve = await getOrInitReserve(asset, poolId, chainId, context);
  const userReserve = await getOrInitUserReserve(userAddress, asset, poolId, chainId, context);

  const scaledBalance = userReserve.scaledATokenBalance - event.params.value;
  const currentBalance = scaledBalance > 0n ? rayMul(scaledBalance, event.params.index) : 0n;

  context.UserReserve.set({
    ...userReserve,
    scaledATokenBalance: scaledBalance < 0n ? 0n : scaledBalance,
    currentATokenBalance: currentBalance,
    lastUpdateTimestamp: event.block.timestamp,
  });

  context.Reserve.set({
    ...reserve,
    totalATokenSupply: reserve.totalATokenSupply > event.params.value
      ? reserve.totalATokenSupply - event.params.value
      : 0n,
    lifetimeWithdrawals: reserve.lifetimeWithdrawals + event.params.value,
    lastUpdateTimestamp: event.block.timestamp,
  });

  const historyId = `${userReserve.id}:${getHistoryEntityId(chainId, event.block.number, event.transaction?.hash ?? "", event.logIndex)}`;
  const history: ATokenBalanceHistoryItem = {
    id: historyId,
    userReserve_id: userReserve.id,
    timestamp: event.block.timestamp,
    scaledATokenBalance: scaledBalance < 0n ? 0n : scaledBalance,
    currentATokenBalance: currentBalance,
    index: event.params.index,
  };
  context.ATokenBalanceHistoryItem.set(history);
});

// ─── V2AToken.BalanceTransfer ─────────────────────────────────────────────────

V2AToken.BalanceTransfer.handler(async ({ event, context }) => {
  const chainId = event.chainId;
  const tokenAddress = event.srcAddress.toLowerCase();
  const fromAddress = event.params.from.toLowerCase();
  const toAddress = event.params.to.toLowerCase();

  const mapEntry = await context.MapAssetPool.get(`${chainId}-${tokenAddress}`);
  if (!mapEntry) return;

  const asset = mapEntry.underlyingAsset;
  const poolId = mapEntry.pool;

  const fromReserve = await getOrInitUserReserve(fromAddress, asset, poolId, chainId, context);
  const toReserve = await getOrInitUserReserve(toAddress, asset, poolId, chainId, context);

  // V2: value is already scaled (not multiplied by index)
  const transferValue = event.params.value;

  const fromScaled = fromReserve.scaledATokenBalance - transferValue;
  const toScaled = toReserve.scaledATokenBalance + transferValue;

  context.UserReserve.set({
    ...fromReserve,
    scaledATokenBalance: fromScaled < 0n ? 0n : fromScaled,
    currentATokenBalance: fromScaled > 0n ? rayMul(fromScaled, event.params.index) : 0n,
    lastUpdateTimestamp: event.block.timestamp,
  });

  context.UserReserve.set({
    ...toReserve,
    scaledATokenBalance: toScaled,
    currentATokenBalance: rayMul(toScaled, event.params.index),
    lastUpdateTimestamp: event.block.timestamp,
  });
});

// ─── V2StableDebtToken.Initialized ───────────────────────────────────────────

V2StableDebtToken.Initialized.handler(async ({ event, context }) => {
  const chainId = event.chainId;
  const tokenAddress = event.srcAddress.toLowerCase();
  const underlyingAsset = event.params.underlyingAsset.toLowerCase();
  const tokenId = `${chainId}-${tokenAddress}`;

  const existing = await context.SubToken.get(tokenId);
  if (existing) {
    context.SubToken.set({
      ...existing,
      underlyingAssetAddress: underlyingAsset,
      underlyingAssetDecimals: Number(event.params.debtTokenDecimals),
    });
  } else {
    const poolId = `${chainId}-${event.params.pool.toLowerCase()}`;
    context.SubToken.set({
      id: tokenId,
      pool_id: poolId,
      underlyingAssetAddress: underlyingAsset,
      underlyingAssetDecimals: Number(event.params.debtTokenDecimals),
      tokenContractImpl: undefined,
    });
  }

  context.MapAssetPool.set({
    id: `${chainId}-${tokenAddress}`,
    pool: `${chainId}-${event.params.pool.toLowerCase()}`,
    underlyingAsset,
  });
});

// ─── V2StableDebtToken.Mint ───────────────────────────────────────────────────

V2StableDebtToken.Mint.handler(async ({ event, context }) => {
  const chainId = event.chainId;
  const tokenAddress = event.srcAddress.toLowerCase();
  const onBehalfOf = event.params.onBehalfOf.toLowerCase();

  const mapEntry = await context.MapAssetPool.get(`${chainId}-${tokenAddress}`);
  if (!mapEntry) return;

  const asset = mapEntry.underlyingAsset;
  const poolId = mapEntry.pool;

  const reserve = await getOrInitReserve(asset, poolId, chainId, context);
  const userReserve = await getOrInitUserReserve(onBehalfOf, asset, poolId, chainId, context);

  const newPrincipal = userReserve.principalStableDebt + event.params.amount;

  context.UserReserve.set({
    ...userReserve,
    principalStableDebt: newPrincipal,
    currentStableDebt: event.params.currentBalance + event.params.amount,
    stableBorrowRate: event.params.newRate,
    oldStableBorrowRate: userReserve.stableBorrowRate,
    stableBorrowLastUpdateTimestamp: event.block.timestamp,
    lastUpdateTimestamp: event.block.timestamp,
  });

  context.Reserve.set({
    ...reserve,
    totalPrincipalStableDebt: event.params.newTotalSupply,
    averageStableRate: event.params.avgStableRate,
    lifetimePrincipalStableDebt: reserve.lifetimePrincipalStableDebt + event.params.amount,
    stableDebtLastUpdateTimestamp: event.block.timestamp,
    lastUpdateTimestamp: event.block.timestamp,
  });

  const historyId = `${userReserve.id}:${getHistoryEntityId(chainId, event.block.number, event.transaction?.hash ?? "", event.logIndex)}`;
  const history: STokenBalanceHistoryItem = {
    id: historyId,
    userReserve_id: userReserve.id,
    principalStableDebt: newPrincipal,
    currentStableDebt: event.params.currentBalance + event.params.amount,
    timestamp: event.block.timestamp,
    avgStableBorrowRate: event.params.avgStableRate,
  };
  context.STokenBalanceHistoryItem.set(history);
});

// ─── V2StableDebtToken.Burn ───────────────────────────────────────────────────

V2StableDebtToken.Burn.handler(async ({ event, context }) => {
  const chainId = event.chainId;
  const tokenAddress = event.srcAddress.toLowerCase();
  const userAddress = event.params.user.toLowerCase();

  const mapEntry = await context.MapAssetPool.get(`${chainId}-${tokenAddress}`);
  if (!mapEntry) return;

  const asset = mapEntry.underlyingAsset;
  const poolId = mapEntry.pool;

  const reserve = await getOrInitReserve(asset, poolId, chainId, context);
  const userReserve = await getOrInitUserReserve(userAddress, asset, poolId, chainId, context);

  const newPrincipal = userReserve.principalStableDebt > event.params.amount
    ? userReserve.principalStableDebt - event.params.amount
    : 0n;

  context.UserReserve.set({
    ...userReserve,
    principalStableDebt: newPrincipal,
    currentStableDebt: event.params.currentBalance > event.params.amount
      ? event.params.currentBalance - event.params.amount
      : 0n,
    stableBorrowLastUpdateTimestamp: event.block.timestamp,
    lastUpdateTimestamp: event.block.timestamp,
  });

  context.Reserve.set({
    ...reserve,
    totalPrincipalStableDebt: event.params.newTotalSupply,
    averageStableRate: event.params.avgStableRate,
    stableDebtLastUpdateTimestamp: event.block.timestamp,
    lastUpdateTimestamp: event.block.timestamp,
  });

  const historyId = `${userReserve.id}:${getHistoryEntityId(chainId, event.block.number, event.transaction?.hash ?? "", event.logIndex)}`;
  const history: STokenBalanceHistoryItem = {
    id: historyId,
    userReserve_id: userReserve.id,
    principalStableDebt: newPrincipal,
    currentStableDebt: event.params.currentBalance > event.params.amount
      ? event.params.currentBalance - event.params.amount
      : 0n,
    timestamp: event.block.timestamp,
    avgStableBorrowRate: event.params.avgStableRate,
  };
  context.STokenBalanceHistoryItem.set(history);
});

// ─── V2StableDebtToken.BorrowAllowanceDelegated ───────────────────────────────

V2StableDebtToken.BorrowAllowanceDelegated.handler(async ({ event, context }) => {
  const chainId = event.chainId;
  const tokenAddress = event.srcAddress.toLowerCase();
  const fromUser = event.params.fromUser.toLowerCase();
  const toUser = event.params.toUser.toLowerCase();
  const asset = event.params.asset.toLowerCase();

  const mapEntry = await context.MapAssetPool.get(`${chainId}-${tokenAddress}`);
  if (!mapEntry) return;
  const poolId = mapEntry.pool;

  const fromReserve = await getOrInitUserReserve(fromUser, asset, poolId, chainId, context);
  await getOrInitUserReserve(toUser, asset, poolId, chainId, context);

  const delegationId = `stable-${chainId}-${fromUser}-${toUser}-${asset}`;
  const delegation: StableTokenDelegatedAllowance = {
    id: delegationId,
    fromUser_id: fromReserve.user_id,
    toUser_id: `${chainId}-${toUser}`,
    amountAllowed: event.params.amount,
    userReserve_id: fromReserve.id,
  };
  context.StableTokenDelegatedAllowance.set(delegation);
});

// ─── V2VariableDebtToken.Initialized ─────────────────────────────────────────

V2VariableDebtToken.Initialized.handler(async ({ event, context }) => {
  const chainId = event.chainId;
  const tokenAddress = event.srcAddress.toLowerCase();
  const underlyingAsset = event.params.underlyingAsset.toLowerCase();
  const tokenId = `${chainId}-${tokenAddress}`;

  const existing = await context.SubToken.get(tokenId);
  if (existing) {
    context.SubToken.set({
      ...existing,
      underlyingAssetAddress: underlyingAsset,
      underlyingAssetDecimals: Number(event.params.debtTokenDecimals),
    });
  } else {
    const poolId = `${chainId}-${event.params.pool.toLowerCase()}`;
    context.SubToken.set({
      id: tokenId,
      pool_id: poolId,
      underlyingAssetAddress: underlyingAsset,
      underlyingAssetDecimals: Number(event.params.debtTokenDecimals),
      tokenContractImpl: undefined,
    });
  }

  context.MapAssetPool.set({
    id: `${chainId}-${tokenAddress}`,
    pool: `${chainId}-${event.params.pool.toLowerCase()}`,
    underlyingAsset,
  });
});

// ─── V2VariableDebtToken.Mint ─────────────────────────────────────────────────

V2VariableDebtToken.Mint.handler(async ({ event, context }) => {
  const chainId = event.chainId;
  const tokenAddress = event.srcAddress.toLowerCase();
  const onBehalfOf = event.params.onBehalfOf.toLowerCase();

  const mapEntry = await context.MapAssetPool.get(`${chainId}-${tokenAddress}`);
  if (!mapEntry) return;

  const asset = mapEntry.underlyingAsset;
  const poolId = mapEntry.pool;

  const reserve = await getOrInitReserve(asset, poolId, chainId, context);
  const userReserve = await getOrInitUserReserve(onBehalfOf, asset, poolId, chainId, context);

  const newScaled = userReserve.scaledVariableDebt + event.params.value;
  const newCurrent = rayMul(newScaled, event.params.index);

  context.UserReserve.set({
    ...userReserve,
    scaledVariableDebt: newScaled,
    currentVariableDebt: newCurrent,
    lastUpdateTimestamp: event.block.timestamp,
  });

  context.Reserve.set({
    ...reserve,
    totalScaledVariableDebt: reserve.totalScaledVariableDebt + event.params.value,
    totalCurrentVariableDebt: reserve.totalCurrentVariableDebt + newCurrent,
    lifetimeScaledVariableDebt: reserve.lifetimeScaledVariableDebt + event.params.value,
    lastUpdateTimestamp: event.block.timestamp,
  });

  const historyId = `${userReserve.id}:${getHistoryEntityId(chainId, event.block.number, event.transaction?.hash ?? "", event.logIndex)}`;
  const history: VTokenBalanceHistoryItem = {
    id: historyId,
    userReserve_id: userReserve.id,
    scaledVariableDebt: newScaled,
    currentVariableDebt: newCurrent,
    timestamp: event.block.timestamp,
    index: event.params.index,
  };
  context.VTokenBalanceHistoryItem.set(history);
});

// ─── V2VariableDebtToken.Burn ─────────────────────────────────────────────────

V2VariableDebtToken.Burn.handler(async ({ event, context }) => {
  const chainId = event.chainId;
  const tokenAddress = event.srcAddress.toLowerCase();
  const userAddress = event.params.user.toLowerCase();

  const mapEntry = await context.MapAssetPool.get(`${chainId}-${tokenAddress}`);
  if (!mapEntry) return;

  const asset = mapEntry.underlyingAsset;
  const poolId = mapEntry.pool;

  const reserve = await getOrInitReserve(asset, poolId, chainId, context);
  const userReserve = await getOrInitUserReserve(userAddress, asset, poolId, chainId, context);

  // V2 Burn: amount is actual amount, index is current variableBorrowIndex
  // Scaled amount = amount / index (convert to scaled)
  const scaledRepaid = event.params.amount > 0n
    ? (event.params.amount * BigInt("1000000000000000000000000000")) / event.params.index
    : 0n;

  const newScaled = userReserve.scaledVariableDebt > scaledRepaid
    ? userReserve.scaledVariableDebt - scaledRepaid
    : 0n;
  const newCurrent = newScaled > 0n ? rayMul(newScaled, event.params.index) : 0n;

  context.UserReserve.set({
    ...userReserve,
    scaledVariableDebt: newScaled,
    currentVariableDebt: newCurrent,
    lastUpdateTimestamp: event.block.timestamp,
  });

  context.Reserve.set({
    ...reserve,
    totalScaledVariableDebt: reserve.totalScaledVariableDebt > scaledRepaid
      ? reserve.totalScaledVariableDebt - scaledRepaid
      : 0n,
    lastUpdateTimestamp: event.block.timestamp,
  });

  const historyId = `${userReserve.id}:${getHistoryEntityId(chainId, event.block.number, event.transaction?.hash ?? "", event.logIndex)}`;
  const history: VTokenBalanceHistoryItem = {
    id: historyId,
    userReserve_id: userReserve.id,
    scaledVariableDebt: newScaled,
    currentVariableDebt: newCurrent,
    timestamp: event.block.timestamp,
    index: event.params.index,
  };
  context.VTokenBalanceHistoryItem.set(history);
});

// ─── V2VariableDebtToken.BorrowAllowanceDelegated ─────────────────────────────

V2VariableDebtToken.BorrowAllowanceDelegated.handler(async ({ event, context }) => {
  const chainId = event.chainId;
  const tokenAddress = event.srcAddress.toLowerCase();
  const fromUser = event.params.fromUser.toLowerCase();
  const toUser = event.params.toUser.toLowerCase();
  const asset = event.params.asset.toLowerCase();

  const mapEntry = await context.MapAssetPool.get(`${chainId}-${tokenAddress}`);
  if (!mapEntry) return;
  const poolId = mapEntry.pool;

  const fromReserve = await getOrInitUserReserve(fromUser, asset, poolId, chainId, context);
  await getOrInitUserReserve(toUser, asset, poolId, chainId, context);

  const delegationId = `variable-${chainId}-${fromUser}-${toUser}-${asset}`;
  const delegation: VariableTokenDelegatedAllowance = {
    id: delegationId,
    fromUser_id: fromReserve.user_id,
    toUser_id: `${chainId}-${toUser}`,
    amountAllowed: event.params.amount,
    userReserve_id: fromReserve.id,
  };
  context.VariableTokenDelegatedAllowance.set(delegation);
});
