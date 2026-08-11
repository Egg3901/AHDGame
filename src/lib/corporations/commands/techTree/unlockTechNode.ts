import type { Db } from "mongodb";
import type { Corporation, CorporateSector } from "@/lib/db/types";
import { sectorEconomicScale } from "@/lib/corporations/sectorProfitBasis";
import { getMarketSystemModeForDb, marketAtLeast } from "@/lib/market/featureFlag";
import { loadWorldEraUnitScale } from "@/lib/currency/gdpAnchorRate";
import {
  canUnlock,
  getCommittedLane,
  getNodePrereqId,
  sumStrengthGrants,
  techNodeCashCost,
  type CanUnlockResult,
  type UnlockBlockReason,
} from "@/lib/constants/techTree";

export type UnlockTechNodeResult =
  | {
      ok: true;
      status: 200;
      nodeId: string;
      rdScoreRemaining: number;
      cashSpent: number;
      cashRemaining: number;
    }
  | { ok: false; status: number; error: string; reason?: UnlockBlockReason };

const REASON_STATUS: Record<UnlockBlockReason, number> = {
  "unknown-node": 400,
  "decade-locked": 400,
  "lane-locked": 409,
  "prereq-missing": 409,
  "already-owned": 409,
  "insufficient-rd": 402,
  "insufficient-cash": 402,
};

const REASON_MESSAGE: Record<UnlockBlockReason, string> = {
  "unknown-node": "That technology is not part of this corporation's tree.",
  "decade-locked": "That decade's technology is not yet available.",
  "lane-locked": "You have committed to the other track this decade — abandon it first.",
  "prereq-missing": "Unlock the preceding technology in this branch first.",
  "already-owned": "This technology is already unlocked.",
  "insufficient-rd": "Not enough R&D points to unlock this technology.",
  "insufficient-cash": "Not enough cash to unlock this technology.",
};

/**
 * Sum the corp's daily gross revenue (local currency) from its sectors — the
 * base the tech-node cash cost is a fraction of.
 *
 * Under plants this uses `sectorEconomicScale`, i.e. `max(revenue, capacity
 * nameplate)` per sector, rather than raw `revenue`. Raw revenue is 0 for a
 * MOTHBALLED plant, so a corp could mothball its whole estate, unlock every
 * tech node for free (the rdScore leg still applies, but cash is the binding
 * constraint), and unmothball the next turn with the plant untouched. The
 * nameplate is the same quantity `sectorTurn` restates revenue from, so a
 * running corp's cost does not move.
 *
 * Below plants this is byte-identical to the previous `Σ revenue`.
 */
async function dailyGrossRevenueLocal(db: Db, corporationId: Corporation["_id"]): Promise<number> {
  const [sectors, plantsEnabled, eraUnitScale] = await Promise.all([
    db
      .collection<CorporateSector>("corporateSectors")
      .find(
        { corporationId },
        { projection: { revenue: 1, capitalStock: 1, strategyId: 1, sectorType: 1 } }
      )
      .toArray(),
    getMarketSystemModeForDb(db).then((m) => marketAtLeast(m, "plants")),
    loadWorldEraUnitScale(db),
  ]);
  // sector.revenue is stored as daily revenue (not per-turn); sum directly.
  return sectors.reduce((sum, s) => sum + sectorEconomicScale(s, plantsEnabled, eraUnitScale), 0);
}

/**
 * Core logic for unlocking a sector tech-tree node (v2).
 *
 * Dual cost: spends rdScore (node.cost) AND cash (a fraction of daily gross
 * revenue). Commits the decade's lane on the first unlock; the other lane is
 * locked until Abandon. A single guarded update enforces affordability, the
 * lane commitment, and "not already owned" atomically so concurrent calls
 * cannot double-spend or cross lanes.
 *
 * Caller handles auth (CEO), the feature gate, and resolving the corporation.
 */
export async function unlockTechNode(
  db: Db,
  corporation: Corporation,
  nodeId: string,
  currentYear: number,
  turn: number
): Promise<UnlockTechNodeResult> {
  const rdScore = corporation.rdScore ?? 0;
  const cashAvailable = corporation.liquidCapital ?? 0;

  // Validate the node (and decade/lane) before pricing.
  const corpView = {
    type: corporation.type,
    unlockedTechNodeIds: corporation.unlockedTechNodeIds,
    techDecadeLane: corporation.techDecadeLane,
  };
  const preCheck = canUnlock(corpView, nodeId, currentYear, {
    rdScore,
    cashAvailable: Infinity,
    cashCost: 0,
  });
  if (!preCheck.ok) {
    return reject(preCheck.reason);
  }
  const { node } = preCheck;

  const cashCost = techNodeCashCost(node, await dailyGrossRevenueLocal(db, corporation._id));
  const check: CanUnlockResult = canUnlock(corpView, nodeId, currentYear, {
    rdScore,
    cashAvailable,
    cashCost,
  });
  if (!check.ok) {
    return reject(check.reason);
  }

  const committing = getCommittedLane(corpView, node.decadeId) === undefined;
  const laneKey = `techDecadeLane.${node.decadeId}`;
  const prereqId = getNodePrereqId(node);

  // One-time strength grants applied here (not recomputed each turn).
  const grants = sumStrengthGrants(node.effects);
  const inc: Record<string, number> = { rdScore: -node.cost, liquidCapital: -cashCost };
  if (grants.marketingStrength > 0) inc.marketingStrength = grants.marketingStrength;
  if (grants.logisticsStrength > 0) inc.logisticsStrength = grants.logisticsStrength;

  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (committing) {
    set[laneKey] = node.lane;
    set[`techDecadeChosenTurn.${node.decadeId}`] = turn;
  }

  const updateResult = await db.collection<Corporation>("corporations").updateOne(
    {
      _id: corporation._id,
      rdScore: { $gte: node.cost },
      liquidCapital: { $gte: cashCost },
      // Must not already own this node, and (tree order) must own its prerequisite.
      $and: [
        { unlockedTechNodeIds: { $ne: nodeId } },
        ...(prereqId ? [{ unlockedTechNodeIds: prereqId }] : []),
      ],
      // Lane guard: decade must be uncommitted OR already on this node's lane.
      $or: [{ [laneKey]: { $exists: false } }, { [laneKey]: node.lane }],
    },
    {
      $inc: inc,
      $push: { unlockedTechNodeIds: nodeId },
      $set: set,
    }
  );

  if (updateResult.modifiedCount === 0) {
    return {
      ok: false,
      status: 409,
      error: "Unlock could not be completed — the tech state changed. Please retry.",
    };
  }

  return {
    ok: true,
    status: 200,
    nodeId,
    rdScoreRemaining: rdScore - node.cost,
    cashSpent: cashCost,
    cashRemaining: cashAvailable - cashCost,
  };
}

function reject(reason: UnlockBlockReason): UnlockTechNodeResult {
  return { ok: false, status: REASON_STATUS[reason], error: REASON_MESSAGE[reason], reason };
}
