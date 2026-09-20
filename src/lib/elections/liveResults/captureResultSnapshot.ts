import { ObjectId, type Db } from "mongodb";
import type { Election, GameState } from "@/lib/db/types";
import type { ElectionResultSnapshot } from "@/lib/db/types/electionResultSnapshot";
import { logger } from "@/lib/observability/logger";
import { buildResultsPayload, snapshotFromPayload } from "./buildResultsPayload";

/**
 * Freeze a finalized election result without making snapshot availability a
 * prerequisite for turn resolution.
 *
 * Presidential countries do not all share a resolver, so this helper is the
 * common capture seam. A failed write is logged and the results route safely
 * falls back to live computation; throwing here would strand an otherwise
 * completed election and can interrupt resolution for other countries.
 */
export async function captureElectionResultSnapshot(
  db: Db,
  election: Election,
  now: Date
): Promise<void> {
  try {
    const gameState = await db
      .collection<GameState>("gameState")
      .findOne(
        { _id: "current" },
        { projection: { currentTurn: 1, currentYear: 1, preset: 1, fastMode: 1 } }
      );
    const payload = await buildResultsPayload(db, election, gameState, {
      // Resolution uses the live seat map; the year pins the era rules.
      apportionmentYear: election.electionYear ?? null,
      isAdmin: false,
    });
    const snapshot: ElectionResultSnapshot = {
      _id: new ObjectId(),
      ...snapshotFromPayload(payload, election, gameState?.currentTurn ?? 0, now),
    };
    await db
      .collection<ElectionResultSnapshot>("electionResultSnapshots")
      .updateOne({ electionId: election._id }, { $setOnInsert: snapshot }, { upsert: true });
  } catch (err) {
    logger.error(
      "elections",
      `[Turn] ${election.countryId} president election ${election._id}: result snapshot capture failed`,
      err
    );
  }
}
