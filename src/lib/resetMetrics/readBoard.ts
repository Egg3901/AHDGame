import type { Db } from "mongodb";
import type { GameState } from "@/lib/db/types/gameState";
import { RESET_V2_READY } from "@/lib/resetVersions/availability";
import { resetSystemVersionsForCountry, type ResetV2Readiness } from "@/lib/resetVersions/rules";
import { buildResetMetricSnapshot, type ResetMetricSnapshot } from "./rules/snapshot";

export type ResetMetricBoardRead =
  | { status: "not_enabled" }
  | { status: "missing" | "invalid" | "stale" }
  | { status: "ready"; board: ResetMetricSnapshot };

/** Fail closed on a missing or outdated v2 board; never substitute a v1 board. */
export async function readResetMetricBoard(
  db: Db,
  countryId: string,
  regionId?: string,
  ready: ResetV2Readiness = RESET_V2_READY
): Promise<ResetMetricBoardRead> {
  const gameState = await db.collection<GameState>("gameState").findOne(
    { _id: "current" },
    {
      projection: {
        resetWorldId: 1,
        resetVersionSeeds: 1,
        metricsSystemVersion: 1,
        currentTurn: 1,
      },
    }
  );
  if (resetSystemVersionsForCountry(gameState, ready, countryId).metrics !== "v2") {
    return { status: "not_enabled" };
  }
  const worldId = gameState?.resetWorldId;
  if (typeof worldId !== "string") return { status: "missing" };
  const id = `${countryId}:${regionId ?? "national"}`;
  const board = await db.collection<ResetMetricSnapshot>("resetMetricSnapshots").findOne(
    { _id: id, worldId },
    {
      projection: {
        _id: 1,
        worldId: 1,
        countryId: 1,
        scope: 1,
        regionId: 1,
        sourceTurn: 1,
        asOfTurn: 1,
        observations: 1,
      },
    }
  );
  if (!board) return { status: "missing" };
  if (
    board.countryId !== countryId ||
    board.regionId !== regionId ||
    board.scope !== (regionId === undefined ? "national" : "regional") ||
    !Number.isSafeInteger(board.asOfTurn) ||
    board.asOfTurn < board.sourceTurn
  ) {
    return { status: "invalid" };
  }
  try {
    buildResetMetricSnapshot({
      worldId,
      countryId: board.countryId,
      regionId,
      sourceTurn: board.sourceTurn,
      observations: board.observations,
    });
  } catch {
    return { status: "invalid" };
  }
  if (board.asOfTurn !== gameState?.currentTurn) return { status: "stale" };
  return { status: "ready", board };
}
