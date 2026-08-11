import type { Db, ObjectId } from "mongodb";
import type { Character } from "@/lib/db/types";
import { snapToPositionGrid } from "@/lib/utils/politics";

/**
 * Computes the policy shift delta for a single axis value.
 *
 * - "for" vote → shift toward the provision's position (+0.25 or -0.25)
 * - "against" vote → shift away from the provision's position
 * - "abstain" or undefined provision → no shift (0)
 */
export function computePolicyShift(
  currentValue: number,
  provisionValue: number | undefined,
  vote: "for" | "against" | "abstain"
): number {
  if (vote === "abstain" || provisionValue === undefined) return 0;
  const diff = provisionValue - currentValue;
  if (diff === 0) return 0;
  const direction = vote === "for" ? Math.sign(diff) : -Math.sign(diff);
  return direction * 0.25;
}

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

/**
 * Applies bill vote policy shifts to a character's economic and social positions.
 *
 * Each provision shifts the character's policy by ±0.25 in the direction determined
 * by their vote and relative position to the bill. Multiple provisions accumulate.
 *
 * Abstain votes and bills with no provisions are no-ops.
 * Always clamps to [-5, +5].
 */
export async function applyBillVotePolicyShift(
  db: Db,
  characterId: ObjectId,
  provisions: Array<{ economic?: number; social?: number }>,
  vote: "for" | "against" | "abstain",
  currentPolicies: { economic: number; social: number }
): Promise<void> {
  if (vote === "abstain" || provisions.length === 0) return;

  let deltaEconomic = 0;
  let deltaSocial = 0;

  for (const provision of provisions) {
    deltaEconomic += computePolicyShift(currentPolicies.economic, provision.economic, vote);
    deltaSocial += computePolicyShift(currentPolicies.social, provision.social, vote);
  }

  if (deltaEconomic === 0 && deltaSocial === 0) return;

  const newEconomic = snapToPositionGrid(clamp(currentPolicies.economic + deltaEconomic, -5, 5));
  const newSocial = snapToPositionGrid(clamp(currentPolicies.social + deltaSocial, -5, 5));

  await db.collection<Character>("characters").updateOne(
    { _id: characterId },
    {
      $set: {
        "policies.economic": newEconomic,
        "policies.social": newSocial,
        updatedAt: new Date(),
      },
    }
  );
}
