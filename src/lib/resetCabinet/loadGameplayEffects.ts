import type { Db } from "mongodb";
import type { GameState } from "@/lib/db/types/gameState";
import { RESET_V2_READY } from "@/lib/resetVersions/availability";
import { RESET_V2_COUNTRIES, resetSystemVersionsForCountry } from "@/lib/resetVersions/rules";
import type { ResetCabinetActionState } from "./rules/actionState";
import { combineActiveActionEffects, type TemporaryTargetEffect } from "./rules/actions";

/** One projected country batch, including callers that do not already hold gameState. */
export async function loadCabinetGameplayEffects(
  db: Db,
  existingGameState?: GameState | null,
  turn?: number
): Promise<TemporaryTargetEffect[]> {
  const game =
    existingGameState === undefined
      ? await db.collection<GameState>("gameState").findOne(
          { _id: "current" },
          {
            projection: {
              currentTurn: 1,
              resetWorldId: 1,
              resetVersionSeeds: 1,
              metricsSystemVersion: 1,
              cabinetSystemVersion: 1,
              isProcessing: 1,
              processingKind: 1,
              processingTargetTurn: 1,
            },
          }
        )
      : existingGameState;
  const countries = RESET_V2_COUNTRIES.filter(
    (country) => resetSystemVersionsForCountry(game, RESET_V2_READY, country).cabinet === "v2"
  );
  if (!game || countries.length === 0) return [];
  const effectiveTurn =
    turn ??
    (game.isProcessing &&
    game.processingKind === "turn" &&
    game.processingTargetTurn === game.currentTurn + 1
      ? game.processingTargetTurn
      : game.currentTurn);
  if (!Number.isSafeInteger(effectiveTurn) || effectiveTurn < 0) {
    throw new Error("Cabinet gameplay requires a valid turn");
  }
  const rows = await db
    .collection<ResetCabinetActionState>("resetCabinetActionStates")
    .find(
      {
        _id: { $in: [...countries] },
        worldId: game.resetWorldId,
      },
      { projection: { _id: 1, worldId: 1, countryId: 1, sourceTurn: 1, active: 1 } }
    )
    .toArray();
  return rows.flatMap((row) => {
    if (
      row.worldId !== game.resetWorldId ||
      row._id !== row.countryId ||
      !countries.includes(row.countryId) ||
      !Number.isSafeInteger(row.sourceTurn) ||
      row.sourceTurn < game.resetVersionSeeds!.cabinet!.sourceTurn ||
      row.sourceTurn > effectiveTurn
    )
      return [];
    return combineActiveActionEffects(
      row.active.filter((action) => action.country === row.countryId),
      effectiveTurn
    );
  });
}
