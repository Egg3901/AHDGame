import type { ObjectId } from "mongodb";
import type { Corporation } from "@/lib/db/types";
import {
  canUnlock,
  getTreeForType,
  sumStrengthGrants,
  techNodeCashCost,
  type TechTreeNode,
} from "@/lib/constants/techTree";
import { resolveCorpLiquidCurrencyCode } from "@/lib/currency/corporationCapital";
import type { TechUnlockLedgerInput } from "@/lib/corporations/techTree/techUnlockLedger";

/**
 * Pick one deterministic, affordable node per turn. Sector-lane nodes win ties
 * because they fit the corporation's industry; deeper nodes win within a lane.
 */
export function pickBestNppTechNode(
  corp: Corporation,
  currentYear: number,
  dailyGrossRevenue: number,
  options: { cashReserve?: number } = {}
): { node: TechTreeNode; cashCost: number } | null {
  const rdScore = corp.rdScore ?? 0;
  const cashAvailable = Math.max(
    0,
    (corp.liquidCapital ?? 0) - Math.max(0, options.cashReserve ?? 0)
  );
  const candidates = getTreeForType(corp.type)
    .map((node) => ({ node, cashCost: techNodeCashCost(node, dailyGrossRevenue) }))
    .filter(
      ({ node, cashCost }) =>
        canUnlock(corp, node.id, currentYear, { rdScore, cashAvailable, cashCost }).ok
    )
    .sort((a, b) => {
      if (a.node.lane !== b.node.lane) return a.node.lane === "sector" ? -1 : 1;
      return b.node.cost - a.node.cost;
    });
  return candidates[0] ?? null;
}

/** One corp bulkWrite entry for the NPP sector-tech-tree auto-unlock. */
export interface NppTechCorpUpdate {
  filter: { _id: ObjectId; unlockedTechNodeIds?: { $ne: string } };
  update: {
    $set?: Record<string, unknown>;
    $inc?: Record<string, number>;
    $addToSet?: { unlockedTechNodeIds: string };
  };
}

/**
 * Sector tech tree: auto-unlock one node per turn when affordable. A separate
 * op from the budget decision (same _id); bulkWrite applies both. The
 * $addToSet plus not-already-owned filter mirror the player unlock's atomic
 * guard: a concurrent write can no longer resurrect a stale
 * unlockedTechNodeIds array or double-add the node.
 */
export function maybePushNppTechUnlock(args: {
  corp: Corporation;
  /** Already-daily gross revenue, converted into the corporation's currency. */
  dailyGrossRevenueLocal: number;
  techCurrentYear: number;
  turn: number;
  now: Date;
  corpUpdates: NppTechCorpUpdate[];
  liquidCapitalDelta?: number;
  cashReserve?: number;
  /**
   * Ledger intents for `flushNppTechUnlockLedger` (ticket #1998). The cash
   * op above still owns the debit; this records what to verify and log
   * after the corporation bulkWrite applies, so autonomous unlocks get the
   * same finance-history debit as manual ones.
   */
  techLedger?: TechUnlockLedgerInput[];
}): void {
  const { corp, techCurrentYear, turn, now } = args;
  const cashAfterDecision = Math.max(0, (corp.liquidCapital ?? 0) + (args.liquidCapitalDelta ?? 0));
  const pick = pickBestNppTechNode(
    { ...corp, liquidCapital: cashAfterDecision },
    techCurrentYear,
    args.dailyGrossRevenueLocal,
    { cashReserve: args.cashReserve }
  );
  if (!pick) return;
  const { node: techNode, cashCost } = pick;
  const grants = sumStrengthGrants(techNode.effects);
  const techInc: Record<string, number> = {
    rdScore: -techNode.cost,
    liquidCapital: -cashCost,
  };
  if (grants.marketingStrength > 0) techInc.marketingStrength = grants.marketingStrength;
  if (grants.logisticsStrength > 0) techInc.logisticsStrength = grants.logisticsStrength;
  const committing = !(corp.techDecadeLane ?? {})[techNode.decadeId];
  const techSet: Record<string, unknown> = { updatedAt: now };
  if (committing) {
    techSet[`techDecadeLane.${techNode.decadeId}`] = techNode.lane;
    techSet[`techDecadeChosenTurn.${techNode.decadeId}`] = turn;
  }
  args.corpUpdates.push({
    filter: { _id: corp._id, unlockedTechNodeIds: { $ne: techNode.id } },
    update: {
      $set: techSet,
      $inc: techInc,
      $addToSet: { unlockedTechNodeIds: techNode.id },
    },
  });
  args.techLedger?.push({
    corporationId: corp._id,
    corporationName: corp.name ?? "Corporation",
    corporationSequentialId: corp.sequentialId,
    nodeId: techNode.id,
    nodeName: techNode.name,
    decadeId: techNode.decadeId,
    lane: techNode.lane,
    slot: techNode.slot,
    rdCost: techNode.cost,
    cashCost,
    currencyCode: resolveCorpLiquidCurrencyCode(corp) ?? "USD",
    turn,
    createdAt: now,
    alreadyOwned: [...(corp.unlockedTechNodeIds ?? [])],
    marketingGrant: grants.marketingStrength,
    logisticsGrant: grants.logisticsStrength,
    committing,
  });
}
