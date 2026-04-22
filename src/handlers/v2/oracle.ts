import { V2AaveOracle } from "generated";
import { ZERO_ADDRESS } from "../../utils/constants";
import {
  getPriceOracleAsset,
  getOrInitPriceOracle,
  getPoolByContract,
} from "../../helpers/v3/initializers";

// V2 oracle: same event structure as V3 AaveOracle
// Register ChainlinkAggregator for each asset source

V2AaveOracle.AssetSourceUpdated.contractRegister(({ event, context }) => {
  const source = event.params.source.toLowerCase();
  if (source !== ZERO_ADDRESS) {
    context.addChainlinkAggregator(event.params.source);
  }
});

V2AaveOracle.AssetSourceUpdated.handler(async ({ event, context }) => {
  const chainId = event.chainId;
  const asset = event.params.asset.toLowerCase();
  const source = event.params.source.toLowerCase();

  // Find the pool associated with this oracle via ContractToPoolMapping
  // V2: oracle address is stored as proxyPriceProvider on pool
  // Use chain-level default oracle for V2
  const oracleId = `${chainId}-${event.srcAddress.toLowerCase()}`;
  const oracle = await getOrInitPriceOracle(event.srcAddress.toLowerCase(), chainId, context);

  const priceAsset = await getPriceOracleAsset(asset, oracle.id, chainId, context);

  context.PriceOracleAsset.set({
    ...priceAsset,
    priceSource: source,
    lastUpdateTimestamp: event.block.timestamp,
  });

  if (source !== ZERO_ADDRESS) {
    const aggId = `${chainId}-${source}`;
    const existing = await context.ChainlinkAggregator.get(aggId);
    if (!existing) {
      context.ChainlinkAggregator.set({
        id: aggId,
        oracleAsset_id: priceAsset.id,
      });
    }
  }
});

V2AaveOracle.FallbackOracleUpdated.handler(async ({ event, context }) => {
  const chainId = event.chainId;
  const oracle = await getOrInitPriceOracle(event.srcAddress.toLowerCase(), chainId, context);
  context.PriceOracle.set({
    ...oracle,
    fallbackPriceOracle: event.params.fallbackOracle.toLowerCase(),
    lastUpdateTimestamp: event.block.timestamp,
  });
});
