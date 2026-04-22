import { AaveOracle, ChainlinkAggregator } from "generated";
import type {
  HandlerContext,
  Entity,
  PriceHistoryItem,
  UsdEthPriceHistoryItem,
} from "generated";
import {
  getOrInitPriceOracle,
  getPriceOracleAsset,
  getChainlinkAggregator,
  getPoolByContract,
} from "../helpers/v3/initializers";
import { formatUsdEthChainlinkPrice } from "../utils/converters";
import { MOCK_USD_ADDRESS, ZERO_ADDRESS, ZERO_BI } from "../utils/constants";

// ChainlinkAggregator entity name conflicts with contract handler value
type ChainlinkAggregatorEntity = Entity<"ChainlinkAggregator">;

async function genericPriceUpdate(
  assetAddress: string,
  oracleId: string,
  chainId: number,
  price: bigint,
  timestamp: number,
  blockNumber: number,
  context: HandlerContext
): Promise<void> {
  const priceAsset = await getPriceOracleAsset(assetAddress, oracleId, chainId, context);
  const updated = { ...priceAsset, priceInEth: price, lastUpdateTimestamp: timestamp };
  context.PriceOracleAsset.set(updated);

  const historyId = `${chainId}-${assetAddress}-${blockNumber}`;
  const history: PriceHistoryItem = {
    id: historyId,
    asset_id: updated.id,
    price,
    timestamp,
  };
  context.PriceHistoryItem.set(history);
}

async function usdEthPriceUpdate(
  oracleId: string,
  chainId: number,
  price: bigint,
  timestamp: number,
  blockNumber: number,
  txIndex: number,
  context: HandlerContext
): Promise<void> {
  const priceOracle = await getOrInitPriceOracle(oracleId.replace(`${chainId}-`, ""), chainId, context);
  const updated = { ...priceOracle, usdPriceEth: price, lastUpdateTimestamp: timestamp };
  context.PriceOracle.set(updated);

  const usdHistoryId = `${chainId}-${blockNumber}-${txIndex}`;
  const usdHistory: UsdEthPriceHistoryItem = {
    id: usdHistoryId,
    oracle_id: updated.id,
    price,
    timestamp,
  };
  context.UsdEthPriceHistoryItem.set(usdHistory);
}

// ─── AaveOracle.AssetSourceUpdated ───────────────────────────────────────────

AaveOracle.AssetSourceUpdated.contractRegister(({ event, context }) => {
  const source = event.params.source.toLowerCase();
  if (source !== ZERO_ADDRESS) {
    context.addChainlinkAggregator(event.params.source);
  }
});

AaveOracle.AssetSourceUpdated.handler(async ({ event, context }) => {
  const chainId = event.chainId;
  const assetAddress = event.params.asset.toLowerCase();
  const sourceAddress = event.params.source.toLowerCase();

  // Find the oracle for this pool (AaveOracle is registered per pool)
  const poolId = await getPoolByContract(chainId, event.srcAddress.toLowerCase(), context).catch(() => null);
  if (!poolId) return;

  const pool = await context.Pool.get(poolId);
  if (!pool) return;

  const oracleAddress = pool.proxyPriceProvider ?? `${chainId}-0`;
  const oracle = await getOrInitPriceOracle(oracleAddress, chainId, context);

  if (oracle.proxyPriceProvider === ZERO_ADDRESS) {
    context.PriceOracle.set({ ...oracle, proxyPriceProvider: event.srcAddress.toLowerCase() });
  }

  const priceAsset = await getPriceOracleAsset(assetAddress, oracle.id, chainId, context);
  context.PriceOracleAsset.set({
    ...priceAsset,
    priceSource: sourceAddress,
    fromChainlinkSourcesRegistry: false,
  });

  // Register ChainlinkAggregator entity linking source → asset
  if (sourceAddress !== ZERO_ADDRESS) {
    const agg = await getChainlinkAggregator(sourceAddress, chainId, context);
    context.ChainlinkAggregator.set({ ...agg, oracleAsset_id: priceAsset.id });
  }
});

// ─── AaveOracle.FallbackOracleUpdated ────────────────────────────────────────

AaveOracle.FallbackOracleUpdated.handler(async ({ event, context }) => {
  const chainId = event.chainId;
  const poolId = await getPoolByContract(chainId, event.srcAddress.toLowerCase(), context).catch(() => null);
  if (!poolId) return;

  const pool = await context.Pool.get(poolId);
  if (!pool) return;

  const oracleAddress = pool.proxyPriceProvider ?? `${chainId}-0`;
  const oracle = await getOrInitPriceOracle(oracleAddress, chainId, context);
  context.PriceOracle.set({
    ...oracle,
    fallbackPriceOracle: event.params.fallbackOracle.toLowerCase(),
    lastUpdateTimestamp: event.block.timestamp,
  });
});

// ─── AaveOracle.BaseCurrencySet ───────────────────────────────────────────────

AaveOracle.BaseCurrencySet.handler(async ({ event, context }) => {
  const chainId = event.chainId;
  const poolId = await getPoolByContract(chainId, event.srcAddress.toLowerCase(), context).catch(() => null);
  if (!poolId) return;

  const pool = await context.Pool.get(poolId);
  if (!pool) return;

  const oracleAddress = pool.proxyPriceProvider ?? `${chainId}-0`;
  const oracle = await getOrInitPriceOracle(oracleAddress, chainId, context);
  context.PriceOracle.set({
    ...oracle,
    baseCurrency: event.params.baseCurrency.toLowerCase(),
    baseCurrencyUnit: event.params.baseCurrencyUnit,
  });
});

// ─── ChainlinkAggregator.AnswerUpdated ───────────────────────────────────────

ChainlinkAggregator.AnswerUpdated.handler(async ({ event, context }) => {
  const chainId = event.chainId;
  const aggregatorAddress = event.srcAddress.toLowerCase();
  const aggId = `${chainId}-${aggregatorAddress}`;

  const agg = await context.ChainlinkAggregator.get(aggId) as ChainlinkAggregatorEntity | undefined;
  if (!agg) return;

  const price = event.params.current;

  // Get the oracle asset linked to this aggregator
  const priceAsset = await context.PriceOracleAsset.get(agg.oracleAsset_id);
  if (!priceAsset) return;

  const oracle = await context.PriceOracle.get(priceAsset.oracle_id);
  if (!oracle) return;

  const assetId = priceAsset.id.replace(`${chainId}-`, "");

  // If this aggregator is the USD/ETH source
  if (oracle.usdPriceEthMainSource === aggregatorAddress) {
    if (price > ZERO_BI) {
      context.PriceOracle.set({ ...oracle, usdPriceEthFallbackRequired: false });
      await usdEthPriceUpdate(
        oracle.id.replace(`${chainId}-`, ""),
        chainId,
        formatUsdEthChainlinkPrice(price),
        event.block.timestamp,
        event.block.number,
        event.logIndex,
        context
      );
    } else {
      context.PriceOracle.set({ ...oracle, usdPriceEthFallbackRequired: true });
    }
    return;
  }

  // Check if this aggregator is still the current price source for the asset
  if (priceAsset.priceSource !== aggregatorAddress) return;

  if (price > ZERO_BI) {
    const updatedAsset = {
      ...priceAsset,
      priceInEth: price,
      isFallbackRequired: false,
      lastUpdateTimestamp: event.block.timestamp,
    };
    context.PriceOracleAsset.set(updatedAsset);

    // Handle USD main source update
    if (assetId === MOCK_USD_ADDRESS) {
      context.PriceOracle.set({
        ...oracle,
        usdPriceEthMainSource: aggregatorAddress,
        usdPriceEthFallbackRequired: false,
      });
      await usdEthPriceUpdate(
        oracle.id.replace(`${chainId}-`, ""),
        chainId,
        formatUsdEthChainlinkPrice(price),
        event.block.timestamp,
        event.block.number,
        event.logIndex,
        context
      );
    }

    const historyId = `${chainId}-${priceAsset.id}-${event.block.number}`;
    const history: PriceHistoryItem = {
      id: historyId,
      asset_id: priceAsset.id,
      price,
      timestamp: event.block.timestamp,
    };
    context.PriceHistoryItem.set(history);
  } else {
    context.PriceOracleAsset.set({ ...priceAsset, isFallbackRequired: true });
  }
});
