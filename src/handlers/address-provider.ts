import { PoolAddressesProvider } from "generated";
import {
  bytes32ToString,
  getContractMappingId,
  getPoolByContract,
  createMapContractToPool,
  getOrInitPriceOracle,
} from "../helpers/v3/initializers";
import type { ContractToPoolMapping } from "generated";

// Register Pool and PoolConfigurator dynamic contracts when proxies are created
PoolAddressesProvider.ProxyCreated.contractRegister(({ event, context }) => {
  const contractId = bytes32ToString(event.params.id);
  if (contractId === "POOL_CONFIGURATOR") {
    context.addPoolConfigurator(event.params.proxyAddress);
  } else if (contractId === "POOL") {
    context.addPool(event.params.proxyAddress);
  }
});

PoolAddressesProvider.ProxyCreated.handler(async ({ event, context }) => {
  const chainId = event.chainId;
  const contractId = bytes32ToString(event.params.id);
  const proxyAddress = event.params.proxyAddress.toLowerCase();

  if (contractId !== "POOL_CONFIGURATOR" && contractId !== "POOL") return;

  const poolId = await getPoolByContract(
    chainId,
    event.srcAddress,
    context
  ).catch(() => null);

  if (!poolId) return;

  const pool = await context.Pool.get(poolId);
  if (!pool) return;

  const component = contractId === "POOL_CONFIGURATOR" ? "poolConfigurator" : "pool";

  context.Pool.set({
    ...pool,
    [component]: proxyAddress,
    lastUpdateTimestamp: event.block.timestamp,
  });

  await createMapContractToPool(chainId, proxyAddress, poolId, context);

  if (contractId === "POOL_CONFIGURATOR") {
    const mappingId = getContractMappingId(chainId, proxyAddress);
    const existing = await context.ContractToPoolMapping.get(mappingId);
    if (!existing) {
      const mapping: ContractToPoolMapping = {
        id: mappingId,
        pool_id: poolId,
      };
      context.ContractToPoolMapping.set(mapping);
    }
  }
});

PoolAddressesProvider.PoolUpdated.handler(async ({ event, context }) => {
  const chainId = event.chainId;
  const poolId = await getPoolByContract(chainId, event.srcAddress, context).catch(() => null);
  if (!poolId) return;

  const pool = await context.Pool.get(poolId);
  if (!pool) return;

  context.Pool.set({
    ...pool,
    poolImpl: event.params.newAddress.toLowerCase(),
    lastUpdateTimestamp: event.block.timestamp,
  });
});

PoolAddressesProvider.PoolConfiguratorUpdated.handler(async ({ event, context }) => {
  const chainId = event.chainId;
  const poolId = await getPoolByContract(chainId, event.srcAddress, context).catch(() => null);
  if (!poolId) return;

  const pool = await context.Pool.get(poolId);
  if (!pool) return;

  context.Pool.set({
    ...pool,
    poolConfiguratorImpl: event.params.newAddress.toLowerCase(),
    lastUpdateTimestamp: event.block.timestamp,
  });
});

PoolAddressesProvider.PriceOracleUpdated.handler(async ({ event, context }) => {
  const chainId = event.chainId;
  const poolId = await getPoolByContract(chainId, event.srcAddress, context).catch(() => null);
  if (!poolId) return;

  const pool = await context.Pool.get(poolId);
  if (!pool) return;

  const newOracleAddress = event.params.newAddress.toLowerCase();

  context.Pool.set({
    ...pool,
    proxyPriceProvider: newOracleAddress,
    lastUpdateTimestamp: event.block.timestamp,
  });

  // Ensure PriceOracle entity exists
  await getOrInitPriceOracle(newOracleAddress, chainId, context);
});

PoolAddressesProvider.PoolDataProviderUpdated.handler(async ({ event, context }) => {
  const chainId = event.chainId;
  const poolId = await getPoolByContract(chainId, event.srcAddress, context).catch(() => null);
  if (!poolId) return;

  const pool = await context.Pool.get(poolId);
  if (!pool) return;

  context.Pool.set({
    ...pool,
    poolDataProviderImpl: event.params.newAddress.toLowerCase(),
    lastUpdateTimestamp: event.block.timestamp,
  });
});
