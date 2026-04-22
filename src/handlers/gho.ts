import { GhoToken, GhoFlashMinter, GhoVariableDebtToken } from "generated";
import type {
  Entity,
  HandlerContext,
  Facilitator,
  FacilitatorLevelUpdated,
  FacilitatorCapacityUpdated,
  FacilitatorTreasuryDistribution,
  FacilitatorTreasuryUpdated,
  GhoFlashMint,
  GhoFlashMinterFeeUpdate,
  GhoDiscount,
  GhoDiscountHistoryItem,
  GhoDiscountTokenUpdate,
} from "generated";
import { bytes32ToString } from "../helpers/v3/initializers";
import { getHistoryEntityId } from "../utils/id-generation";
import { ZERO_BI, ZERO_ADDRESS } from "../utils/constants";

// GhoFlashMinter entity name conflicts with contract handler value
type GhoFlashMinterEntity = Entity<"GhoFlashMinter">;

function getGhoDiscountId(chainId: number): string {
  return `${chainId}-1`;
}

async function getOrInitGhoDiscount(
  chainId: number,
  context: HandlerContext
): Promise<GhoDiscount> {
  const id = getGhoDiscountId(chainId);
  const existing = await context.GhoDiscount.get(id);
  if (existing) return existing;
  const discount: GhoDiscount = {
    id,
    discountToken: ZERO_ADDRESS,
    discountRate: ZERO_BI,
    ghoDiscountedPerDiscountToken: ZERO_BI,
    minDebtTokenBalance: ZERO_BI,
    minDiscountTokenBalance: ZERO_BI,
  };
  context.GhoDiscount.set(discount);
  return discount;
}

// ─── GhoToken.FacilitatorAdded ────────────────────────────────────────────────

GhoToken.FacilitatorAdded.handler(async ({ event, context }) => {
  const chainId = event.chainId;
  const facilitatorAddress = event.params.facilitatorAddress.toLowerCase();
  const id = `${chainId}-${facilitatorAddress}`;
  const label = bytes32ToString(event.params.label);

  const facilitator: Facilitator = {
    id,
    bucketCapacity: event.params.bucketCapacity,
    bucketLevel: ZERO_BI,
    label,
    lifetimeFeesDistributedToTreasury: ZERO_BI,
  };
  context.Facilitator.set(facilitator);
});

// ─── GhoToken.FacilitatorRemoved ─────────────────────────────────────────────

GhoToken.FacilitatorRemoved.handler(async ({ event, context }) => {
  const chainId = event.chainId;
  const facilitatorAddress = event.params.facilitatorAddress.toLowerCase();
  const id = `${chainId}-${facilitatorAddress}`;

  const existing = await context.Facilitator.get(id);
  if (!existing) return;
  // Mark as removed by zeroing caps (soft delete — Envio has no entity deletion)
  context.Facilitator.set({ ...existing, bucketCapacity: ZERO_BI, bucketLevel: ZERO_BI });
});

// ─── GhoToken.FacilitatorBucketLevelUpdated ───────────────────────────────────

GhoToken.FacilitatorBucketLevelUpdated.handler(async ({ event, context }) => {
  const chainId = event.chainId;
  const facilitatorAddress = event.params.facilitatorAddress.toLowerCase();
  const id = `${chainId}-${facilitatorAddress}`;

  const facilitator = await context.Facilitator.get(id);
  if (!facilitator) return;

  context.Facilitator.set({ ...facilitator, bucketLevel: event.params.newLevel });

  const updateId = `${id}:${getHistoryEntityId(chainId, event.block.number, event.transaction?.hash ?? "", event.logIndex)}`;
  const levelUpdate: FacilitatorLevelUpdated = {
    id: updateId,
    txHash: event.transaction?.hash ?? "",
    facilitator_id: id,
    oldBucketLevel: event.params.oldLevel,
    newBucketLevel: event.params.newLevel,
  };
  context.FacilitatorLevelUpdated.set(levelUpdate);
});

// ─── GhoToken.FacilitatorBucketCapacityUpdated ────────────────────────────────

GhoToken.FacilitatorBucketCapacityUpdated.handler(async ({ event, context }) => {
  const chainId = event.chainId;
  const facilitatorAddress = event.params.facilitatorAddress.toLowerCase();
  const id = `${chainId}-${facilitatorAddress}`;

  const facilitator = await context.Facilitator.get(id);
  if (!facilitator) return;

  context.Facilitator.set({ ...facilitator, bucketCapacity: event.params.newCapacity });

  const updateId = `${id}:${getHistoryEntityId(chainId, event.block.number, event.transaction?.hash ?? "", event.logIndex)}`;
  const capacityUpdate: FacilitatorCapacityUpdated = {
    id: updateId,
    txHash: event.transaction?.hash ?? "",
    facilitator_id: id,
    oldBucketCapacity: event.params.oldCapacity,
    newBucketCapacity: event.params.newCapacity,
  };
  context.FacilitatorCapacityUpdated.set(capacityUpdate);
});

// ─── Helper: ensure GhoFlashMinter entity exists ──────────────────────────────

async function getOrInitGhoFlashMinterEntity(
  chainId: number,
  address: string,
  context: HandlerContext
): Promise<GhoFlashMinterEntity> {
  const id = `${chainId}-${address}`;
  const existing = await context.GhoFlashMinter.get(id) as GhoFlashMinterEntity | undefined;
  if (existing) return existing;

  // Ensure facilitator entity exists
  const facilitatorId = `${chainId}-${address}`;
  const existingFacilitator = await context.Facilitator.get(facilitatorId);
  if (!existingFacilitator) {
    const facilitator: Facilitator = {
      id: facilitatorId,
      bucketCapacity: ZERO_BI,
      bucketLevel: ZERO_BI,
      label: "FlashMinter",
      lifetimeFeesDistributedToTreasury: ZERO_BI,
    };
    context.Facilitator.set(facilitator);
  }

  const flashMinter: GhoFlashMinterEntity = {
    id,
    facilitator_id: facilitatorId,
    fee: ZERO_BI,      // TODO: fetch via Effect API (GhoFlashMinter.getFee)
    maxFee: ZERO_BI,   // TODO: fetch via Effect API (GhoFlashMinter.MAX_FEE)
  };
  context.GhoFlashMinter.set(flashMinter);
  return flashMinter;
}

// ─── GhoFlashMinter.FeeUpdated ────────────────────────────────────────────────

GhoFlashMinter.FeeUpdated.handler(async ({ event, context }) => {
  const chainId = event.chainId;
  const address = event.srcAddress.toLowerCase();
  const id = `${chainId}-${address}`;

  const flashMinter = await getOrInitGhoFlashMinterEntity(chainId, address, context);
  context.GhoFlashMinter.set({ ...flashMinter, fee: event.params.newFee });

  const feeUpdateId = `${id}:${getHistoryEntityId(chainId, event.block.number, event.transaction?.hash ?? "", event.logIndex)}`;
  const feeUpdate: GhoFlashMinterFeeUpdate = {
    id: feeUpdateId,
    txHash: event.transaction?.hash ?? "",
    ghoFlashMinter_id: id,
    oldFee: event.params.oldFee,
    newFee: event.params.newFee,
  };
  context.GhoFlashMinterFeeUpdate.set(feeUpdate);
});

// ─── GhoFlashMinter.FlashMint ─────────────────────────────────────────────────

GhoFlashMinter.FlashMint.handler(async ({ event, context }) => {
  const chainId = event.chainId;
  const address = event.srcAddress.toLowerCase();
  const id = `${chainId}-${address}`;

  await getOrInitGhoFlashMinterEntity(chainId, address, context);

  const flashMintId = `${id}:${getHistoryEntityId(chainId, event.block.number, event.transaction?.hash ?? "", event.logIndex)}`;
  const flashMint: GhoFlashMint = {
    id: flashMintId,
    ghoFlashMinter_id: id,
    receiver: event.params.receiver.toLowerCase(),
    initiator: event.params.initiator.toLowerCase(),
    amount: event.params.amount,
    fee: event.params.fee,
    timestamp: event.block.timestamp,
  };
  context.GhoFlashMint.set(flashMint);
});

// ─── GhoFlashMinter.FeesDistributedToTreasury ─────────────────────────────────

GhoFlashMinter.FeesDistributedToTreasury.handler(async ({ event, context }) => {
  const chainId = event.chainId;
  const facilitatorAddress = event.srcAddress.toLowerCase();
  const id = `${chainId}-${facilitatorAddress}`;

  const facilitator = await context.Facilitator.get(id);
  if (!facilitator) return;

  const newLifetime = facilitator.lifetimeFeesDistributedToTreasury + event.params.amount;
  context.Facilitator.set({ ...facilitator, lifetimeFeesDistributedToTreasury: newLifetime });

  const historyId = `${id}:${getHistoryEntityId(chainId, event.block.number, event.transaction?.hash ?? "", event.logIndex)}`;
  const distribution: FacilitatorTreasuryDistribution = {
    id: historyId,
    txHash: event.transaction?.hash ?? "",
    facilitator_id: id,
    treasury: event.params.ghoTreasury.toLowerCase(),
    amount: event.params.amount,
    newLifetimeFeesDistributedToTreasury: newLifetime,
  };
  context.FacilitatorTreasuryDistribution.set(distribution);
});

// ─── GhoFlashMinter.GhoTreasuryUpdated ────────────────────────────────────────

GhoFlashMinter.GhoTreasuryUpdated.handler(async ({ event, context }) => {
  const chainId = event.chainId;
  const facilitatorAddress = event.srcAddress.toLowerCase();
  const id = `${chainId}-${facilitatorAddress}`;

  const facilitator = await context.Facilitator.get(id);
  if (!facilitator) return;

  const historyId = `${id}:${getHistoryEntityId(chainId, event.block.number, event.transaction?.hash ?? "", event.logIndex)}`;
  const treasuryUpdate: FacilitatorTreasuryUpdated = {
    id: historyId,
    txHash: event.transaction?.hash ?? "",
    facilitator_id: id,
    previousTreasury: event.params.oldGhoTreasury.toLowerCase(),
    newTreasury: event.params.newGhoTreasury.toLowerCase(),
  };
  context.FacilitatorTreasuryUpdated.set(treasuryUpdate);
});

// ─── GhoVariableDebtToken.DiscountRateStrategyUpdated ─────────────────────────

GhoVariableDebtToken.DiscountRateStrategyUpdated.handler(async ({ event, context }) => {
  const chainId = event.chainId;
  const ghoDiscount = await getOrInitGhoDiscount(chainId, context);

  // RPC calls for discount parameters deferred — set zeroes with TODO
  // TODO: fetch via Effect API: DISCOUNT_RATE, GHO_DISCOUNTED_PER_DISCOUNT_TOKEN,
  // MIN_DEBT_TOKEN_BALANCE, MIN_DISCOUNT_TOKEN_BALANCE from GhoDiscountRateStrategy contract

  const historyId = `${chainId}:${getHistoryEntityId(chainId, event.block.number, event.transaction?.hash ?? "", event.logIndex)}`;
  const historyItem: GhoDiscountHistoryItem = {
    id: historyId,
    txHash: event.transaction?.hash ?? "",
    ghoDiscount_id: ghoDiscount.id,
    oldGhoDiscountStrategy: event.params.oldDiscountRateStrategy.toLowerCase(),
    newGhoDiscountStrategy: event.params.newDiscountRateStrategy.toLowerCase(),
    newDiscountRate: ghoDiscount.discountRate,
    newGhoDiscountedPerDiscountToken: ghoDiscount.ghoDiscountedPerDiscountToken,
    newMinDebtTokenBalance: ghoDiscount.minDebtTokenBalance,
    newMinDiscountTokenBalance: ghoDiscount.minDiscountTokenBalance,
  };
  context.GhoDiscountHistoryItem.set(historyItem);
});

// ─── GhoVariableDebtToken.DiscountTokenUpdated ────────────────────────────────

GhoVariableDebtToken.DiscountTokenUpdated.handler(async ({ event, context }) => {
  const chainId = event.chainId;
  const ghoDiscount = await getOrInitGhoDiscount(chainId, context);
  const newDiscountToken = event.params.newDiscountToken.toLowerCase();

  context.GhoDiscount.set({ ...ghoDiscount, discountToken: newDiscountToken });

  const updateId = `${chainId}:${getHistoryEntityId(chainId, event.block.number, event.transaction?.hash ?? "", event.logIndex)}`;
  const tokenUpdate: GhoDiscountTokenUpdate = {
    id: updateId,
    txHash: event.transaction?.hash ?? "",
    ghoDiscount_id: ghoDiscount.id,
    oldDiscountToken: event.params.oldDiscountToken.toLowerCase(),
    newDiscountToken,
  };
  context.GhoDiscountTokenUpdate.set(tokenUpdate);
});
