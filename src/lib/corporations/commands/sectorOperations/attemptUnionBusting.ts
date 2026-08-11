import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import type { Corporation, CorporateSector } from "@/lib/db/types";
import { runWithOptionalTransaction } from "@/lib/db/runWithOptionalTransaction";
import { getGameState } from "@/lib/gameState";
import { isTurnProcessingNow } from "@/lib/turn/processingLock";
import {
  calculateUnionBustingSuccessChance,
  rollD100,
  rollUnionBustingOutcome,
  applyUnionBustingOutcome,
  unionBustingCashCost,
  BUSTING_COOLDOWN_TURNS,
} from "@/lib/labour/unionBusting";
import { STRIKE_COOLDOWN_TURNS } from "@/lib/labour/strikes";
import { isUnionsBanned } from "@/lib/labour/unionLaws";
import {
  fireUnionBustingSuccessPulse,
  fireUnionBustingBackfirePulse,
} from "@/lib/corporations/sentimentEvents";
import { sectorEconomicScale } from "@/lib/corporations/sectorProfitBasis";
import { getMarketSystemModeForDb, marketAtLeast } from "@/lib/market/featureFlag";
import { loadWorldEraUnitScale } from "@/lib/currency/gdpAnchorRate";

export type AttemptUnionBustingResult =
  | {
      ok: true;
      status: 200;
      success: boolean;
      unionization: number;
      cashSpent: number;
      roll: number;
      finalChance: number;
    }
  | { ok: false; status: number; error: string };

/** In-cooldown filter shared by the read-check and the guarded write below. */
function notInCooldown(currentTurn: number) {
  return {
    $or: [
      { bustingCooldownUntilTurn: null },
      { bustingCooldownUntilTurn: { $exists: false } },
      { bustingCooldownUntilTurn: { $lte: currentTurn } },
    ],
  };
}

/**
 * Core logic for a CEO's union-busting attempt on one sector (Phase 7a,
 * `labourSystemMode >= "full"`). Rolls a success/backfire outcome (see
 * `src/lib/labour/unionBusting.ts`), atomically debits the cash cost from
 * the corporation and applies the unionization change + cooldown to the
 * sector, using `runWithOptionalTransaction` since these are two different
 * collections — the non-transaction fallback path (standalone Mongo)
 * compensates with a manual revert if the second write fails, mirroring
 * `src/app/api/characters/[id]/transfer/route.ts`'s refund-on-partial-failure
 * pattern.
 *
 * Caller handles auth (CEO), the feature gate, and resolving the corporation.
 */
export async function attemptUnionBusting(
  db: Db,
  corporation: Corporation,
  sectorId: string,
  currentTurn: number
): Promise<AttemptUnionBustingResult> {
  if (!ObjectId.isValid(sectorId)) {
    return { ok: false, status: 400, error: "Invalid sector ID" };
  }
  // The corp turn's own sectorOps bulk write recomputes unionization/strike
  // fields from a pre-mutation snapshot with no optimistic-concurrency
  // filter — a busting attempt landing mid-turn would be silently clobbered
  // (cash spent, no effect). Reject during the window instead.
  const gameState = await getGameState(db);
  if (gameState && isTurnProcessingNow(gameState)) {
    return {
      ok: false,
      status: 409,
      error: "The game is processing this turn — try again shortly.",
    };
  }
  const sectorObjectId = new ObjectId(sectorId);
  const sector = await db
    .collection<CorporateSector>("corporateSectors")
    .findOne({ _id: sectorObjectId, corporationId: corporation._id });
  if (!sector) {
    return { ok: false, status: 404, error: "Sector not found" };
  }
  // Union ban (player suggestion #93): busting is moot while unions are
  // outlawed — unionization is already decaying to 0 by law and strikes
  // can't trigger, so don't let a CEO pay for nothing.
  if (await isUnionsBanned(db, sector.countryId)) {
    return {
      ok: false,
      status: 403,
      error: "Unions are banned under current law — union-busting is unnecessary.",
    };
  }
  if (sector.bustingCooldownUntilTurn != null && currentTurn < sector.bustingCooldownUntilTurn) {
    return { ok: false, status: 409, error: "This sector is still in a union-busting cooldown." };
  }

  // Cost base is `sectorEconomicScale`, not raw `revenue`. Under plants a
  // MOTHBALLED sector reports revenue 0, which made union-busting FREE: mothball
  // the plant, bust the union at no cost, unmothball. The scale falls back to the
  // capacity nameplate in exactly that case and is unchanged for a running
  // sector. Below plants it IS `revenue`, so the price does not move.
  const plantsEnabled = marketAtLeast(await getMarketSystemModeForDb(db), "plants");
  const cashCost = unionBustingCashCost(
    sectorEconomicScale(sector, plantsEnabled, await loadWorldEraUnitScale(db))
  );
  if ((corporation.liquidCapital ?? 0) < cashCost) {
    return { ok: false, status: 402, error: "Not enough cash to attempt union-busting." };
  }

  const priorUnionization = sector.unionization ?? 0;
  const priorCooldown = sector.bustingCooldownUntilTurn ?? null;
  const priorStrikeStartedAtTurn = sector.strikeStartedAtTurn ?? null;
  const priorStrikeCooldownUntilTurn = sector.strikeCooldownUntilTurn ?? null;
  const calculation = calculateUnionBustingSuccessChance(priorUnionization);
  const roll = rollD100();
  const success = rollUnionBustingOutcome(calculation.finalChance, roll);
  const newUnionization = applyUnionBustingOutcome(priorUnionization, success);
  const cooldownUntilTurn = currentTurn + BUSTING_COOLDOWN_TURNS;
  const now = new Date();
  const sectorFilter = { _id: sectorObjectId, ...notInCooldown(currentTurn) };
  // A successful bust also ends an active strike outright — busting a
  // sector's unionization down while a strike is still throttling revenue
  // would otherwise achieve nothing for the strike itself (the strike's own
  // resolution logic never checks unionization, only the wage gap/duration).
  // Backfire leaves any active strike untouched.
  const endsActiveStrike = success && priorStrikeStartedAtTurn != null;
  const sectorSet = {
    $set: {
      unionization: newUnionization,
      bustingCooldownUntilTurn: cooldownUntilTurn,
      updatedAt: now,
      ...(endsActiveStrike && {
        strikeStartedAtTurn: null,
        strikeCooldownUntilTurn: currentTurn + STRIKE_COOLDOWN_TURNS,
      }),
    },
  };
  const revertSector = {
    $set: {
      unionization: priorUnionization,
      bustingCooldownUntilTurn: priorCooldown,
      ...(endsActiveStrike && {
        strikeStartedAtTurn: priorStrikeStartedAtTurn,
        strikeCooldownUntilTurn: priorStrikeCooldownUntilTurn,
      }),
    },
  };

  try {
    await runWithOptionalTransaction(
      async (session) => {
        const sectorUpdate = await db
          .collection<CorporateSector>("corporateSectors")
          .updateOne(sectorFilter, sectorSet, { session });
        if (sectorUpdate.modifiedCount === 0) throw new Error("COOLDOWN_ACTIVE");

        const corpUpdate = await db
          .collection<Corporation>("corporations")
          .updateOne(
            { _id: corporation._id, liquidCapital: { $gte: cashCost } },
            { $inc: { liquidCapital: -cashCost }, $set: { updatedAt: now } },
            { session }
          );
        if (corpUpdate.modifiedCount === 0) throw new Error("INSUFFICIENT_FUNDS");
      },
      async () => {
        const sectorUpdate = await db
          .collection<CorporateSector>("corporateSectors")
          .updateOne(sectorFilter, sectorSet);
        if (sectorUpdate.modifiedCount === 0) throw new Error("COOLDOWN_ACTIVE");

        try {
          const corpUpdate = await db
            .collection<Corporation>("corporations")
            .updateOne(
              { _id: corporation._id, liquidCapital: { $gte: cashCost } },
              { $inc: { liquidCapital: -cashCost }, $set: { updatedAt: now } }
            );
          if (corpUpdate.modifiedCount === 0) {
            await db
              .collection<CorporateSector>("corporateSectors")
              .updateOne({ _id: sectorObjectId }, revertSector);
            throw new Error("INSUFFICIENT_FUNDS");
          }
        } catch (error) {
          if ((error as Error).message !== "INSUFFICIENT_FUNDS") {
            await db
              .collection<CorporateSector>("corporateSectors")
              .updateOne({ _id: sectorObjectId }, revertSector);
          }
          throw error;
        }
      }
    );
  } catch (error) {
    if (error instanceof Error && error.message === "COOLDOWN_ACTIVE") {
      return { ok: false, status: 409, error: "This sector is still in a union-busting cooldown." };
    }
    if (error instanceof Error && error.message === "INSUFFICIENT_FUNDS") {
      return { ok: false, status: 402, error: "Not enough cash to attempt union-busting." };
    }
    throw error;
  }

  const countryId = sector.countryId ?? corporation.countryId;
  if (success) {
    await fireUnionBustingSuccessPulse(db, sector.sectorType, countryId);
  } else {
    await fireUnionBustingBackfirePulse(db, sector.sectorType, countryId);
  }

  return {
    ok: true,
    status: 200,
    success,
    unionization: newUnionization,
    cashSpent: cashCost,
    roll,
    finalChance: calculation.finalChance,
  };
}
