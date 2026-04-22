import { describe, it, expect, beforeEach } from "vitest";
import { createTestIndexer } from "generated";

// ─── Shared addresses (real mainnet values for realism) ───────────────────────

const CHAIN_1 = 1;
const CHAIN_137 = 137;

const REGISTRY_ADDR_1 = "0xbaA999AC55EAce41CcAE355c77809e68Bb345170";
const PROVIDER_ADDR = "0xb53c1a33016b2dc2ff3653530bff1848a515c8c5";
const POOL_ADDR = "0x87870bca3f3fd6335c3f4ce8392d69350b4fa4e2";
const CONFIGURATOR_ADDR = "0x64b761d848206f447729ad4a56b3adc6e9bde08f";
const WETH_ADDR = "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2";
const ATOKEN_ADDR = "0x4d5f47fa6a74757f35c14fd3a6ef8e3c9bc514e8";
const VTOKEN_ADDR = "0xea51d7853eefb32b6ee06b1c12e6dcca88be0ffe";
const STOKEN_ADDR = "0x102633152313c81cd80419b6ecf66d14ad68949a";
const USER_ADDR = "0xd8da6bf26964af9d7eed9e03e53415d37aa96045";
const GHO_TOKEN_ADDR = "0x40D16FC0246aD3160Ccc09B8D0D3A2cD28aE6C2f";
const FLASH_MINTER_ADDR = "0xb639d208bcf0589d54fac24e655c79ec529762b8";
const ZERO_ADDR = "0x0000000000000000000000000000000000000000";

// ─── Suite 1: V3 Registry ────────────────────────────────────────────────────

describe("V3 PoolAddressesProviderRegistry", () => {
  it("AddressesProviderRegistered creates Pool entity", async () => {
    const indexer = createTestIndexer();

    const { changes } = await indexer.process({
      chains: {
        [CHAIN_1]: {
          simulate: [
            {
              contract: "PoolAddressesProviderRegistry",
              event: "AddressesProviderRegistered",
              srcAddress: REGISTRY_ADDR_1,
              block: { number: 16291010, timestamp: 1672531200 },
              params: {
                addressesProvider: PROVIDER_ADDR,
                id: 1n,
              },
            },
          ],
        },
      },
    });

    const poolId = `${CHAIN_1}-${PROVIDER_ADDR.toLowerCase()}`;
    const pool = await indexer.Pool.get(poolId);

    expect(pool).toBeDefined();
    expect(pool?.active).toBe(true);
    expect(pool?.addressProviderId).toBe(1n);
    expect(pool?.protocol_id).toBe(`${CHAIN_1}-1`);

    // ContractToPoolMapping created
    const mapping = await indexer.ContractToPoolMapping.get(
      `${CHAIN_1}-${PROVIDER_ADDR.toLowerCase()}`
    );
    expect(mapping?.pool_id).toBe(poolId);

    // Dynamic contract registration reflected in changes
    const block = changes.find((c) => c.chainId === CHAIN_1);
    expect(block?.addresses?.sets?.some((a) => a.contract === "PoolAddressesProvider")).toBe(true);
  });

  it("AddressesProviderUnregistered sets active=false", async () => {
    const indexer = createTestIndexer();
    const poolId = `${CHAIN_1}-${PROVIDER_ADDR.toLowerCase()}`;

    // Pre-create pool
    await indexer.Pool.set({
      id: poolId,
      protocol_id: `${CHAIN_1}-1`,
      addressProviderId: 1n,
      active: true,
      paused: false,
      lastUpdateTimestamp: 1672531200,
      pool: undefined, poolCollateralManager: undefined, poolConfiguratorImpl: undefined,
      poolImpl: undefined, poolDataProviderImpl: undefined, poolConfigurator: undefined,
      proxyPriceProvider: undefined, bridgeProtocolFee: undefined,
      flashloanPremiumTotal: undefined, flashloanPremiumToProtocol: undefined,
      lendingRateOracle: undefined, configurationAdmin: undefined,
      emergencyAdmin: undefined, ethereumAddress: undefined,
    });

    await indexer.process({
      chains: {
        [CHAIN_1]: {
          simulate: [
            {
              contract: "PoolAddressesProviderRegistry",
              event: "AddressesProviderUnregistered",
              srcAddress: REGISTRY_ADDR_1,
              block: { number: 16291020, timestamp: 1672532000 },
              params: {
                addressesProvider: PROVIDER_ADDR,
                id: 1n,
              },
            },
          ],
        },
      },
    });

    const pool = await indexer.Pool.get(poolId);
    expect(pool?.active).toBe(false);
  });
});

// ─── Suite 2: V3 PoolConfigurator ────────────────────────────────────────────

describe("V3 PoolConfigurator", () => {
  async function setupPool(indexer: ReturnType<typeof createTestIndexer>) {
    const poolId = `${CHAIN_1}-${PROVIDER_ADDR.toLowerCase()}`;
    await indexer.Protocol.set({ id: `${CHAIN_1}-1` });
    await indexer.Pool.set({
      id: poolId,
      protocol_id: `${CHAIN_1}-1`,
      addressProviderId: 1n,
      active: true,
      paused: false,
      lastUpdateTimestamp: 0,
      pool: POOL_ADDR,
      poolCollateralManager: undefined, poolConfiguratorImpl: undefined,
      poolImpl: undefined, poolDataProviderImpl: undefined,
      poolConfigurator: CONFIGURATOR_ADDR,
      proxyPriceProvider: undefined, bridgeProtocolFee: undefined,
      flashloanPremiumTotal: undefined, flashloanPremiumToProtocol: undefined,
      lendingRateOracle: undefined, configurationAdmin: undefined,
      emergencyAdmin: undefined, ethereumAddress: undefined,
    });
    // Map configurator address → pool
    await indexer.ContractToPoolMapping.set({
      id: `${CHAIN_1}-${CONFIGURATOR_ADDR.toLowerCase()}`,
      pool_id: poolId,
    });
    return poolId;
  }

  it("ReserveInitialized creates Reserve + 3 SubTokens + dynamic contracts", async () => {
    const indexer = createTestIndexer();
    const poolId = await setupPool(indexer);

    const { changes } = await indexer.process({
      chains: {
        [CHAIN_1]: {
          simulate: [
            {
              contract: "PoolConfigurator",
              event: "ReserveInitialized",
              srcAddress: CONFIGURATOR_ADDR,
              block: { number: 16291100, timestamp: 1672531300 },
              params: {
                asset: WETH_ADDR,
                aToken: ATOKEN_ADDR,
                stableDebtToken: STOKEN_ADDR,
                variableDebtToken: VTOKEN_ADDR,
                interestRateStrategyAddress: "0x0000000000000000000000000000000000000001",
              },
            },
          ],
        },
      },
    });

    const reserveId = `${CHAIN_1}-${WETH_ADDR.toLowerCase()}${poolId}`;
    const reserve = await indexer.Reserve.get(reserveId);
    expect(reserve).toBeDefined();
    expect(reserve?.underlyingAsset).toBe(WETH_ADDR.toLowerCase());
    expect(reserve?.pool_id).toBe(poolId);
    expect(reserve?.isActive).toBe(true);

    // Three SubToken entities
    const aSubToken = await indexer.SubToken.get(`${CHAIN_1}-${ATOKEN_ADDR.toLowerCase()}`);
    const vSubToken = await indexer.SubToken.get(`${CHAIN_1}-${VTOKEN_ADDR.toLowerCase()}`);
    const sSubToken = await indexer.SubToken.get(`${CHAIN_1}-${STOKEN_ADDR.toLowerCase()}`);
    expect(aSubToken).toBeDefined();
    expect(vSubToken).toBeDefined();
    expect(sSubToken).toBeDefined();

    // Dynamic contract registrations
    const block = changes.find((c) => c.chainId === CHAIN_1);
    const addrs = block?.addresses?.sets?.map((a) => a.contract) ?? [];
    expect(addrs).toContain("AToken");
    expect(addrs).toContain("VariableDebtToken");
  });
});

// ─── Suite 3: V3 Pool actions ─────────────────────────────────────────────────

describe("V3 Pool", () => {
  async function setupPoolAndMapping(indexer: ReturnType<typeof createTestIndexer>) {
    const poolId = `${CHAIN_1}-${PROVIDER_ADDR.toLowerCase()}`;
    await indexer.Protocol.set({ id: `${CHAIN_1}-1` });
    await indexer.Pool.set({
      id: poolId,
      protocol_id: `${CHAIN_1}-1`,
      addressProviderId: 1n,
      active: true,
      paused: false,
      lastUpdateTimestamp: 0,
      pool: POOL_ADDR,
      poolCollateralManager: undefined, poolConfiguratorImpl: undefined,
      poolImpl: undefined, poolDataProviderImpl: undefined,
      poolConfigurator: CONFIGURATOR_ADDR,
      proxyPriceProvider: undefined, bridgeProtocolFee: undefined,
      flashloanPremiumTotal: undefined, flashloanPremiumToProtocol: undefined,
      lendingRateOracle: undefined, configurationAdmin: undefined,
      emergencyAdmin: undefined, ethereumAddress: undefined,
    });
    await indexer.ContractToPoolMapping.set({
      id: `${CHAIN_1}-${POOL_ADDR.toLowerCase()}`,
      pool_id: poolId,
    });
    return poolId;
  }

  it("Supply creates Supply entity and UserReserve", async () => {
    const indexer = createTestIndexer();
    const poolId = await setupPoolAndMapping(indexer);

    const TX_HASH = "0xaabbccdd00000000000000000000000000000000000000000000000000000001";
    const BLOCK_NUM = 16300000;
    const AMOUNT = 1000000000000000000n; // 1 ETH

    await indexer.process({
      chains: {
        [CHAIN_1]: {
          simulate: [
            {
              contract: "Pool",
              event: "Supply",
              srcAddress: POOL_ADDR,
              block: { number: BLOCK_NUM, timestamp: 1672540000 },
              transaction: { hash: TX_HASH },
              params: {
                reserve: WETH_ADDR,
                user: USER_ADDR,
                onBehalfOf: USER_ADDR,
                amount: AMOUNT,
                referralCode: 0n,
              },
            },
          ],
        },
      },
    });

    // Supply entity created
    const supplies = await indexer.Supply.getAll();
    expect(supplies.length).toBe(1);
    expect(supplies[0]!.amount).toBe(AMOUNT);
    expect(supplies[0]!.action).toBe("Supply");
    expect(supplies[0]!.pool_id).toBe(poolId);

    // UserReserve created
    const userReserves = await indexer.UserReserve.getAll();
    expect(userReserves.length).toBe(1);

    // User created
    const user = await indexer.User.get(`${CHAIN_1}-${USER_ADDR.toLowerCase()}`);
    expect(user).toBeDefined();
  });

  it("Borrow creates Borrow entity with correct rate mode", async () => {
    const indexer = createTestIndexer();
    await setupPoolAndMapping(indexer);

    await indexer.process({
      chains: {
        [CHAIN_1]: {
          simulate: [
            {
              contract: "Pool",
              event: "Borrow",
              srcAddress: POOL_ADDR,
              block: { number: 16300100, timestamp: 1672541000 },
              params: {
                reserve: WETH_ADDR,
                user: USER_ADDR,
                onBehalfOf: USER_ADDR,
                amount: 500000000000000000n,
                interestRateMode: 2n, // variable
                borrowRate: 30000000000000000000000000n,
                referralCode: 0n,
              },
            },
          ],
        },
      },
    });

    const borrows = await indexer.Borrow.getAll();
    expect(borrows.length).toBe(1);
    expect(borrows[0]!.amount).toBe(500000000000000000n);
    expect(borrows[0]!.borrowRateMode).toBe(2); // variable = 2 (Int! in schema)
  });

  it("LiquidationCall creates LiquidationCall entity", async () => {
    const indexer = createTestIndexer();
    await setupPoolAndMapping(indexer);

    const DAI_ADDR = "0x6b175474e89094c44da98b954eedeac495271d0f";

    await indexer.process({
      chains: {
        [CHAIN_1]: {
          simulate: [
            {
              contract: "Pool",
              event: "LiquidationCall",
              srcAddress: POOL_ADDR,
              block: { number: 16300200, timestamp: 1672542000 },
              params: {
                collateralAsset: WETH_ADDR,
                debtAsset: DAI_ADDR,
                user: USER_ADDR,
                debtToCover: 200000000000000000000n,
                liquidatedCollateralAmount: 100000000000000000n,
                liquidator: "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
                receiveAToken: false,
              },
            },
          ],
        },
      },
    });

    const liquidations = await indexer.LiquidationCall.getAll();
    expect(liquidations.length).toBe(1);
    expect(liquidations[0]!.principalAmount).toBe(200000000000000000000n);
  });

  it("ReserveDataUpdated updates reserve rates", async () => {
    const indexer = createTestIndexer();
    const poolId = await setupPoolAndMapping(indexer);

    await indexer.process({
      chains: {
        [CHAIN_1]: {
          simulate: [
            {
              contract: "Pool",
              event: "ReserveDataUpdated",
              srcAddress: POOL_ADDR,
              block: { number: 16300300, timestamp: 1672543000 },
              params: {
                reserve: WETH_ADDR,
                liquidityRate: 10000000000000000000000000n,
                stableBorrowRate: 50000000000000000000000000n,
                variableBorrowRate: 30000000000000000000000000n,
                liquidityIndex: 1010000000000000000000000000n,
                variableBorrowIndex: 1020000000000000000000000000n,
              },
            },
          ],
        },
      },
    });

    const reserveId = `${CHAIN_1}-${WETH_ADDR.toLowerCase()}${poolId}`;
    const reserve = await indexer.Reserve.get(reserveId);
    expect(reserve).toBeDefined();
    expect(reserve?.liquidityRate).toBe(10000000000000000000000000n);
    expect(reserve?.variableBorrowRate).toBe(30000000000000000000000000n);
  });
});

// ─── Suite 4: V3 Oracle ───────────────────────────────────────────────────────

describe("V3 AaveOracle", () => {
  it("AssetSourceUpdated creates PriceOracleAsset and registers ChainlinkAggregator", async () => {
    const indexer = createTestIndexer();
    const CHAINLINK_ADDR = "0x5f4ec3df9cbd43714fe2740f5e3616155c5b8419";
    const ORACLE_ADDR = "0x54586be62e3c3580375ae3723c145253060ca0c2";

    // Oracle handler needs ContractToPoolMapping to find which pool this oracle belongs to
    const poolId = `${CHAIN_1}-${PROVIDER_ADDR.toLowerCase()}`;
    await indexer.Protocol.set({ id: `${CHAIN_1}-1` });
    await indexer.Pool.set({
      id: poolId,
      protocol_id: `${CHAIN_1}-1`,
      addressProviderId: 1n,
      active: true, paused: false, lastUpdateTimestamp: 0,
      pool: POOL_ADDR, poolCollateralManager: undefined, poolConfiguratorImpl: undefined,
      poolImpl: undefined, poolDataProviderImpl: undefined, poolConfigurator: CONFIGURATOR_ADDR,
      proxyPriceProvider: undefined, bridgeProtocolFee: undefined,
      flashloanPremiumTotal: undefined, flashloanPremiumToProtocol: undefined,
      lendingRateOracle: undefined, configurationAdmin: undefined,
      emergencyAdmin: undefined, ethereumAddress: undefined,
    });
    await indexer.ContractToPoolMapping.set({
      id: `${CHAIN_1}-${ORACLE_ADDR}`,
      pool_id: poolId,
    });

    const { changes } = await indexer.process({
      chains: {
        [CHAIN_1]: {
          simulate: [
            {
              contract: "AaveOracle",
              event: "AssetSourceUpdated",
              srcAddress: ORACLE_ADDR,
              block: { number: 16291050, timestamp: 1672531250 },
              params: {
                asset: WETH_ADDR,
                source: CHAINLINK_ADDR,
              },
            },
          ],
        },
      },
    });

    const priceAsset = await indexer.PriceOracleAsset.get(
      `${CHAIN_1}-${WETH_ADDR.toLowerCase()}`
    );
    expect(priceAsset).toBeDefined();
    expect(priceAsset?.priceSource).toBe(CHAINLINK_ADDR.toLowerCase());

    // ChainlinkAggregator registered as dynamic contract
    const block = changes.find((c) => c.chainId === CHAIN_1);
    expect(
      block?.addresses?.sets?.some((a) => a.contract === "ChainlinkAggregator")
    ).toBe(true);
  });
});

// ─── Suite 5: GHO Module ─────────────────────────────────────────────────────

describe("GHO Token", () => {
  it("FacilitatorAdded creates Facilitator entity", async () => {
    const indexer = createTestIndexer();
    const BUCKET_CAPACITY = 1000000000000000000000000n; // 1M GHO
    // bytes32 label for "FlashMinter"
    const LABEL =
      "0x466c6173684d696e746572000000000000000000000000000000000000000000";

    await indexer.process({
      chains: {
        [CHAIN_1]: {
          simulate: [
            {
              contract: "GhoToken",
              event: "FacilitatorAdded",
              srcAddress: GHO_TOKEN_ADDR,
              block: { number: 17698500, timestamp: 1689900000 },
              params: {
                facilitatorAddress: FLASH_MINTER_ADDR,
                label: LABEL,
                bucketCapacity: BUCKET_CAPACITY,
              },
            },
          ],
        },
      },
    });

    const facilitatorId = `${CHAIN_1}-${FLASH_MINTER_ADDR.toLowerCase()}`;
    const facilitator = await indexer.Facilitator.get(facilitatorId);

    expect(facilitator).toBeDefined();
    expect(facilitator?.bucketCapacity).toBe(BUCKET_CAPACITY);
    expect(facilitator?.bucketLevel).toBe(0n);
    expect(facilitator?.label).toBe("FlashMinter");
  });

  it("FacilitatorBucketLevelUpdated updates bucketLevel", async () => {
    const indexer = createTestIndexer();
    const facilitatorId = `${CHAIN_1}-${FLASH_MINTER_ADDR.toLowerCase()}`;

    // Pre-create facilitator
    await indexer.Facilitator.set({
      id: facilitatorId,
      bucketCapacity: 1000000000000000000000000n,
      bucketLevel: 0n,
      label: "FlashMinter",
      lifetimeFeesDistributedToTreasury: 0n,
    });

    await indexer.process({
      chains: {
        [CHAIN_1]: {
          simulate: [
            {
              contract: "GhoToken",
              event: "FacilitatorBucketLevelUpdated",
              srcAddress: GHO_TOKEN_ADDR,
              block: { number: 17700000, timestamp: 1689910000 },
              params: {
                facilitatorAddress: FLASH_MINTER_ADDR,
                oldLevel: 0n,
                newLevel: 500000000000000000000000n,
              },
            },
          ],
        },
      },
    });

    const updated = await indexer.Facilitator.get(facilitatorId);
    expect(updated?.bucketLevel).toBe(500000000000000000000000n);
  });
});

// ─── Suite 6: Multichain ID isolation ────────────────────────────────────────

describe("Multichain ID isolation", () => {
  it("Same provider address on chain 1 and 137 creates separate Pool entities", async () => {
    const indexer = createTestIndexer();

    const SHARED_PROVIDER = "0xabc0000000000000000000000000000000000001";
    const REGISTRY_ADDR_137 = "0x3ac4e9aa29940770aeC38fe853a4bbabb2dA9C19";

    await indexer.process({
      chains: {
        [CHAIN_1]: {
          simulate: [
            {
              contract: "PoolAddressesProviderRegistry",
              event: "AddressesProviderRegistered",
              srcAddress: REGISTRY_ADDR_1,
              block: { number: 16291010, timestamp: 1672531200 },
              params: { addressesProvider: SHARED_PROVIDER, id: 1n },
            },
          ],
        },
        [CHAIN_137]: {
          simulate: [
            {
              contract: "PoolAddressesProviderRegistry",
              event: "AddressesProviderRegistered",
              srcAddress: REGISTRY_ADDR_137,
              block: { number: 25824310, timestamp: 1672535000 },
              params: { addressesProvider: SHARED_PROVIDER, id: 1n },
            },
          ],
        },
      },
    });

    const poolId1 = `${CHAIN_1}-${SHARED_PROVIDER.toLowerCase()}`;
    const poolId137 = `${CHAIN_137}-${SHARED_PROVIDER.toLowerCase()}`;

    const pool1 = await indexer.Pool.get(poolId1);
    const pool137 = await indexer.Pool.get(poolId137);

    expect(pool1).toBeDefined();
    expect(pool137).toBeDefined();
    expect(pool1!.id).not.toBe(pool137!.id);
    expect(pool1!.protocol_id).toBe(`${CHAIN_1}-1`);
    expect(pool137!.protocol_id).toBe(`${CHAIN_137}-1`);
  });
});
