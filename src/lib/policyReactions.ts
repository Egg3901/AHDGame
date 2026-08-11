/**
 * Policy Reactions Module
 *
 * Tracks how demographic groups react to enacted policies.
 * Reactions decay over time with a half-life of 12 turns as policies become "normalized".
 */

import type { AnyBulkWriteOperation, Db } from "mongodb";
import type { Bill, StateBill, LegislationType, PolicyReaction } from "@/lib/db/types";
import { isPolicyProvision } from "@/lib/db/types/legislation";
import { REACTION_HALF_LIFE, applyHalfLifeDecay } from "@shared/constants/formulas";

type BillWithEffects = Pick<
  Bill | StateBill,
  "legislationTypeId" | "effectDirection" | "provisions"
>;

interface ProvisionEffect {
  legislationTypeId: string;
  effectDirection: number;
}

/**
 * Records initial group reactions when a policy is enacted.
 * Creates a PolicyReaction record for each provision that has groupApprovals.
 */
export async function recordPolicyReaction(
  db: Db,
  bill: BillWithEffects,
  stateId: string,
  currentTurn: number
): Promise<void> {
  const provisions: ProvisionEffect[] = [];

  // Collect all provisions from the bill
  if (bill.provisions?.length) {
    for (const p of bill.provisions) {
      if (!isPolicyProvision(p)) continue;
      provisions.push({
        legislationTypeId: p.legislationTypeId,
        effectDirection: p.effectDirection,
      });
    }
  } else if (bill.legislationTypeId && bill.effectDirection != null) {
    provisions.push({
      legislationTypeId: bill.legislationTypeId,
      effectDirection: bill.effectDirection,
    });
  }

  if (provisions.length === 0) return;

  // Batch fetch all needed legislation types to avoid N+1 queries
  const uniqueLegTypeIds = [...new Set(provisions.map((p) => p.legislationTypeId))];
  const legTypes = await db
    .collection<LegislationType>("legislationTypes")
    .find({ _id: { $in: uniqueLegTypeIds } })
    .toArray();
  const legTypeMap = new Map(legTypes.map((lt) => [lt._id, lt]));

  // Process each provision using the pre-fetched map
  for (const provision of provisions) {
    await recordProvisionReaction(
      db,
      provision.legislationTypeId,
      provision.effectDirection,
      stateId,
      currentTurn,
      legTypeMap
    );
  }
}

/**
 * Records reaction for a single provision
 */
async function recordProvisionReaction(
  db: Db,
  legislationTypeId: string,
  effectDirection: number,
  stateId: string,
  currentTurn: number,
  legTypeMap: Map<string, LegislationType>
): Promise<void> {
  if (effectDirection == null || effectDirection === 0) return;

  // Get the legislation type from the pre-fetched map
  const lt = legTypeMap.get(legislationTypeId);

  if (!lt?.policyOptions?.length) return;

  // Find the policy option matching the effectDirection
  const policyOption = lt.policyOptions.find((opt) => opt.effectDirection === effectDirection);

  if (!policyOption?.groupApprovals) return;

  // Both groupReactions and initialReactions start with the same values
  const groupReactions = { ...policyOption.groupApprovals };
  const initialReactions = { ...policyOption.groupApprovals };

  const policyReaction: Omit<PolicyReaction, "_id"> = {
    stateId,
    legislationTypeId,
    policyOptionId: policyOption.id,
    groupReactions,
    initialReactions,
    enactedAt: new Date(),
    enactedTurn: currentTurn,
  };

  // Upsert into policyReactions collection keyed by (stateId, legislationTypeId)
  await db
    .collection<PolicyReaction>("policyReactions")
    .updateOne({ stateId, legislationTypeId }, { $set: policyReaction }, { upsert: true });
}

/**
 * Updates stored groupReactions values with decay applied.
 * Should be called each turn to keep the stored values current.
 */
export async function decayPolicyReactions(db: Db, currentTurn: number): Promise<void> {
  // Note: For very large collections, consider using cursor iteration with batched bulkWrite
  // to avoid loading all documents into memory at once. Current approach is fine for
  // typical game sizes (hundreds to low thousands of policy reactions).
  const reactions = await db.collection<PolicyReaction>("policyReactions").find({}).toArray();

  const bulkOps: AnyBulkWriteOperation<PolicyReaction>[] = [];

  for (const reaction of reactions) {
    const turnsSince = currentTurn - reaction.enactedTurn;
    if (turnsSince <= 0) continue;

    // Calculate decayed values for all groups
    const decayedReactions: Record<string, number> = {};
    for (const [groupId, initialValue] of Object.entries(reaction.initialReactions)) {
      decayedReactions[groupId] = applyHalfLifeDecay(initialValue, turnsSince, REACTION_HALF_LIFE);
    }

    // Add to bulk operations
    bulkOps.push({
      updateOne: {
        filter: { _id: reaction._id },
        update: { $set: { groupReactions: decayedReactions } },
      },
    });
  }

  // Execute all updates in a single batch
  if (bulkOps.length > 0) {
    await db.collection<PolicyReaction>("policyReactions").bulkWrite(bulkOps);
  }
}
