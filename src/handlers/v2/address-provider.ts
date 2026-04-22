import {
  LendingPoolAddressesProviderRegistry,
  LendingPoolAddressesProvider,
} from "generated";
import type {
  Entity,
  HandlerContext,
  ContractToPoolMapping,
  PoolConfigurationHistoryItem,
} from "generated";
import {
  getProtocol,
  getContractMappingId,
  getPoolByContract,
  createMapContractToPool,
  getOrInitPriceOracle,
} from "../../helpers/v3/initializers";
import { getHistoryEntityId } from "../../utils/id-generation";
import { ZERO_BI } from "../../utils/constants";

type Pool = Entity<"Pool">;

// ─── Helper: save pool config history snapshot ───────────────────────────────

function saveV2PoolConfigHistory(
  pool: Pool,
  chainId: number,
  blockNumber: number,
  txHash: string,
  logIndex: number,
  timestamp: number,
  context: HandlerContext
): void {
  const historyId = `${pool.id}:${getHistoryEntityId(chainId, blockNumber, txHash, logIndex)}`;
  const history: PoolConfigurationHistoryItem = {
    id: historyId,
    active: pool.active,
    pool_id: pool.id,
    lendingPool: pool.pool ?? undefined,
    lendingPoolCollateralManager: pool.poolCollateralManager ?? undefined,
    lendingPoolConfiguratorImpl: pool.poolConfiguratorImpl ?? undefined,
    lendingPoolImpl: pool.poolImpl ?? undefined,
    lendingPoolConfigurator: pool.poolConfigurator ?? undefined,
    proxyPriceProvider: pool.proxyPriceProvider ?? undefined,
    lendingRateOracle: pool.lendingRateOracle ?? undefined,
    configurationAdmin: pool.configurationAdmin ?? undefined,
    timestamp,
  };
  context.PoolConfigurationHistoryItem.set(history);
}

// ─── LendingPoolAddressesProviderRegistry ───────────────────────────────────

LendingPoolAddressesProviderRegistry.AddressesProviderRegistered.contractRegister(
  ({ event, context }) => {
    context.addLendingPoolAddressesProvider(event.params.newAddress);
  }
);

LendingPoolAddressesProviderRegistry.AddressesProviderRegistered.handler(
  async ({ event, context }) => {
    const chainId = event.chainId;
    const address = event.params.newAddress.toLowerCase();
    const poolId = `${chainId}-${address}`;

    const existing = await context.Pool.get(poolId);
    if (existing) return;

    const protocol = await getProtocol(chainId, context);

    const pool: Pool = {
      id: poolId,
      protocol_id: protocol.id,
      addressProviderId: ZERO_BI,
      active: true,
      paused: false,
      lastUpdateTimestamp: event.block.timestamp,
      pool: undefined,
      poolCollateralManager: undefined,
      poolConfiguratorImpl: undefined,
      poolImpl: undefined,
      poolDataProviderImpl: undefined,
      poolConfigurator: undefined,
      proxyPriceProvider: undefined,
      bridgeProtocolFee: undefined,
      flashloanPremiumTotal: undefined,
      flashloanPremiumToProtocol: undefined,
      lendingRateOracle: undefined,
      configurationAdmin: undefined,
      emergencyAdmin: undefined,
      ethereumAddress: undefined,
    };
    context.Pool.set(pool);

    const mapping: ContractToPoolMapping = {
      id: getContractMappingId(chainId, address),
      pool_id: poolId,
    };
    context.ContractToPoolMapping.set(mapping);
  }
);

LendingPoolAddressesProviderRegistry.AddressesProviderUnregistered.handler(
  async ({ event, context }) => {
    const chainId = event.chainId;
    const address = event.params.newAddress.toLowerCase();
    const poolId = `${chainId}-${address}`;

    const pool = await context.Pool.get(poolId);
    if (!pool) return;
    context.Pool.set({ ...pool, active: false, lastUpdateTimestamp: event.block.timestamp });
  }
);

// ─── LendingPoolAddressesProvider ───────────────────────────────────────────

LendingPoolAddressesProvider.ProxyCreated.contractRegister(({ event, context }) => {
  const id = event.params.id.toString();
  if (id === "LENDING_POOL_CONFIGURATOR") {
    context.addLendingPoolConfigurator(event.params.newAddress);
  } else if (id === "LENDING_POOL") {
    context.addLendingPool(event.params.newAddress);
  }
});

LendingPoolAddressesProvider.ProxyCreated.handler(async ({ event, context }) => {
  const chainId = event.chainId;
  const id = event.params.id.toString();
  const proxyAddress = event.params.newAddress.toLowerCase();

  if (id !== "LENDING_POOL_CONFIGURATOR" && id !== "LENDING_POOL") return;

  const poolId = await getPoolByContract(chainId, event.srcAddress, context).catch(() => null);
  if (!poolId) return;

  const pool = await context.Pool.get(poolId);
  if (!pool) return;

  const field = id === "LENDING_POOL_CONFIGURATOR" ? "poolConfigurator" : "pool";
  const updatedPool = { ...pool, [field]: proxyAddress, lastUpdateTimestamp: event.block.timestamp };
  context.Pool.set(updatedPool);

  await createMapContractToPool(chainId, proxyAddress, poolId, context);

  saveV2PoolConfigHistory(
    updatedPool,
    chainId,
    event.block.number,
    event.transaction?.hash ?? "",
    event.logIndex,
    event.block.timestamp,
    context
  );
});

LendingPoolAddressesProvider.AddressSet.handler(async ({ event, context }) => {
  const chainId = event.chainId;
  const id = event.params.id.toString();
  const newAddress = event.params.newAddress.toLowerCase();

  const fieldMap: Record<string, string> = {
    LENDING_POOL: "pool",
    LENDING_POOL_CONFIGURATOR: "poolConfigurator",
    POOL_ADMIN: "configurationAdmin",
    EMERGENCY_ADMIN: "emergencyAdmin",
    COLLATERAL_MANAGER: "poolCollateralManager",
    PRICE_ORACLE: "proxyPriceProvider",
    LENDING_RATE_ORACLE: "lendingRateOracle",
    LENDING_POOL_CONFIGURATOR_IMPL: "poolConfiguratorImpl",
    LENDING_POOL_IMPL: "poolImpl",
  };

  const field = fieldMap[id];
  if (!field) return;

  const poolId = await getPoolByContract(chainId, event.srcAddress, context).catch(() => null);
  if (!poolId) return;

  const pool = await context.Pool.get(poolId);
  if (!pool) return;

  const updatedPool = { ...pool, [field]: newAddress, lastUpdateTimestamp: event.block.timestamp };
  context.Pool.set(updatedPool);

  saveV2PoolConfigHistory(
    updatedPool,
    chainId,
    event.block.number,
    event.transaction?.hash ?? "",
    event.logIndex,
    event.block.timestamp,
    context
  );
});

LendingPoolAddressesProvider.LendingPoolUpdated.handler(async ({ event, context }) => {
  const chainId = event.chainId;
  const poolId = await getPoolByContract(chainId, event.srcAddress, context).catch(() => null);
  if (!poolId) return;
  const pool = await context.Pool.get(poolId);
  if (!pool) return;
  context.Pool.set({ ...pool, poolImpl: event.params.newAddress.toLowerCase(), lastUpdateTimestamp: event.block.timestamp });
});

LendingPoolAddressesProvider.LendingPoolConfiguratorUpdated.handler(async ({ event, context }) => {
  const chainId = event.chainId;
  const poolId = await getPoolByContract(chainId, event.srcAddress, context).catch(() => null);
  if (!poolId) return;
  const pool = await context.Pool.get(poolId);
  if (!pool) return;
  context.Pool.set({ ...pool, poolConfiguratorImpl: event.params.newAddress.toLowerCase(), lastUpdateTimestamp: event.block.timestamp });
});

LendingPoolAddressesProvider.LendingPoolCollateralManagerUpdated.handler(async ({ event, context }) => {
  const chainId = event.chainId;
  const poolId = await getPoolByContract(chainId, event.srcAddress, context).catch(() => null);
  if (!poolId) return;
  const pool = await context.Pool.get(poolId);
  if (!pool) return;
  context.Pool.set({ ...pool, poolCollateralManager: event.params.newAddress.toLowerCase(), lastUpdateTimestamp: event.block.timestamp });
});

LendingPoolAddressesProvider.PriceOracleUpdated.handler(async ({ event, context }) => {
  const chainId = event.chainId;
  const poolId = await getPoolByContract(chainId, event.srcAddress, context).catch(() => null);
  if (!poolId) return;
  const pool = await context.Pool.get(poolId);
  if (!pool) return;
  const newOracle = event.params.newAddress.toLowerCase();
  context.Pool.set({ ...pool, proxyPriceProvider: newOracle, lastUpdateTimestamp: event.block.timestamp });
  await getOrInitPriceOracle(newOracle, chainId, context);
});

LendingPoolAddressesProvider.LendingRateOracleUpdated.handler(async ({ event, context }) => {
  const chainId = event.chainId;
  const poolId = await getPoolByContract(chainId, event.srcAddress, context).catch(() => null);
  if (!poolId) return;
  const pool = await context.Pool.get(poolId);
  if (!pool) return;
  context.Pool.set({ ...pool, lendingRateOracle: event.params.newAddress.toLowerCase(), lastUpdateTimestamp: event.block.timestamp });
});

LendingPoolAddressesProvider.ConfigurationAdminUpdated.handler(async ({ event, context }) => {
  const chainId = event.chainId;
  const poolId = await getPoolByContract(chainId, event.srcAddress, context).catch(() => null);
  if (!poolId) return;
  const pool = await context.Pool.get(poolId);
  if (!pool) return;
  context.Pool.set({ ...pool, configurationAdmin: event.params.newAddress.toLowerCase(), lastUpdateTimestamp: event.block.timestamp });
});

LendingPoolAddressesProvider.EmergencyAdminUpdated.handler(async ({ event, context }) => {
  const chainId = event.chainId;
  const poolId = await getPoolByContract(chainId, event.srcAddress, context).catch(() => null);
  if (!poolId) return;
  const pool = await context.Pool.get(poolId);
  if (!pool) return;
  context.Pool.set({ ...pool, emergencyAdmin: event.params.newAddress.toLowerCase(), lastUpdateTimestamp: event.block.timestamp });
});
