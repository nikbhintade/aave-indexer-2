import { RewardsController } from "generated";
import type {
  Entity,
  Reward,
  UserReward,
  RewardedAction,
  ClaimRewardsCall,
  RewardFeedOracle,
} from "generated";

type RewardsControllerEntity = Entity<"RewardsController">;
import { getOrInitUser } from "../helpers/v3/initializers";
import { getHistoryEntityId } from "../utils/id-generation";
import { getSubTokenId } from "../utils/id-generation";
import { ZERO_BI } from "../utils/constants";

function getRewardsControllerId(chainId: number, address: string): string {
  return `${chainId}-${address.toLowerCase()}`;
}

function getRewardId(
  chainId: number,
  rewardsController: string,
  asset: string,
  reward: string
): string {
  return `${chainId}-${rewardsController.toLowerCase()}:${asset.toLowerCase()}:${reward.toLowerCase()}`;
}

// ─── EmissionManagerUpdated ───────────────────────────────────────────────────

RewardsController.EmissionManagerUpdated.handler(async ({ event, context }) => {
  const chainId = event.chainId;
  const controllerId = getRewardsControllerId(chainId, event.srcAddress);

  const existing = await context.RewardsController.get(controllerId);
  if (!existing) {
    const controller: RewardsControllerEntity = { id: controllerId };
    context.RewardsController.set(controller);
  }
});

// ─── AssetConfigUpdated ───────────────────────────────────────────────────────

RewardsController.AssetConfigUpdated.handler(async ({ event, context }) => {
  const chainId = event.chainId;
  const controllerId = getRewardsControllerId(chainId, event.srcAddress);
  const blockTimestamp = event.block.timestamp;
  const assetAddress = event.params.asset.toLowerCase();
  const rewardAddress = event.params.reward.toLowerCase();

  // Ensure RewardsController entity exists
  const existing = await context.RewardsController.get(controllerId);
  if (!existing) {
    const controller: RewardsControllerEntity = { id: controllerId };
    context.RewardsController.set(controller);
  }

  const rewardId = getRewardId(chainId, event.srcAddress, assetAddress, rewardAddress);
  const subtokenId = getSubTokenId(assetAddress, chainId);

  let reward = await context.Reward.get(rewardId);
  if (!reward) {
    // Ensure oracle entry exists (rewardFeedAddress set on RewardOracleUpdated)
    const oracleId = `${chainId}-${rewardAddress}`;
    const existingOracle = await context.RewardFeedOracle.get(oracleId);
    if (!existingOracle) {
      const oracle: RewardFeedOracle = {
        id: oracleId,
        rewardFeedAddress: "",
        createdAt: blockTimestamp,
        updatedAt: blockTimestamp,
      };
      context.RewardFeedOracle.set(oracle);
    }

    const newReward: Reward = {
      id: rewardId,
      rewardToken: rewardAddress,
      asset_id: subtokenId,
      rewardTokenDecimals: 18, // TODO: fetch via Effect API (IERC20Detailed.decimals)
      rewardTokenSymbol: "", // TODO: fetch via Effect API (IERC20Detailed.symbol)
      precision: 18, // TODO: fetch via Effect API (RewardsController.getAssetDecimals)
      rewardFeedOracle_id: oracleId,
      rewardsController_id: controllerId,
      index: event.params.assetIndex,
      distributionEnd: Number(event.params.newDistributionEnd),
      emissionsPerSecond: event.params.newEmission,
      createdAt: blockTimestamp,
      updatedAt: blockTimestamp,
    };
    context.Reward.set(newReward);
  } else {
    context.Reward.set({
      ...reward,
      index: event.params.assetIndex,
      distributionEnd: Number(event.params.newDistributionEnd),
      emissionsPerSecond: event.params.newEmission,
      updatedAt: blockTimestamp,
    });
  }
});

// ─── Accrued ─────────────────────────────────────────────────────────────────

RewardsController.Accrued.handler(async ({ event, context }) => {
  const chainId = event.chainId;
  const controllerId = getRewardsControllerId(chainId, event.srcAddress);
  const blockTimestamp = event.block.timestamp;
  const userAddress = event.params.user.toLowerCase();
  const assetAddress = event.params.asset.toLowerCase();
  const rewardAddress = event.params.reward.toLowerCase();
  const amount = event.params.rewardsAccrued;

  // Update user stats
  const user = await getOrInitUser(userAddress, chainId, context);
  context.User.set({
    ...user,
    unclaimedRewards: user.unclaimedRewards + amount,
    lifetimeRewards: user.lifetimeRewards + amount,
    rewardsLastUpdated: blockTimestamp,
  });

  // Update reward index
  const rewardId = getRewardId(chainId, event.srcAddress, assetAddress, rewardAddress);
  const reward = await context.Reward.get(rewardId);
  if (reward) {
    context.Reward.set({ ...reward, index: event.params.assetIndex, updatedAt: blockTimestamp });
  }

  // Update/create UserReward
  const userRewardId = `${rewardId}:${userAddress}`;
  const existingUserReward = await context.UserReward.get(userRewardId);
  if (!existingUserReward) {
    const userReward: UserReward = {
      id: userRewardId,
      reward_id: rewardId,
      user_id: `${chainId}-${userAddress}`,
      index: event.params.userIndex,
      createdAt: blockTimestamp,
      updatedAt: blockTimestamp,
    };
    context.UserReward.set(userReward);
  } else {
    context.UserReward.set({
      ...existingUserReward,
      index: event.params.userIndex,
      updatedAt: blockTimestamp,
    });
  }

  // Create RewardedAction
  const actionId = `${chainId}:${getHistoryEntityId(chainId, event.block.number, event.transaction?.hash ?? "", event.logIndex)}`;
  const rewardedAction: RewardedAction = {
    id: actionId,
    rewardsController_id: controllerId,
    user_id: `${chainId}-${userAddress}`,
    amount,
  };
  context.RewardedAction.set(rewardedAction);
});

// ─── RewardsClaimed ───────────────────────────────────────────────────────────

RewardsController.RewardsClaimed.handler(async ({ event, context }) => {
  const chainId = event.chainId;
  const controllerId = getRewardsControllerId(chainId, event.srcAddress);
  const onBehalfOf = event.params.user.toLowerCase();
  const toAddress = event.params.to.toLowerCase();
  const callerAddress = event.params.claimer.toLowerCase();
  const amount = event.params.amount;

  const user = await getOrInitUser(onBehalfOf, chainId, context);
  const claimedRewards = user.unclaimedRewards > amount ? user.unclaimedRewards - amount : ZERO_BI;
  context.User.set({
    ...user,
    unclaimedRewards: claimedRewards,
    rewardsLastUpdated: event.block.timestamp,
  });

  await getOrInitUser(toAddress, chainId, context);
  await getOrInitUser(callerAddress, chainId, context);

  const claimId = `${chainId}:${getHistoryEntityId(chainId, event.block.number, event.transaction?.hash ?? "", event.logIndex)}`;
  const claimRewards: ClaimRewardsCall = {
    id: claimId,
    txHash: event.transaction?.hash ?? "",
    user_id: `${chainId}-${onBehalfOf}`,
    to_id: `${chainId}-${toAddress}`,
    caller_id: `${chainId}-${callerAddress}`,
    amount,
    rewardsController_id: controllerId,
    action: "ClaimRewardsCall",
    timestamp: event.block.timestamp,
  };
  context.ClaimRewardsCall.set(claimRewards);
});

// ─── RewardOracleUpdated ──────────────────────────────────────────────────────

RewardsController.RewardOracleUpdated.handler(async ({ event, context }) => {
  const chainId = event.chainId;
  const rewardAddress = event.params.reward.toLowerCase();
  const oracleAddress = event.params.rewardOracle.toLowerCase();
  const oracleId = `${chainId}-${rewardAddress}`;
  const blockTimestamp = event.block.timestamp;

  const existing = await context.RewardFeedOracle.get(oracleId);
  if (!existing) {
    const oracle: RewardFeedOracle = {
      id: oracleId,
      rewardFeedAddress: oracleAddress,
      createdAt: blockTimestamp,
      updatedAt: blockTimestamp,
    };
    context.RewardFeedOracle.set(oracle);
  } else {
    context.RewardFeedOracle.set({
      ...existing,
      rewardFeedAddress: oracleAddress,
      updatedAt: blockTimestamp,
    });
  }
});
