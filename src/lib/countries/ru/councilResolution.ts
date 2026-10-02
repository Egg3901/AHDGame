/**
 * Completed native Council polls resolve as full frozen generations.
 * resolveRussianCouncilGenerations batches repeat opening reads, certifies each
 * complete family and leaves partial or failed certifications for a later retry.
 */
import { ObjectId, type Db } from "mongodb";
import type { Election } from "@/lib/db/types";
import { logger } from "@/lib/observability/logger";
import { certifyRussianCouncilElection } from "./councilElectionResult";
import { certifyRussianCouncilRepeat } from "./councilRepeatResult";
import {
  RUSSIAN_COUNCIL_OPENINGS_COLLECTION,
  type RussianCouncilOpeningRecord,
} from "./councilElectionOpening";
import { readyRussianCouncilCohorts, readyRussianCouncilRepeats } from "./rules/councilDispatch";

export async function resolveRussianCouncilGenerations(
  db: Db,
  elections: readonly Election[],
  turn: number,
  now: Date
) {
  const rows = elections.filter(
    (row) =>
      row.countryId === "RU" &&
      row.electionType === "federationCouncilMember" &&
      row.russianCouncilRound
  );
  if (!rows.length) return 0;
  const ballots = rows.map((row) => ({
    id: row._id.toHexString(),
    countryId: row.countryId,
    electionType: row.electionType,
    status: row.status,
    state: row.state,
    seatId: row.seatId,
    totalSeats: row.totalSeats,
    endTurn: row.endTurn,
    binding: {
      ...row.russianCouncilRound!,
      cohortId: row.russianCouncilRound!.cohortId.toHexString(),
      rootCohortId: row.russianCouncilRound!.rootCohortId?.toHexString(),
    },
  }));
  let resolved = 0;
  for (const cohortId of readyRussianCouncilCohorts(ballots, turn)) {
    try {
      await certifyRussianCouncilElection({ db, cohortId: new ObjectId(cohortId), turn, now });
      resolved += 89;
    } catch (error) {
      logger.error("Turn", `Failed to certify Council cohort ${cohortId}`, error);
    }
  }
  const repeatRows = rows.filter(
    (row) =>
      row.russianCouncilRound?.rootCohortId &&
      Number.isSafeInteger(row.russianCouncilRound.generation) &&
      row.russianCouncilRound.generation! > 0
  );
  if (!repeatRows.length) return resolved;
  const ids = [
    ...new Set(
      repeatRows.map(
        (row) =>
          `${row.russianCouncilRound!.rootCohortId!.toHexString()}:repeat:${row.russianCouncilRound!.generation}`
      )
    ),
  ];
  const openings = await db
    .collection<RussianCouncilOpeningRecord>(RUSSIAN_COUNCIL_OPENINGS_COLLECTION)
    .find(
      { _id: { $in: ids } },
      {
        batchSize: 1000,
        projection: {
          rootCohortId: 1,
          cohortId: 1,
          generation: 1,
          mandateSinceTurn: 1,
          electionIds: 1,
          seatIds: 1,
        },
      }
    )
    .toArray();
  const ready = readyRussianCouncilRepeats(
    ballots,
    openings
      .filter((row) => row.rootCohortId && row.generation && row.seatIds)
      .map((row) => ({
        rootCohortId: row.rootCohortId!.toHexString(),
        cohortId: row.cohortId.toHexString(),
        generation: row.generation!,
        mandateSinceTurn: row.mandateSinceTurn,
        electionIds: row.electionIds.map((id) => id.toHexString()),
        seatIds: row.seatIds!,
      })),
    turn
  );
  for (const opening of ready) {
    try {
      await certifyRussianCouncilRepeat({
        db,
        rootCohortId: new ObjectId(opening.rootCohortId),
        generation: opening.generation,
        turn,
        now,
      });
      resolved += opening.electionIds.length;
    } catch (error) {
      logger.error("Turn", `Failed to certify Council repeat ${opening.cohortId}`, error);
    }
  }
  return resolved;
}
