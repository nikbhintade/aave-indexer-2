import { PoolConfigurator } from "generated";
import type { Entity, EModeCategory, EModeCategoryConfig } from "generated";
import {
  getPoolByContract,
  getOrInitReserve,
  getOrInitSubToken,
  getOrInitReserveConfigHistoryItem,
  createMapContractToPool,
} from "../helpers/v3/initializers";
import { ZERO_ADDRESS, ZERO_BI } from "../utils/constants";
import { getHistoryEntityId, getSubTokenId } from "../utils/id-generation";

type Pool = Entity<"Pool">;
type Reserve = Entity<"Reserve">;

// ─── Dynamic contract registration ───────────────────────────────────────────

PoolConfigurator.ReserveInitialized.contractRegister(({ event, context }) => {
  context.addAToken(event.params.aToken);
  if (event.params.stableDebtToken.toLowerCase() !== ZERO_ADDRESS) {
    context.addStableDebtToken(event.params.stableDebtToken);
  }
  context.addVariableDebtToken(event.params.variableDebtToken);
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function saveReserveWithConfigHistory(
  reserve: Reserve,
  txHash: string,
  timestamp: number,
  chainId: number,
  context: Parameters<typeof getOrInitReserveConfigHistoryItem>[2]
): Promise<void> {
  const updated = { ...reserve, lastUpdateTimestamp: timestamp };
  context.Reserve.set(updated);

  const histId = `${chainId}:${txHash}`;
  const hist = await getOrInitReserveConfigHistoryItem(histId, updated, context);
  context.ReserveConfigurationHistoryItem.set({
    ...hist,
    usageAsCollateralEnabled: updated.usageAsCollateralEnabled,
    borrowingEnabled: updated.borrowingEnabled,
    stableBorrowRateEnabled: updated.stableBorrowRateEnabled,
    isActive: updated.isActive,
    isFrozen: updated.isFrozen,
    reserveInterestRateStrategy: updated.reserveInterestRateStrategy,
    baseLTVasCollateral: updated.baseLTVasCollateral,
    reserveLiquidationThreshold: updated.reserveLiquidationThreshold,
    reserveLiquidationBonus: updated.reserveLiquidationBonus,
    timestamp,
  });
}

// ─── Reserve initialization ───────────────────────────────────────────────────

PoolConfigurator.ReserveInitialized.handler(async ({ event, context }) => {
  const chainId = event.chainId;
  const poolId = await getPoolByContract(chainId, event.srcAddress, context).catch(() => null);
  if (!poolId) return;

  const asset = event.params.asset.toLowerCase();
  const reserve = await getOrInitReserve(asset, poolId, chainId, context);

  // TODO Phase 13: fetch ERC20 name/symbol/decimals via Effect API
  // TODO Phase 13: fetch interest rate strategy params via Effect API
  const updatedReserve: Reserve = {
    ...reserve,
    reserveInterestRateStrategy: event.params.interestRateStrategyAddress.toLowerCase(),
    isActive: true,
    lastUpdateTimestamp: event.block.timestamp,
  };

  const aTokenAddress = event.params.aToken.toLowerCase();
  const vTokenAddress = event.params.variableDebtToken.toLowerCase();
  const sTokenAddress = event.params.stableDebtToken.toLowerCase();

  // AToken
  await createMapContractToPool(chainId, aTokenAddress, poolId, context);
  const aToken = await getOrInitSubToken(aTokenAddress, chainId, context);
  context.SubToken.set({
    ...aToken,
    pool_id: poolId,
    underlyingAssetAddress: asset,
  });

  // VariableDebtToken
  await createMapContractToPool(chainId, vTokenAddress, poolId, context);
  const vToken = await getOrInitSubToken(vTokenAddress, chainId, context);
  context.SubToken.set({
    ...vToken,
    pool_id: poolId,
    underlyingAssetAddress: asset,
  });

  // StableDebtToken (optional — zero in v3.2+)
  const sTokenId = getSubTokenId(sTokenAddress, chainId);
  if (sTokenAddress !== ZERO_ADDRESS) {
    await createMapContractToPool(chainId, sTokenAddress, poolId, context);
    const sToken = await getOrInitSubToken(sTokenAddress, chainId, context);
    context.SubToken.set({
      ...sToken,
      pool_id: poolId,
      underlyingAssetAddress: asset,
    });
    context.Reserve.set({ ...updatedReserve, aToken_id: getSubTokenId(aTokenAddress, chainId), vToken_id: getSubTokenId(vTokenAddress, chainId), sToken_id: sTokenId });
  } else {
    context.Reserve.set({ ...updatedReserve, aToken_id: getSubTokenId(aTokenAddress, chainId), vToken_id: getSubTokenId(vTokenAddress, chainId) });
  }

  await saveReserveWithConfigHistory(
    await context.Reserve.getOrThrow(getSubTokenId(aTokenAddress, chainId).replace(getSubTokenId(aTokenAddress, chainId), reserve.id)),
    event.transaction?.hash ?? `${event.block.number}-${event.logIndex}`,
    event.block.timestamp,
    chainId,
    context
  );
});

// ─── Token upgrades ───────────────────────────────────────────────────────────

PoolConfigurator.ATokenUpgraded.handler(async ({ event, context }) => {
  const chainId = event.chainId;
  const id = getSubTokenId(event.params.proxy.toLowerCase(), chainId);
  const token = await context.SubToken.get(id);
  if (!token) return;
  context.SubToken.set({ ...token, tokenContractImpl: event.params.implementation.toLowerCase() });
});

PoolConfigurator.StableDebtTokenUpgraded.handler(async ({ event, context }) => {
  const chainId = event.chainId;
  const id = getSubTokenId(event.params.proxy.toLowerCase(), chainId);
  const token = await context.SubToken.get(id);
  if (!token) return;
  context.SubToken.set({ ...token, tokenContractImpl: event.params.implementation.toLowerCase() });
});

PoolConfigurator.VariableDebtTokenUpgraded.handler(async ({ event, context }) => {
  const chainId = event.chainId;
  const id = getSubTokenId(event.params.proxy.toLowerCase(), chainId);
  const token = await context.SubToken.get(id);
  if (!token) return;
  context.SubToken.set({ ...token, tokenContractImpl: event.params.implementation.toLowerCase() });
});

// ─── Reserve status flags ─────────────────────────────────────────────────────

PoolConfigurator.ReserveActive.handler(async ({ event, context }) => {
  const chainId = event.chainId;
  const poolId = await getPoolByContract(chainId, event.srcAddress, context).catch(() => null);
  if (!poolId) return;
  const reserve = await getOrInitReserve(event.params.asset.toLowerCase(), poolId, chainId, context);
  await saveReserveWithConfigHistory({ ...reserve, isActive: event.params.active }, event.transaction?.hash ?? `${event.block.number}-${event.logIndex}`, event.block.timestamp, chainId, context);
});

PoolConfigurator.ReserveBorrowing.handler(async ({ event, context }) => {
  const chainId = event.chainId;
  const poolId = await getPoolByContract(chainId, event.srcAddress, context).catch(() => null);
  if (!poolId) return;
  const reserve = await getOrInitReserve(event.params.asset.toLowerCase(), poolId, chainId, context);
  await saveReserveWithConfigHistory({ ...reserve, borrowingEnabled: event.params.enabled }, event.transaction?.hash ?? `${event.block.number}-${event.logIndex}`, event.block.timestamp, chainId, context);
});

PoolConfigurator.ReserveStableRateBorrowing.handler(async ({ event, context }) => {
  const chainId = event.chainId;
  const poolId = await getPoolByContract(chainId, event.srcAddress, context).catch(() => null);
  if (!poolId) return;
  const reserve = await getOrInitReserve(event.params.asset.toLowerCase(), poolId, chainId, context);
  await saveReserveWithConfigHistory({ ...reserve, stableBorrowRateEnabled: event.params.enabled }, event.transaction?.hash ?? `${event.block.number}-${event.logIndex}`, event.block.timestamp, chainId, context);
});

PoolConfigurator.ReserveFrozen.handler(async ({ event, context }) => {
  const chainId = event.chainId;
  const poolId = await getPoolByContract(chainId, event.srcAddress, context).catch(() => null);
  if (!poolId) return;
  const reserve = await getOrInitReserve(event.params.asset.toLowerCase(), poolId, chainId, context);
  await saveReserveWithConfigHistory({ ...reserve, isFrozen: event.params.frozen }, event.transaction?.hash ?? `${event.block.number}-${event.logIndex}`, event.block.timestamp, chainId, context);
});

PoolConfigurator.ReservePaused.handler(async ({ event, context }) => {
  const chainId = event.chainId;
  const poolId = await getPoolByContract(chainId, event.srcAddress, context).catch(() => null);
  if (!poolId) return;
  const reserve = await getOrInitReserve(event.params.asset.toLowerCase(), poolId, chainId, context);
  context.Reserve.set({ ...reserve, isPaused: event.params.paused, lastUpdateTimestamp: event.block.timestamp });
});

PoolConfigurator.ReserveDropped.handler(async ({ event, context }) => {
  const chainId = event.chainId;
  const poolId = await getPoolByContract(chainId, event.srcAddress, context).catch(() => null);
  if (!poolId) return;
  const reserve = await getOrInitReserve(event.params.asset.toLowerCase(), poolId, chainId, context);
  context.Reserve.set({ ...reserve, isDropped: true, lastUpdateTimestamp: event.block.timestamp });
});

// ─── Reserve configuration ────────────────────────────────────────────────────

PoolConfigurator.CollateralConfigurationChanged.handler(async ({ event, context }) => {
  const chainId = event.chainId;
  const poolId = await getPoolByContract(chainId, event.srcAddress, context).catch(() => null);
  if (!poolId) return;
  const reserve = await getOrInitReserve(event.params.asset.toLowerCase(), poolId, chainId, context);
  await saveReserveWithConfigHistory({
    ...reserve,
    usageAsCollateralEnabled: event.params.liquidationThreshold > ZERO_BI,
    baseLTVasCollateral: event.params.ltv,
    reserveLiquidationThreshold: event.params.liquidationThreshold,
    reserveLiquidationBonus: event.params.liquidationBonus,
  }, event.transaction?.hash ?? `${event.block.number}-${event.logIndex}`, event.block.timestamp, chainId, context);
});

PoolConfigurator.ReserveFactorChanged.handler(async ({ event, context }) => {
  const chainId = event.chainId;
  const poolId = await getPoolByContract(chainId, event.srcAddress, context).catch(() => null);
  if (!poolId) return;
  const reserve = await getOrInitReserve(event.params.asset.toLowerCase(), poolId, chainId, context);
  await saveReserveWithConfigHistory({ ...reserve, reserveFactor: event.params.newReserveFactor }, event.transaction?.hash ?? `${event.block.number}-${event.logIndex}`, event.block.timestamp, chainId, context);
});

PoolConfigurator.ReserveInterestRateStrategyChanged.handler(async ({ event, context }) => {
  const chainId = event.chainId;
  const poolId = await getPoolByContract(chainId, event.srcAddress, context).catch(() => null);
  if (!poolId) return;
  const reserve = await getOrInitReserve(event.params.asset.toLowerCase(), poolId, chainId, context);
  if (reserve.aToken_id.endsWith(ZERO_ADDRESS)) return; // reserve not initialized yet
  // TODO Phase 13: fetch new strategy params via Effect API
  await saveReserveWithConfigHistory({ ...reserve, reserveInterestRateStrategy: event.params.newStrategy.toLowerCase() }, event.transaction?.hash ?? `${event.block.number}-${event.logIndex}`, event.block.timestamp, chainId, context);
});

// ─── Cap changes ──────────────────────────────────────────────────────────────

PoolConfigurator.BorrowCapChanged.handler(async ({ event, context }) => {
  const chainId = event.chainId;
  const poolId = await getPoolByContract(chainId, event.srcAddress, context).catch(() => null);
  if (!poolId) return;
  const reserve = await getOrInitReserve(event.params.asset.toLowerCase(), poolId, chainId, context);
  context.Reserve.set({ ...reserve, borrowCap: event.params.newBorrowCap, lastUpdateTimestamp: event.block.timestamp });
});

PoolConfigurator.SupplyCapChanged.handler(async ({ event, context }) => {
  const chainId = event.chainId;
  const poolId = await getPoolByContract(chainId, event.srcAddress, context).catch(() => null);
  if (!poolId) return;
  const reserve = await getOrInitReserve(event.params.asset.toLowerCase(), poolId, chainId, context);
  context.Reserve.set({ ...reserve, supplyCap: event.params.newSupplyCap, lastUpdateTimestamp: event.block.timestamp });
});

PoolConfigurator.DebtCeilingChanged.handler(async ({ event, context }) => {
  const chainId = event.chainId;
  const poolId = await getPoolByContract(chainId, event.srcAddress, context).catch(() => null);
  if (!poolId) return;
  const reserve = await getOrInitReserve(event.params.asset.toLowerCase(), poolId, chainId, context);
  context.Reserve.set({ ...reserve, debtCeiling: event.params.newDebtCeiling, lastUpdateTimestamp: event.block.timestamp });
});

PoolConfigurator.UnbackedMintCapChanged.handler(async ({ event, context }) => {
  const chainId = event.chainId;
  const poolId = await getPoolByContract(chainId, event.srcAddress, context).catch(() => null);
  if (!poolId) return;
  const reserve = await getOrInitReserve(event.params.asset.toLowerCase(), poolId, chainId, context);
  context.Reserve.set({ ...reserve, unbackedMintCap: event.params.newUnbackedMintCap, lastUpdateTimestamp: event.block.timestamp });
});

PoolConfigurator.LiquidationProtocolFeeChanged.handler(async ({ event, context }) => {
  const chainId = event.chainId;
  const poolId = await getPoolByContract(chainId, event.srcAddress, context).catch(() => null);
  if (!poolId) return;
  const reserve = await getOrInitReserve(event.params.asset.toLowerCase(), poolId, chainId, context);
  context.Reserve.set({ ...reserve, liquidationProtocolFee: event.params.newFee, lastUpdateTimestamp: event.block.timestamp });
});

// ─── Isolation / siloed borrowing ─────────────────────────────────────────────

PoolConfigurator.BorrowableInIsolationChanged.handler(async ({ event, context }) => {
  const chainId = event.chainId;
  const poolId = await getPoolByContract(chainId, event.srcAddress, context).catch(() => null);
  if (!poolId) return;
  const reserve = await getOrInitReserve(event.params.asset.toLowerCase(), poolId, chainId, context);
  context.Reserve.set({ ...reserve, borrowableInIsolation: event.params.borrowable, lastUpdateTimestamp: event.block.timestamp });
});

PoolConfigurator.SiloedBorrowingChanged.handler(async ({ event, context }) => {
  const chainId = event.chainId;
  const poolId = await getPoolByContract(chainId, event.srcAddress, context).catch(() => null);
  if (!poolId) return;
  const reserve = await getOrInitReserve(event.params.asset.toLowerCase(), poolId, chainId, context);
  context.Reserve.set({ ...reserve, siloedBorrowing: event.params.newState, lastUpdateTimestamp: event.block.timestamp });
});

// ─── Protocol fees ────────────────────────────────────────────────────────────

PoolConfigurator.BridgeProtocolFeeUpdated.handler(async ({ event, context }) => {
  const chainId = event.chainId;
  const poolId = await getPoolByContract(chainId, event.srcAddress, context).catch(() => null);
  if (!poolId) return;
  const pool = await context.Pool.get(poolId);
  if (!pool) return;
  context.Pool.set({ ...pool, bridgeProtocolFee: event.params.newBridgeProtocolFee, lastUpdateTimestamp: event.block.timestamp } as Pool);
});

PoolConfigurator.FlashloanPremiumTotalUpdated.handler(async ({ event, context }) => {
  const chainId = event.chainId;
  const poolId = await getPoolByContract(chainId, event.srcAddress, context).catch(() => null);
  if (!poolId) return;
  const pool = await context.Pool.get(poolId);
  if (!pool) return;
  context.Pool.set({ ...pool, flashloanPremiumTotal: event.params.newFlashloanPremiumTotal, lastUpdateTimestamp: event.block.timestamp } as Pool);
});

PoolConfigurator.FlashloanPremiumToProtocolUpdated.handler(async ({ event, context }) => {
  const chainId = event.chainId;
  const poolId = await getPoolByContract(chainId, event.srcAddress, context).catch(() => null);
  if (!poolId) return;
  const pool = await context.Pool.get(poolId);
  if (!pool) return;
  context.Pool.set({ ...pool, flashloanPremiumToProtocol: event.params.newFlashloanPremiumToProtocol, lastUpdateTimestamp: event.block.timestamp } as Pool);
});

// ─── EMode ────────────────────────────────────────────────────────────────────

PoolConfigurator.EModeCategoryAdded.handler(async ({ event, context }) => {
  const chainId = event.chainId;
  const categoryId = String(event.params.categoryId);
  const id = `${chainId}-${categoryId}`;

  const existing = await context.EModeCategory.get(id);
  const category: EModeCategory = {
    ...(existing ?? {}),
    id,
    ltv: event.params.ltv,
    liquidationThreshold: event.params.liquidationThreshold,
    liquidationBonus: event.params.liquidationBonus,
    oracle: event.params.oracle.toLowerCase(),
    label: event.params.label,
  };
  context.EModeCategory.set(category);
});

PoolConfigurator.EModeAssetCategoryChanged.handler(async ({ event, context }) => {
  const chainId = event.chainId;
  const poolId = await getPoolByContract(chainId, event.srcAddress, context).catch(() => null);
  if (!poolId) return;
  const reserve = await getOrInitReserve(event.params.asset.toLowerCase(), poolId, chainId, context);
  const categoryId = `${chainId}-${String(event.params.newCategoryId)}`;
  context.Reserve.set({ ...reserve, eMode_id: event.params.newCategoryId === 0n ? undefined : categoryId, lastUpdateTimestamp: event.block.timestamp });
});

PoolConfigurator.AssetCollateralInEModeChanged.handler(async ({ event, context }) => {
  const chainId = event.chainId;
  const categoryId = `${chainId}-${String(event.params.categoryId)}`;
  const configId = `${chainId}-${event.params.asset.toLowerCase()}-${String(event.params.categoryId)}`;

  // Ensure EModeCategory exists as placeholder
  const cat = await context.EModeCategory.get(categoryId);
  if (!cat) {
    context.EModeCategory.set({
      id: categoryId, ltv: ZERO_BI, liquidationThreshold: ZERO_BI,
      liquidationBonus: ZERO_BI, oracle: ZERO_ADDRESS, label: "PLACEHOLDER",
    });
  }

  const existing = await context.EModeCategoryConfig.get(configId);
  context.EModeCategoryConfig.set({
    id: configId,
    category_id: categoryId,
    asset: event.params.asset.toLowerCase(),
    collateral: event.params.collateral,
    borrowable: existing?.borrowable ?? false,
  });
});

PoolConfigurator.AssetBorrowableInEModeChanged.handler(async ({ event, context }) => {
  const chainId = event.chainId;
  const categoryId = `${chainId}-${String(event.params.categoryId)}`;
  const configId = `${chainId}-${event.params.asset.toLowerCase()}-${String(event.params.categoryId)}`;

  const cat = await context.EModeCategory.get(categoryId);
  if (!cat) {
    context.EModeCategory.set({
      id: categoryId, ltv: ZERO_BI, liquidationThreshold: ZERO_BI,
      liquidationBonus: ZERO_BI, oracle: ZERO_ADDRESS, label: "PLACEHOLDER",
    });
  }

  const existing = await context.EModeCategoryConfig.get(configId);
  context.EModeCategoryConfig.set({
    id: configId,
    category_id: categoryId,
    asset: event.params.asset.toLowerCase(),
    collateral: existing?.collateral ?? false,
    borrowable: event.params.borrowable,
  });
});
