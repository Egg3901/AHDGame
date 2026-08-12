/**
 * Apply group synergies for the turn.
 *
 * Runs as its own pass rather than inside `sectorCalculations`, for the same
 * reason group relief does: the per-corp loop is the hottest path in the turn
 * and these are additive writes to two persisted fields, not something the
 * income math depends on.
 */

import { ObjectId, type AnyBulkWriteOperation, type Db } from "mongodb";
import type { Corporation } from "@/lib/db/types";
import { resolveFormalizedGroups } from "./groupMembership";
import { computeGroupSynergies, type SynergyMember } from "./synergies";

export interface SynergyResult {
  groupsProcessed: number;
  corpsLifted: number;
  errors: string[];
}

export async function applyGroupSynergies(
  db: Db,
  currentTurn: number
): Promise<SynergyResult> {
  const result: SynergyResult = { groupsProcessed: 0, corpsLifted: 0, errors: [] };

  const membership = await resolveFormalizedGroups(db);
  if (membership.membersByRootId.size === 0) return result;

  const allIds = new Set<string>();
  for (const members of membership.membersByRootId.values()) {
    for (const id of members) allIds.add(id);
  }

  const corps = await db
    .collection<Corporation>("corporations")
    .find({ _id: { $in: [...allIds].map((id) => new ObjectId(id)) } })
    .project<
      Pick<
        Corporation,
        | "_id"
        | "marketingStrength"
        | "logisticsStrength"
        | "isSpinOff"
        | "spunOffFromCorpId"
        | "spunOffAtTurn"
      >
    >({
      marketingStrength: 1,
      logisticsStrength: 1,
      isSpinOff: 1,
      spunOffFromCorpId: 1,
      spunOffAtTurn: 1,
    })
    .toArray();
  const corpById = new Map(corps.map((c) => [c._id.toString(), c]));

  const ops: AnyBulkWriteOperation<Corporation>[] = [];

  for (const [, memberIds] of membership.membersByRootId) {
    const members: SynergyMember[] = [];
    for (const id of memberIds) {
      const corp = corpById.get(id);
      if (!corp) continue;
      members.push({
        corporationId: id,
        marketingStrength: corp.marketingStrength ?? 0,
        logisticsStrength: corp.logisticsStrength ?? 0,
        ...(corp.isSpinOff ? { isSpinOff: true } : {}),
        ...(corp.spunOffFromCorpId
          ? { spunOffFromCorpId: corp.spunOffFromCorpId.toString() }
          : {}),
        ...(typeof corp.spunOffAtTurn === "number"
          ? { spunOffAtTurn: corp.spunOffAtTurn }
          : {}),
      });
    }
    if (members.length < 2) continue;
    result.groupsProcessed += 1;

    for (const delta of computeGroupSynergies(members, currentTurn)) {
      ops.push({
        updateOne: {
          filter: { _id: new ObjectId(delta.corporationId) },
          update: {
            $inc: {
              ...(delta.marketingStrength > 0
                ? { marketingStrength: delta.marketingStrength }
                : {}),
              ...(delta.logisticsStrength > 0
                ? { logisticsStrength: delta.logisticsStrength }
                : {}),
            },
            $set: { updatedAt: new Date() },
          },
        },
      });
      result.corpsLifted += 1;
    }
  }

  if (ops.length > 0) {
    try {
      await db.collection<Corporation>("corporations").bulkWrite(ops);
    } catch (err) {
      result.errors.push(err instanceof Error ? err.message : String(err));
    }
  }

  return result;
}
