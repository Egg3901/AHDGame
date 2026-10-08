/**
 * Forced sovereign rollover. When a Treasury cannot fund a matured bond, the
 * bond pool's remaining holding is exchanged for equal par principal in a new
 * bond instead of being left unpaid. Plain data in, plain data out.
 */
import { BOND_UNIT_FACE_VALUE } from "@/lib/db/types/bond";

export type ForcedRolloverRefusal =
  "no_float" | "invalid_state" | "float_exceeds_principal" | "pool_leg_mismatch";

export interface ForcedRolloverInput {
  /** Pool-held units still on the live source bond. */
  liveFloatUnits: number;
  liveTotalIssued: number;
  /** Frozen pool cash leg still owed on the claim (before any novation netting). */
  poolLegAmount: number;
  /** Units already exchanged by an applied appetite-gated novation. */
  novatedUnits: number;
}

export type ForcedRolloverPlan =
  | { units: number; faceLocal: number; refusal?: undefined }
  | { units: 0; faceLocal: 0; refusal: ForcedRolloverRefusal };

/** Roll every remaining pool unit at par. Principal and cash are unchanged. */
export function planForcedPoolRollover(input: ForcedRolloverInput): ForcedRolloverPlan {
  const { liveFloatUnits, liveTotalIssued, poolLegAmount, novatedUnits } = input;
  if (
    !Number.isSafeInteger(liveFloatUnits) ||
    !Number.isFinite(liveTotalIssued) ||
    !Number.isFinite(poolLegAmount) ||
    !Number.isSafeInteger(novatedUnits) ||
    novatedUnits < 0
  )
    return refused("invalid_state");
  if (liveFloatUnits <= 0) return refused("no_float");
  const faceLocal = liveFloatUnits * BOND_UNIT_FACE_VALUE;
  if (faceLocal > liveTotalIssued) return refused("float_exceeds_principal");
  // The pool leg must still cover this exchange once the earlier novation is
  // netted, or the payout would credit the pool cash for units it rolled.
  if (poolLegAmount - novatedUnits * BOND_UNIT_FACE_VALUE < faceLocal)
    return refused("pool_leg_mismatch");
  return { units: liveFloatUnits, faceLocal };
}

function refused(refusal: ForcedRolloverRefusal): ForcedRolloverPlan {
  return { units: 0, faceLocal: 0, refusal };
}
