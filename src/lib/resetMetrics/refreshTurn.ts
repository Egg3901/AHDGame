/** Bulk persistence shell for owner-supplied v2 metric turn readings. */
import type { Db } from "mongodb";
import { states1991 } from "@/lib/countries/us/data/usStates1991";
import { ukRegions1991 } from "@/lib/countries/uk/data/ukRegions1991";
import { jpRegions1991 } from "@/lib/countries/jp/data/jpRegions1991";
import type { GameState } from "@/lib/db/types/gameState";
import { RESET_V2_READY } from "@/lib/resetVersions/availability";
import { resetSystemVersionsForCountry, type ResetSystem } from "@/lib/resetVersions/rules";
import type { OpeningMetricObservation } from "./rules/openingObservation";
import { refreshResetMetricBoard } from "./rules/refresh";
import type { ResetMetricSnapshot } from "./rules/snapshot";
import { appendMetricHistory, metricHistoryDue } from "./rules/history";

const REGION_IDS = {
  US: states1991.map((region) => region._id),
  UK: ukRegions1991.map((region) => region._id),
  JP: jpRegions1991.map((region) => region._id),
} as const;

export interface MetricOwnerTurnReadings {
  updates: Readonly<Record<string, OpeningMetricObservation>>;
  cohortDue: boolean;
  electionDue: boolean;
}

export type MetricOwnerTurnReadingsByBoard = Readonly<Record<string, MetricOwnerTurnReadings>>;
export type MetricOwnerTurnReader = (
  boards: readonly ResetMetricSnapshot[]
) => Promise<MetricOwnerTurnReadingsByBoard>;

/**
 * All active boards are validated before any write. CAS and exact replay allow
 * a turn retry after partial bulk progress without double-applying a metric.
 */
export async function refreshResetMetricSnapshotsTurn(input: {
  db: Db;
  gameState: GameState;
  turn: number;
  ownerReadings: MetricOwnerTurnReadingsByBoard | MetricOwnerTurnReader;
  ready?: Record<ResetSystem, boolean>;
}): Promise<{ boards: number; advanced: number; replayed: number }> {
  const { db, gameState, turn } = input;
  const ready = input.ready ?? RESET_V2_READY;
  const activeCountries = (["US", "UK", "JP"] as const).filter(
    (country) => resetSystemVersionsForCountry(gameState, ready, country).metrics === "v2"
  );
  if (activeCountries.length === 0) return { boards: 0, advanced: 0, replayed: 0 };
  if (
    !Number.isSafeInteger(turn) ||
    turn !== gameState.currentTurn + 1 ||
    !gameState.resetWorldId
  ) {
    throw new Error("Reset metric turn lacks its next turn or current world identity");
  }
  const ids = activeCountries.flatMap((country) => [
    `${country}:national`,
    ...REGION_IDS[country].map((regionId) => `${country}:${regionId}`),
  ]);
  const idSet = new Set(ids);
  const sourceTurn = gameState.resetVersionSeeds?.metrics?.sourceTurn;
  if (!Number.isSafeInteger(sourceTurn)) {
    throw new Error("Reset metric turn lacks its verified opening turn");
  }
  const recordHistory = metricHistoryDue(sourceTurn!, turn);
  const collection = db.collection<ResetMetricSnapshot>("resetMetricSnapshots");
  const current = await collection
    .find(
      { _id: { $in: ids }, worldId: gameState.resetWorldId },
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
          ...(recordHistory ? { history: 1 } : {}),
        },
      }
    )
    .toArray();
  if (
    current.length !== ids.length ||
    new Set(current.map((board) => board._id)).size !== ids.length
  ) {
    throw new Error("Reset metric turn is missing a world-bound board");
  }
  for (const board of current) {
    if (
      !idSet.has(board._id) ||
      board._id !==
        `${board.countryId}:${board.scope === "national" ? "national" : board.regionId}` ||
      (board.scope === "national" && board.regionId !== undefined) ||
      (board.scope === "regional" && !REGION_IDS[board.countryId]?.includes(board.regionId!))
    ) {
      throw new Error(`Reset metric turn has an invalid board identity ${board._id}`);
    }
  }
  const ownerReadings =
    typeof input.ownerReadings === "function"
      ? await input.ownerReadings(current)
      : input.ownerReadings;
  if (
    Object.keys(ownerReadings).length !== ids.length ||
    Object.keys(ownerReadings).some((id) => !idSet.has(id))
  ) {
    throw new Error("Reset metric turn requires one owner reading bundle per active board");
  }
  const next = current.map((board) => {
    const readings = ownerReadings[board._id]!;
    const result = refreshResetMetricBoard({ board, turn, ...readings });
    if (result.missingDueIds.length > 0) {
      throw new Error(
        `Reset metric owners did not refresh ${board._id}: ${result.missingDueIds.join(", ")}`
      );
    }
    return result;
  });
  const pending = next.filter((result) => !result.replayed);
  if (pending.length > 0) {
    const written = await collection.bulkWrite(
      pending.map(({ board }) => {
        const history = recordHistory
          ? appendMetricHistory(board.history ?? {}, board.observations, turn)
          : undefined;
        return {
          updateOne: {
            filter: {
              _id: board._id,
              worldId: board.worldId,
              asOfTurn: turn - 1,
            },
            update: {
              $set: {
                asOfTurn: turn,
                observations: board.observations,
                ...(history ? { history } : {}),
              },
            },
          },
        };
      }),
      { ordered: true }
    );
    if (written.matchedCount !== pending.length) {
      throw new Error("Reset metric turn lost its world-bound compare-and-swap");
    }
  }
  return { boards: ids.length, advanced: pending.length, replayed: next.length - pending.length };
}
