import { AaveIncentivesController } from "generated";
import type { IncentivesController, IncentivizedAction, ClaimIncentiveCall } from "generated";
import { getOrInitUser } from "../../helpers/v3/initializers";
import { getHistoryEntityId } from "../../utils/id-generation";
import { ZERO_BI } from "../../utils/constants";

async function getOrInitIncentivesController(
  address: string,
  chainId: number,
  context: any
): Promise<IncentivesController> {
  const id = `${chainId}-${address}`;
  const existing = await context.IncentivesController.get(id);
  if (existing) return existing;
  const controller: IncentivesController = {
    id,
    rewardToken: "0x0000000000000000000000000000000000000000",
    rewardTokenDecimals: 18,
    rewardTokenSymbol: "",
    precision: 18,
    emissionEndTimestamp: 0,
  };
  context.IncentivesController.set(controller);
  return controller;
}

// ─── AaveIncentivesController.AssetConfigUpdated ─────────────────────────────

AaveIncentivesController.AssetConfigUpdated.handler(async ({ event, context }) => {
  const chainId = event.chainId;
  const tokenAddress = event.params.asset.toLowerCase();
  const emission = event.params.emission;
  const timestamp = event.block.timestamp;

  // Look up MapAssetPool to find reserve
  const mapEntry = await context.MapAssetPool.get(`${chainId}-${tokenAddress}`);
  if (!mapEntry) return;

  const reserve = await context.Reserve.get(`${chainId}-${mapEntry.underlyingAsset}-${mapEntry.pool}`);
  if (!reserve) {
    // Try alternative reserve ID format used in V3 initializers
    const reserveId = `${mapEntry.pool}-${mapEntry.underlyingAsset}`;
    const res = await context.Reserve.get(reserveId);
    if (!res) return;

    // Determine which token type this is
    if (res.aToken_id === `${chainId}-${tokenAddress}`) {
      context.Reserve.set({ ...res, aEmissionPerSecond: emission, aIncentivesLastUpdateTimestamp: timestamp });
    } else if (res.vToken_id === `${chainId}-${tokenAddress}`) {
      context.Reserve.set({ ...res, vEmissionPerSecond: emission, vIncentivesLastUpdateTimestamp: timestamp });
    } else if (res.sToken_id === `${chainId}-${tokenAddress}`) {
      context.Reserve.set({ ...res, sEmissionPerSecond: emission, sIncentivesLastUpdateTimestamp: timestamp });
    }
    return;
  }

  if (reserve.aToken_id === `${chainId}-${tokenAddress}`) {
    context.Reserve.set({ ...reserve, aEmissionPerSecond: emission, aIncentivesLastUpdateTimestamp: timestamp });
  } else if (reserve.vToken_id === `${chainId}-${tokenAddress}`) {
    context.Reserve.set({ ...reserve, vEmissionPerSecond: emission, vIncentivesLastUpdateTimestamp: timestamp });
  } else if (reserve.sToken_id === `${chainId}-${tokenAddress}`) {
    context.Reserve.set({ ...reserve, sEmissionPerSecond: emission, sIncentivesLastUpdateTimestamp: timestamp });
  }
});

// ─── AaveIncentivesController.RewardsAccrued ─────────────────────────────────

AaveIncentivesController.RewardsAccrued.handler(async ({ event, context }) => {
  const chainId = event.chainId;
  const controllerAddress = event.srcAddress.toLowerCase();
  const userAddress = event.params.user.toLowerCase();

  const user = await getOrInitUser(userAddress, chainId, context);
  context.User.set({
    ...user,
    unclaimedRewards: user.unclaimedRewards + event.params.amount,
    lifetimeRewards: user.lifetimeRewards + event.params.amount,
    rewardsLastUpdated: event.block.timestamp,
  });

  const controller = await getOrInitIncentivesController(controllerAddress, chainId, context);

  const id = `${chainId}:${getHistoryEntityId(chainId, event.block.number, event.transaction?.hash ?? "", event.logIndex)}`;
  const action: IncentivizedAction = {
    id,
    incentivesController_id: controller.id,
    user_id: user.id,
    amount: event.params.amount,
  };
  context.IncentivizedAction.set(action);
});

// ─── AaveIncentivesController.RewardsClaimed ─────────────────────────────────

AaveIncentivesController.RewardsClaimed.handler(async ({ event, context }) => {
  const chainId = event.chainId;
  const controllerAddress = event.srcAddress.toLowerCase();
  const userAddress = event.params.user.toLowerCase();

  const user = await getOrInitUser(userAddress, chainId, context);
  const newUnclaimed = user.unclaimedRewards > event.params.amount
    ? user.unclaimedRewards - event.params.amount
    : 0n;
  context.User.set({
    ...user,
    unclaimedRewards: newUnclaimed,
    rewardsLastUpdated: event.block.timestamp,
  });

  const controller = await getOrInitIncentivesController(controllerAddress, chainId, context);

  const id = `${chainId}:${getHistoryEntityId(chainId, event.block.number, event.transaction?.hash ?? "", event.logIndex)}`;
  const claim: ClaimIncentiveCall = {
    id,
    incentivesController_id: controller.id,
    user_id: user.id,
    amount: event.params.amount,
  };
  context.ClaimIncentiveCall.set(claim);
});

// ─── AaveIncentivesController.DistributionEndUpdated ─────────────────────────

AaveIncentivesController.DistributionEndUpdated.handler(async ({ event, context }) => {
  const chainId = event.chainId;
  const controllerAddress = event.srcAddress.toLowerCase();
  const controller = await getOrInitIncentivesController(controllerAddress, chainId, context);
  context.IncentivesController.set({
    ...controller,
    emissionEndTimestamp: Number(event.params.ditributionEnd),
  });
});
