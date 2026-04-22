import { LendingPoolConfigurator } from "generated";
import type { HandlerContext, ReserveConfigurationHistoryItem, Reserve } from "generated";
import {
  getOrInitReserve,
  getPoolByContract,
} from "../../helpers/v3/initializers";
import { getHistoryEntityId } from "../../utils/id-generation";
import { ZERO_BI, ZERO_ADDRESS } from "../../utils/constants";

// ─── Helper: register V2AToken/SToken/VToken as dynamic contracts ────────────

LendingPoolConfigurator.ReserveInitialized.contractRegister(({ event, context }) => {
  context.addV2AToken(event.params.aToken);
  context.addV2StableDebtToken(event.params.stableDebtToken);
  context.addV2VariableDebtToken(event.params.variableDebtToken);
});

// ─── Helper: save reserve config history snapshot ────────────────────────────

async function saveReserveWithConfigHistory(
  reserve: Reserve,
  chainId: number,
  blockNumber: number,
  txHash: string,
  logIndex: number,
  timestamp: number,
  context: HandlerContext
): Promise<void> {
  const updatedReserve = { ...reserve, lastUpdateTimestamp: timestamp };
  context.Reserve.set(updatedReserve);

  const historyId = `${reserve.id}:${getHistoryEntityId(chainId, blockNumber, txHash, logIndex)}`;
  const history: ReserveConfigurationHistoryItem = {
    id: historyId,
    reserve_id: reserve.id,
    usageAsCollateralEnabled: reserve.usageAsCollateralEnabled,
    borrowingEnabled: reserve.borrowingEnabled,
    stableBorrowRateEnabled: reserve.stableBorrowRateEnabled,
    isActive: reserve.isActive,
    isFrozen: reserve.isFrozen,
    reserveInterestRateStrategy: reserve.reserveInterestRateStrategy,
    baseLTVasCollateral: reserve.baseLTVasCollateral,
    reserveLiquidationThreshold: reserve.reserveLiquidationThreshold,
    reserveLiquidationBonus: reserve.reserveLiquidationBonus,
    timestamp,
  };
  context.ReserveConfigurationHistoryItem.set(history);
}

// ─── LendingPoolConfigurator.ReserveInitialized ──────────────────────────────

LendingPoolConfigurator.ReserveInitialized.handler(async ({ event, context }) => {
  const chainId = event.chainId;
  const asset = event.params.asset.toLowerCase();
  const aTokenAddress = event.params.aToken.toLowerCase();
  const sTokenAddress = event.params.stableDebtToken.toLowerCase();
  const vTokenAddress = event.params.variableDebtToken.toLowerCase();

  const poolId = await getPoolByContract(chainId, event.srcAddress, context).catch(() => null);
  if (!poolId) return;

  const reserve = await getOrInitReserve(asset, poolId, chainId, context);

  // Update token references
  const aTokenId = `${chainId}-${aTokenAddress}`;
  const sTokenId = `${chainId}-${sTokenAddress}`;
  const vTokenId = `${chainId}-${vTokenAddress}`;

  context.Reserve.set({
    ...reserve,
    aToken_id: aTokenId,
    sToken_id: sTokenId,
    vToken_id: vTokenId,
    isActive: true,
    lastUpdateTimestamp: event.block.timestamp,
  });

  // Init SubToken entities (same as V3 SubToken)
  for (const [id, addr] of [[aTokenId, aTokenAddress], [sTokenId, sTokenAddress], [vTokenId, vTokenAddress]] as [string, string][]) {
    const existing = await context.SubToken.get(id);
    if (!existing) {
      context.SubToken.set({
        id,
        pool_id: poolId,
        underlyingAssetAddress: asset,
        underlyingAssetDecimals: 0,
        tokenContractImpl: undefined,
      });
    }
  }

  // Interest rate params: TODO fetch via Effect API (DefaultReserveInterestRateStrategy)
  context.Reserve.set({
    ...reserve,
    aToken_id: aTokenId,
    sToken_id: sTokenId,
    vToken_id: vTokenId,
    isActive: true,
    reserveInterestRateStrategy: event.params.interestRateStrategyAddress.toLowerCase(),
    lastUpdateTimestamp: event.block.timestamp,
    aEmissionPerSecond: ZERO_BI,
    vEmissionPerSecond: ZERO_BI,
    sEmissionPerSecond: ZERO_BI,
    aTokenIncentivesIndex: ZERO_BI,
    vTokenIncentivesIndex: ZERO_BI,
    sTokenIncentivesIndex: ZERO_BI,
    aIncentivesLastUpdateTimestamp: 0,
    vIncentivesLastUpdateTimestamp: 0,
    sIncentivesLastUpdateTimestamp: 0,
  });
});

// ─── Reserve config events ────────────────────────────────────────────────────

LendingPoolConfigurator.BorrowingEnabledOnReserve.handler(async ({ event, context }) => {
  const chainId = event.chainId;
  const asset = event.params.asset.toLowerCase();
  const poolId = await getPoolByContract(chainId, event.srcAddress, context).catch(() => null);
  if (!poolId) return;
  const reserve = await getOrInitReserve(asset, poolId, chainId, context);
  const updated = { ...reserve, borrowingEnabled: true, stableBorrowRateEnabled: event.params.stableRateEnabled };
  await saveReserveWithConfigHistory(updated, chainId, event.block.number, event.transaction?.hash ?? "", event.logIndex, event.block.timestamp, context);
});

LendingPoolConfigurator.BorrowingDisabledOnReserve.handler(async ({ event, context }) => {
  const chainId = event.chainId;
  const asset = event.params.asset.toLowerCase();
  const poolId = await getPoolByContract(chainId, event.srcAddress, context).catch(() => null);
  if (!poolId) return;
  const reserve = await getOrInitReserve(asset, poolId, chainId, context);
  const updated = { ...reserve, borrowingEnabled: false };
  await saveReserveWithConfigHistory(updated, chainId, event.block.number, event.transaction?.hash ?? "", event.logIndex, event.block.timestamp, context);
});

LendingPoolConfigurator.StableRateEnabledOnReserve.handler(async ({ event, context }) => {
  const chainId = event.chainId;
  const asset = event.params.asset.toLowerCase();
  const poolId = await getPoolByContract(chainId, event.srcAddress, context).catch(() => null);
  if (!poolId) return;
  const reserve = await getOrInitReserve(asset, poolId, chainId, context);
  const updated = { ...reserve, stableBorrowRateEnabled: true };
  await saveReserveWithConfigHistory(updated, chainId, event.block.number, event.transaction?.hash ?? "", event.logIndex, event.block.timestamp, context);
});

LendingPoolConfigurator.StableRateDisabledOnReserve.handler(async ({ event, context }) => {
  const chainId = event.chainId;
  const asset = event.params.asset.toLowerCase();
  const poolId = await getPoolByContract(chainId, event.srcAddress, context).catch(() => null);
  if (!poolId) return;
  const reserve = await getOrInitReserve(asset, poolId, chainId, context);
  const updated = { ...reserve, stableBorrowRateEnabled: false };
  await saveReserveWithConfigHistory(updated, chainId, event.block.number, event.transaction?.hash ?? "", event.logIndex, event.block.timestamp, context);
});

LendingPoolConfigurator.ReserveActivated.handler(async ({ event, context }) => {
  const chainId = event.chainId;
  const asset = event.params.asset.toLowerCase();
  const poolId = await getPoolByContract(chainId, event.srcAddress, context).catch(() => null);
  if (!poolId) return;
  const reserve = await getOrInitReserve(asset, poolId, chainId, context);
  const updated = { ...reserve, isActive: true };
  await saveReserveWithConfigHistory(updated, chainId, event.block.number, event.transaction?.hash ?? "", event.logIndex, event.block.timestamp, context);
});

LendingPoolConfigurator.ReserveDeactivated.handler(async ({ event, context }) => {
  const chainId = event.chainId;
  const asset = event.params.asset.toLowerCase();
  const poolId = await getPoolByContract(chainId, event.srcAddress, context).catch(() => null);
  if (!poolId) return;
  const reserve = await getOrInitReserve(asset, poolId, chainId, context);
  const updated = { ...reserve, isActive: false };
  await saveReserveWithConfigHistory(updated, chainId, event.block.number, event.transaction?.hash ?? "", event.logIndex, event.block.timestamp, context);
});

LendingPoolConfigurator.ReserveFrozen.handler(async ({ event, context }) => {
  const chainId = event.chainId;
  const asset = event.params.asset.toLowerCase();
  const poolId = await getPoolByContract(chainId, event.srcAddress, context).catch(() => null);
  if (!poolId) return;
  const reserve = await getOrInitReserve(asset, poolId, chainId, context);
  const updated = { ...reserve, isFrozen: true };
  await saveReserveWithConfigHistory(updated, chainId, event.block.number, event.transaction?.hash ?? "", event.logIndex, event.block.timestamp, context);
});

LendingPoolConfigurator.ReserveUnfrozen.handler(async ({ event, context }) => {
  const chainId = event.chainId;
  const asset = event.params.asset.toLowerCase();
  const poolId = await getPoolByContract(chainId, event.srcAddress, context).catch(() => null);
  if (!poolId) return;
  const reserve = await getOrInitReserve(asset, poolId, chainId, context);
  const updated = { ...reserve, isFrozen: false };
  await saveReserveWithConfigHistory(updated, chainId, event.block.number, event.transaction?.hash ?? "", event.logIndex, event.block.timestamp, context);
});

LendingPoolConfigurator.CollateralConfigurationChanged.handler(async ({ event, context }) => {
  const chainId = event.chainId;
  const asset = event.params.asset.toLowerCase();
  const poolId = await getPoolByContract(chainId, event.srcAddress, context).catch(() => null);
  if (!poolId) return;
  const reserve = await getOrInitReserve(asset, poolId, chainId, context);
  const updated = {
    ...reserve,
    usageAsCollateralEnabled: event.params.liquidationThreshold > 0n,
    baseLTVasCollateral: event.params.ltv,
    reserveLiquidationThreshold: event.params.liquidationThreshold,
    reserveLiquidationBonus: event.params.liquidationBonus,
  };
  await saveReserveWithConfigHistory(updated, chainId, event.block.number, event.transaction?.hash ?? "", event.logIndex, event.block.timestamp, context);
});

LendingPoolConfigurator.ReserveInterestRateStrategyChanged.handler(async ({ event, context }) => {
  const chainId = event.chainId;
  const asset = event.params.asset.toLowerCase();
  const poolId = await getPoolByContract(chainId, event.srcAddress, context).catch(() => null);
  if (!poolId) return;
  const reserve = await getOrInitReserve(asset, poolId, chainId, context);
  // TODO: fetch interest rate params via Effect API (DefaultReserveInterestRateStrategy)
  const updated = { ...reserve, reserveInterestRateStrategy: event.params.strategy.toLowerCase() };
  await saveReserveWithConfigHistory(updated, chainId, event.block.number, event.transaction?.hash ?? "", event.logIndex, event.block.timestamp, context);
});

LendingPoolConfigurator.ReserveFactorChanged.handler(async ({ event, context }) => {
  const chainId = event.chainId;
  const asset = event.params.asset.toLowerCase();
  const poolId = await getPoolByContract(chainId, event.srcAddress, context).catch(() => null);
  if (!poolId) return;
  const reserve = await getOrInitReserve(asset, poolId, chainId, context);
  const updated = { ...reserve, reserveFactor: event.params.factor };
  await saveReserveWithConfigHistory(updated, chainId, event.block.number, event.transaction?.hash ?? "", event.logIndex, event.block.timestamp, context);
});

LendingPoolConfigurator.ReserveDecimalsChanged.handler(async ({ event, context }) => {
  const chainId = event.chainId;
  const asset = event.params.asset.toLowerCase();
  const poolId = await getPoolByContract(chainId, event.srcAddress, context).catch(() => null);
  if (!poolId) return;
  const reserve = await getOrInitReserve(asset, poolId, chainId, context);
  const updated = { ...reserve, decimals: Number(event.params.decimals) };
  await saveReserveWithConfigHistory(updated, chainId, event.block.number, event.transaction?.hash ?? "", event.logIndex, event.block.timestamp, context);
});

// ─── Token upgrade handlers ───────────────────────────────────────────────────

LendingPoolConfigurator.ATokenUpgraded.handler(async ({ event, context }) => {
  const chainId = event.chainId;
  const tokenId = `${chainId}-${event.params.proxy.toLowerCase()}`;
  const existing = await context.SubToken.get(tokenId);
  if (!existing) return;
  context.SubToken.set({ ...existing, tokenContractImpl: event.params.implementation.toLowerCase() });
});

LendingPoolConfigurator.StableDebtTokenUpgraded.handler(async ({ event, context }) => {
  const chainId = event.chainId;
  const tokenId = `${chainId}-${event.params.proxy.toLowerCase()}`;
  const existing = await context.SubToken.get(tokenId);
  if (!existing) return;
  context.SubToken.set({ ...existing, tokenContractImpl: event.params.implementation.toLowerCase() });
});

LendingPoolConfigurator.VariableDebtTokenUpgraded.handler(async ({ event, context }) => {
  const chainId = event.chainId;
  const tokenId = `${chainId}-${event.params.proxy.toLowerCase()}`;
  const existing = await context.SubToken.get(tokenId);
  if (!existing) return;
  context.SubToken.set({ ...existing, tokenContractImpl: event.params.implementation.toLowerCase() });
});
