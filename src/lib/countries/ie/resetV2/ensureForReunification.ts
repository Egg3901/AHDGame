import { createHash } from "node:crypto";
import type { Db } from "mongodb";
import type { GameState } from "@/lib/db/types/gameState";
import { seedOpeningMetrics1991 } from "@/lib/resetMetrics/seedOpening1991";
import { seedOpeningLawBoards1991 } from "@/lib/resetLegislation/seedOpening1991";
import { seedOpeningDepartmentBoards1991 } from "@/lib/resetFinance/seedOpeningDepartments1991";
import { verifyDemographicsV2Opening } from "@/lib/demographics/v2/verifyOpening";
import { RESET_V2_READY } from "@/lib/resetVersions/availability";
import {
  RESET_SYSTEMS,
  RESET_V2_SEED_REVISION,
  mergeResetReceiptCountries,
  resetSystemVersionsFrom,
  type ResetSystem,
  type ResetSystemSeedReceipt,
} from "@/lib/resetVersions/rules";

const IRELAND = "IE" as const;

function mergeCountryReceipt(
  existing: ResetSystemSeedReceipt,
  addition: ResetSystemSeedReceipt,
  system: ResetSystem
): ResetSystemSeedReceipt {
  return {
    worldId: existing.worldId,
    revision: RESET_V2_SEED_REVISION[system],
    sourceTurn: existing.sourceTurn,
    completedAt: addition.completedAt,
    verificationHash: createHash("sha256")
      .update(existing.verificationHash)
      .update("\n")
      .update(addition.verificationHash)
      .digest("hex"),
    countries: mergeResetReceiptCountries(existing.countries, [IRELAND]),
  };
}

/**
 * Add Ireland's reviewed v2 boards to the current world immediately before a
 * Northern Ireland transfer. Existing countries are never reseeded. Repeated
 * calls are no-ops once every active v2 system's receipt includes Ireland.
 */
export async function ensureIrelandResetV2ForReunification(db: Db): Promise<{ promoted: boolean }> {
  const state = await db.collection<GameState>("gameState").findOne(
    { _id: "current" },
    {
      projection: {
        currentTurn: 1,
        resetWorldId: 1,
        metricsSystemVersion: 1,
        legislationSystemVersion: 1,
        cabinetSystemVersion: 1,
        demographicsSystemVersion: 1,
        resetVersionSeeds: 1,
      },
    }
  );
  if (!state?.resetWorldId || !Number.isSafeInteger(state.currentTurn)) {
    return { promoted: false };
  }

  const versions = resetSystemVersionsFrom(state, RESET_V2_READY);
  const systems = RESET_SYSTEMS.filter((system) => versions[system] === "v2");
  const missing = systems.filter(
    (system) => state.resetVersionSeeds?.[system]?.countries?.includes(IRELAND) !== true
  );
  if (missing.length === 0) return { promoted: false };

  const worldId = state.resetWorldId;
  const sourceTurn = state.currentTurn;
  const additions: Partial<Record<ResetSystem, ResetSystemSeedReceipt>> = {};
  for (const system of RESET_SYSTEMS) {
    if (!missing.includes(system)) continue;
    if (system === "metrics") {
      additions.metrics = await seedOpeningMetrics1991(db, worldId, sourceTurn, [IRELAND]);
    } else if (system === "legislation") {
      additions.legislation = await seedOpeningLawBoards1991(db, worldId, sourceTurn, [IRELAND]);
    } else if (system === "cabinet") {
      additions.cabinet = await seedOpeningDepartmentBoards1991(db, worldId, sourceTurn, [IRELAND]);
    } else {
      additions.demographics = await verifyDemographicsV2Opening(db, worldId, sourceTurn, [
        IRELAND,
      ]);
    }
  }

  const set: Record<string, ResetSystemSeedReceipt> = {};
  for (const system of missing) {
    const existing = state.resetVersionSeeds?.[system];
    const addition = additions[system];
    if (!existing || !addition) {
      throw new Error(`Ireland v2 promotion is missing the ${system} seed receipt`);
    }
    set[`resetVersionSeeds.${system}`] = mergeCountryReceipt(existing, addition, system);
  }
  const updated = await db
    .collection<GameState>("gameState")
    .updateOne({ _id: "current", resetWorldId: worldId, currentTurn: sourceTurn }, { $set: set });
  if (updated.matchedCount !== 1) {
    throw new Error("Ireland v2 boards were prepared, but the world changed before activation");
  }
  return { promoted: true };
}
