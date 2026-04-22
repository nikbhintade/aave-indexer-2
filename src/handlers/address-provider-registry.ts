import { PoolAddressesProviderRegistry } from "generated";
import type { Entity, ContractToPoolMapping } from "generated";
import { getProtocol, getContractMappingId } from "../helpers/v3/initializers";

type Pool = Entity<"Pool">;

// Register PoolAddressesProvider as a dynamic contract when a new provider is added
PoolAddressesProviderRegistry.AddressesProviderRegistered.contractRegister(
  ({ event, context }) => {
    context.addPoolAddressesProvider(event.params.addressesProvider);
  }
);

PoolAddressesProviderRegistry.AddressesProviderRegistered.handler(
  async ({ event, context }) => {
    const chainId = event.chainId;
    const address = event.params.addressesProvider.toLowerCase();
    const poolId = `${chainId}-${address}`;

    const existing = await context.Pool.get(poolId);
    if (existing) return;

    const protocol = await getProtocol(chainId, context);

    const pool: Pool = {
      id: poolId,
      protocol_id: protocol.id,
      addressProviderId: event.params.id,
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

    // Map the address provider address itself to this pool
    const mapping: ContractToPoolMapping = {
      id: getContractMappingId(chainId, address),
      pool_id: poolId,
    };
    context.ContractToPoolMapping.set(mapping);
  }
);

PoolAddressesProviderRegistry.AddressesProviderUnregistered.handler(
  async ({ event, context }) => {
    const chainId = event.chainId;
    const address = event.params.addressesProvider.toLowerCase();
    const poolId = `${chainId}-${address}`;

    const pool = await context.Pool.get(poolId);
    if (!pool) return;

    context.Pool.set({
      ...pool,
      active: false,
      lastUpdateTimestamp: event.block.timestamp,
    });
  }
);
