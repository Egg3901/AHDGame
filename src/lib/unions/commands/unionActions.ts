import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import type { Bill, Character, Union } from "@/lib/db/types";
import { RECRUIT_COST, applyRecruit } from "@/lib/unions/unionEconomy";
import { clampWageLevel } from "@/lib/labour/laborCost";
import { isUnionsBanned, UNIONS_BANNED_MESSAGE } from "@/lib/labour/unionLaws";
import { getGameState } from "@/lib/gameState";
import { isTurnProcessingNow } from "@/lib/turn/processingLock";
import { NATIONAL_TERMINAL_STATUSES } from "@/lib/congress/billProposalLimits";
import { buildNationalBillCountryScopeFilter } from "@/lib/legislature/nationalBillScope";

export type UnionActionResult =
  { ok: true; status: 200; [key: string]: unknown } | { ok: false; status: number; error: string };

/**
 * Resolves a union by id and checks `character` is its leader. Shared
 * precondition for every action below — including the union-ban gate
 * (player suggestion #93): while the union's country has an enacted ban,
 * every leader action 403s. The budget flag (not `union.suspended`) is
 * checked because it is the enactment-time source of truth.
 */
export async function resolveOwnedUnion(
  db: Db,
  character: Character,
  unionId: string
): Promise<{ ok: true; union: Union } | { ok: false; status: number; error: string }> {
  if (!ObjectId.isValid(unionId)) {
    return { ok: false, status: 400, error: "Invalid union ID" };
  }
  const union = await db.collection<Union>("unions").findOne({ _id: new ObjectId(unionId) });
  if (!union) {
    return { ok: false, status: 404, error: "Union not found" };
  }
  if (!union.ownerId || union.ownerId.toString() !== character._id.toString()) {
    return { ok: false, status: 403, error: "You do not lead this union." };
  }
  if (await isUnionsBanned(db, union.countryId)) {
    return { ok: false, status: 403, error: UNIONS_BANNED_MESSAGE };
  }
  return { ok: true, union };
}

/**
 * The corp turn's sectorOps bulk write (unionization/strike fields) and
 * `processUnionsTurn`'s union bulk write (treasury/membershipPressure) both
 * recompute from a pre-mutation snapshot with no optimistic-concurrency
 * filter — an action landing mid-turn would be silently clobbered (paid,
 * no effect, no error). Reject during the window instead of racing.
 */
export async function rejectIfTurnProcessing(db: Db): Promise<UnionActionResult | null> {
  const gameState = await getGameState(db);
  if (gameState && isTurnProcessingNow(gameState)) {
    return {
      ok: false,
      status: 409,
      error: "The game is processing this turn — try again shortly.",
    };
  }
  return null;
}

/** Recruitment drive: spend the union's treasury to push `membershipPressure` up (diminishing returns). */
export async function recruitForUnion(
  db: Db,
  character: Character,
  unionId: string
): Promise<UnionActionResult> {
  const turnBusy = await rejectIfTurnProcessing(db);
  if (turnBusy) return turnBusy;

  const resolved = await resolveOwnedUnion(db, character, unionId);
  if (!resolved.ok) return resolved;
  const { union } = resolved;

  if (union.treasury < RECRUIT_COST) {
    return {
      ok: false,
      status: 402,
      error: "Not enough union treasury to run a recruitment drive.",
    };
  }
  const newPressure = applyRecruit(union.membershipPressure);
  const now = new Date();
  const result = await db.collection<Union>("unions").updateOne(
    {
      _id: union._id,
      treasury: { $gte: RECRUIT_COST },
      membershipPressure: union.membershipPressure,
    },
    {
      $inc: { treasury: -RECRUIT_COST },
      $set: { membershipPressure: newPressure, updatedAt: now },
    }
  );
  if (result.modifiedCount === 0) {
    return { ok: false, status: 409, error: "Union state changed — please retry." };
  }
  return { ok: true, status: 200, membershipPressure: newPressure, cashSpent: RECRUIT_COST };
}

/**
 * Set (or clear) the union's public wage claim: one-sided, no accept/reject
 * contract flow (deliberate scope simplification).
 *
 * Visibility only: every reader of `demandedWageLevel` renders it and nothing
 * else (union dashboard gap column, sector CEO panel callout, union list
 * counts). Binding wage terms are a bargaining campaign's job.
 */
export async function setUnionWageDemand(
  db: Db,
  character: Character,
  unionId: string,
  demandedWageLevel: number | null
): Promise<UnionActionResult> {
  const resolved = await resolveOwnedUnion(db, character, unionId);
  if (!resolved.ok) return resolved;
  const { union } = resolved;

  const clamped = demandedWageLevel === null ? null : clampWageLevel(demandedWageLevel);
  await db
    .collection<Union>("unions")
    .updateOne({ _id: union._id }, { $set: { demandedWageLevel: clamped, updatedAt: new Date() } });

  return { ok: true, status: 200, demandedWageLevel: clamped };
}

/**
 * Record this union's public stance on a bill — visibility-only this phase
 * (v3 Phase 8 deliberate scope cut), no mechanical vote-swing effect yet.
 */
export async function endorseBill(
  db: Db,
  character: Character,
  unionId: string,
  billId: string,
  stance: "endorse" | "oppose"
): Promise<UnionActionResult> {
  const resolved = await resolveOwnedUnion(db, character, unionId);
  if (!resolved.ok) return resolved;
  const { union } = resolved;

  if (!ObjectId.isValid(billId)) {
    return { ok: false, status: 400, error: "Invalid bill ID" };
  }

  const billObjectId = new ObjectId(billId);
  const bill = await db.collection<Bill>("bills").findOne(
    {
      _id: billObjectId,
      ...buildNationalBillCountryScopeFilter(union.countryId),
      status: { $nin: NATIONAL_TERMINAL_STATUSES },
    },
    { projection: { _id: 1 } }
  );
  if (!bill) {
    return {
      ok: false,
      status: 404,
      error: "Active bill not found in this union's country.",
    };
  }

  await db
    .collection("unionEndorsements")
    .updateOne(
      { unionId: union._id, billId: billObjectId },
      { $set: { stance, createdAt: new Date() } },
      { upsert: true }
    );

  return { ok: true, status: 200, stance };
}
