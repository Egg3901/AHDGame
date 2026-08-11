import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import type { Character, CorporateSector, Union } from "@/lib/db/types";
import { runWithOptionalTransaction } from "@/lib/db/runWithOptionalTransaction";
import {
  RECRUIT_COST,
  applyRecruit,
  STRIKE_CALL_MIN_UNIONIZATION,
  UNION_STRIKE_CALL_COOLDOWN_TURNS,
  strikeCallCost,
} from "@/lib/unions/unionEconomy";
import { clampWageLevel } from "@/lib/labour/laborCost";
import { realWageIndex } from "@/lib/labour/unionization";
import { STRIKE_EXPECTATION_GAP_THRESHOLD } from "@/lib/labour/strikes";
import { isUnionsBanned, UNIONS_BANNED_MESSAGE } from "@/lib/labour/unionLaws";
import { fireStrikeStartedPulse } from "@/lib/corporations/sentimentEvents";
import { getGameState } from "@/lib/gameState";
import { isTurnProcessingNow } from "@/lib/turn/processingLock";

export type UnionActionResult =
  { ok: true; status: 200; [key: string]: unknown } | { ok: false; status: number; error: string };

/**
 * Resolves a union by id and checks `character` is its leader. Shared
 * precondition for every action below — including the union-ban gate
 * (player suggestion #93): while the union's country has an enacted ban,
 * every leader action 403s. The budget flag (not `union.suspended`) is
 * checked because it is the enactment-time source of truth.
 */
async function resolveOwnedUnion(
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
async function rejectIfTurnProcessing(db: Db): Promise<UnionActionResult | null> {
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
 * Force-call a strike across every CorporateSector matching this union's
 * (countryId, sectorType) that's organized enough (`unionization >=
 * STRIKE_CALL_MIN_UNIONIZATION`) and not already active/cooling down —
 * bypasses `stepStrike`'s automatic trigger check (a deliberate player
 * override, per docs/plans/2026-06-30-labour-handoff.md). Cost scales with
 * matched sector count; `Union.lastCalledStrikeTurn` is a union-level rate
 * limit separate from each sector's own `strikeCooldownUntilTurn`.
 */
export async function callUnionStrike(
  db: Db,
  character: Character,
  unionId: string,
  currentTurn: number
): Promise<UnionActionResult> {
  const turnBusy = await rejectIfTurnProcessing(db);
  if (turnBusy) return turnBusy;

  const resolved = await resolveOwnedUnion(db, character, unionId);
  if (!resolved.ok) return resolved;
  const { union } = resolved;

  if (
    union.lastCalledStrikeTurn != null &&
    currentTurn < union.lastCalledStrikeTurn + UNION_STRIKE_CALL_COOLDOWN_TURNS
  ) {
    return { ok: false, status: 409, error: "This union is still in a strike-call cooldown." };
  }

  const matchedSectors = await db
    .collection<CorporateSector>("corporateSectors")
    .find(
      {
        countryId: union.countryId,
        sectorType: union.sectorType,
        unionization: { $gte: STRIKE_CALL_MIN_UNIONIZATION },
        strikeStartedAtTurn: null,
        $or: [
          { strikeCooldownUntilTurn: null },
          { strikeCooldownUntilTurn: { $exists: false } },
          { strikeCooldownUntilTurn: { $lte: currentTurn } },
        ],
      },
      { projection: { _id: 1, wageLevel: 1 } }
    )
    .toArray();

  if (matchedSectors.length === 0) {
    return {
      ok: false,
      status: 400,
      error: "No sector in this union's industry is organized enough to strike right now.",
    };
  }

  const cost = strikeCallCost(matchedSectors.length);
  if (union.treasury < cost) {
    return { ok: false, status: 402, error: "Not enough union treasury to call a strike." };
  }

  const now = new Date();
  const matchedIds = matchedSectors.map((s) => s._id);
  // Force-starting a strike must also plant a real wage-expectation gap, or
  // stepStrike (sectorCalculations.ts) sees the gap already closed on any
  // sector whose wages have been flat and immediately auto-resolves the
  // forced strike as a false "concession" next turn. realWageIndex treats an
  // absent cost-of-living as neutral (100) — a coarse approximation is fine
  // here; the goal is only to guarantee a real gap exists at trigger, same
  // as an organic strike, not to model conditions precisely.
  const sectorBulkOps = matchedSectors.map((s) => {
    const realWage = realWageIndex(s.wageLevel ?? 1, undefined);
    const workerExpectationIndex = realWage + STRIKE_EXPECTATION_GAP_THRESHOLD + 0.05;
    return {
      updateOne: {
        filter: { _id: s._id },
        update: {
          $set: { strikeStartedAtTurn: currentTurn, workerExpectationIndex, updatedAt: now },
        },
      },
    };
  });

  try {
    await runWithOptionalTransaction(
      async (session) => {
        const unionUpdate = await db.collection<Union>("unions").updateOne(
          { _id: union._id, treasury: { $gte: cost } },
          {
            $inc: { treasury: -cost },
            $set: { lastCalledStrikeTurn: currentTurn, updatedAt: now },
          },
          { session }
        );
        if (unionUpdate.modifiedCount === 0) throw new Error("INSUFFICIENT_TREASURY");

        await db
          .collection<CorporateSector>("corporateSectors")
          .bulkWrite(sectorBulkOps, { session });
      },
      async () => {
        const unionUpdate = await db.collection<Union>("unions").updateOne(
          { _id: union._id, treasury: { $gte: cost } },
          {
            $inc: { treasury: -cost },
            $set: { lastCalledStrikeTurn: currentTurn, updatedAt: now },
          }
        );
        if (unionUpdate.modifiedCount === 0) throw new Error("INSUFFICIENT_TREASURY");

        try {
          await db.collection<CorporateSector>("corporateSectors").bulkWrite(sectorBulkOps);
        } catch (error) {
          await db.collection<Union>("unions").updateOne(
            { _id: union._id },
            {
              $inc: { treasury: cost },
              $set: { lastCalledStrikeTurn: union.lastCalledStrikeTurn },
            }
          );
          throw error;
        }
      }
    );
  } catch (error) {
    if (error instanceof Error && error.message === "INSUFFICIENT_TREASURY") {
      return { ok: false, status: 402, error: "Not enough union treasury to call a strike." };
    }
    throw error;
  }

  await fireStrikeStartedPulse(db, union.sectorType, union.countryId);

  return { ok: true, status: 200, sectorsStruck: matchedIds.length, cashSpent: cost };
}

/**
 * Set (or clear) a visible wage demand — one-sided, no accept/reject
 * contract flow (deliberate scope simplification). Fires a sentiment pulse
 * only when the demand actually changes, mirroring the "only pulse on real
 * change" precedent in `applyTariffProvision`.
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

  await db
    .collection("unionEndorsements")
    .updateOne(
      { unionId: union._id, billId: new ObjectId(billId) },
      { $set: { stance, createdAt: new Date() } },
      { upsert: true }
    );

  return { ok: true, status: 200, stance };
}
