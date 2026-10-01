/**
 * First and repeat Council ballots validate against their immutable opening family.
 * loadRussianCouncilOpeningBinding checks the original mandate, failed-subject set,
 * fresh registers and predecessor identities before either NPC or player admission.
 */
import type { ClientSession, Db, ObjectId } from "mongodb";
import type { CountryGameState } from "@/lib/db/types";
import {
  RUSSIAN_COUNCIL_OPENINGS_COLLECTION,
  type RussianCouncilOpeningRecord,
} from "./councilElectionOpening";
import {
  RUSSIAN_COUNCIL_RESULTS_COLLECTION,
  type RussianCouncilResultRecord,
} from "./councilElectionResult";
import { planRussianCouncilDistricts } from "./rules/councilDistricts";
import { pendingRussianCouncilRepeatBallots } from "./rules/councilRepeat";

export async function loadRussianCouncilOpeningBinding(input: {
  db: Db;
  session?: ClientSession;
  cohortId: ObjectId;
  country: Pick<
    CountryGameState,
    "ruFirstCouncilElectionCohortId" | "ruFederalAssemblyMandateSinceTurn"
  >;
}) {
  const { db, session, cohortId, country } = input;
  const rootCohortId = country.ruFirstCouncilElectionCohortId;
  if (!rootCohortId) return null;
  const opening = await db
    .collection<RussianCouncilOpeningRecord>(RUSSIAN_COUNCIL_OPENINGS_COLLECTION)
    .findOne(
      { cohortId },
      {
        session,
        projection: {
          cohortId: 1,
          rootCohortId: 1,
          generation: 1,
          previousResultId: 1,
          countryId: 1,
          preset: 1,
          mandateSinceTurn: 1,
          electionIds: 1,
          seatIds: 1,
          registeredBySubject: 1,
          npcAdmission: 1,
        },
      }
    );
  if (
    !opening ||
    opening.countryId !== "RU" ||
    opening.preset !== "1991-default" ||
    !opening.cohortId.equals(cohortId) ||
    opening.mandateSinceTurn !== country.ruFederalAssemblyMandateSinceTurn ||
    new Set(opening.electionIds.map((id) => id.toHexString())).size !== opening.electionIds.length
  )
    return null;
  if (cohortId.equals(rootCohortId)) {
    if (
      opening._id !== rootCohortId.toHexString() ||
      opening.rootCohortId != null ||
      opening.generation != null ||
      opening.electionIds.length !== 89
    )
      return null;
    const districts = planRussianCouncilDistricts(opening.registeredBySubject);
    return {
      opening,
      rootCohortId,
      ballots: districts.map((row, index) => ({ ...row, id: opening.electionIds[index] })),
    };
  }
  const generation = opening.generation;
  if (
    !opening.rootCohortId?.equals(rootCohortId) ||
    !Number.isSafeInteger(generation) ||
    generation! < 1 ||
    opening._id !== `${rootCohortId.toHexString()}:repeat:${generation}` ||
    !opening.previousResultId
  )
    return null;
  const previous = await db
    .collection<RussianCouncilResultRecord>(RUSSIAN_COUNCIL_RESULTS_COLLECTION)
    .findOne(
      {
        _id: opening.previousResultId,
        countryId: "RU",
        preset: "1991-default",
        mandateSinceTurn: opening.mandateSinceTurn,
      },
      {
        session,
        projection: { cohortId: 1, rootCohortId: 1, generation: 1, ballots: 1, seatedOnTurn: 1 },
      }
    );
  if (
    !previous ||
    !(previous.rootCohortId ?? previous.cohortId).equals(rootCohortId) ||
    previous._id !== previous.cohortId.toHexString() ||
    previous.seatedOnTurn != null ||
    ((previous.generation ?? 0) === 0 &&
      (!previous.cohortId.equals(rootCohortId) || previous.rootCohortId != null)) ||
    (previous.generation ?? 0) + 1 !== generation
  )
    return null;
  const pending = pendingRussianCouncilRepeatBallots(previous.ballots);
  if (
    !pending.length ||
    opening.electionIds.length !== pending.length ||
    opening.seatIds?.length !== pending.length ||
    Object.keys(opening.registeredBySubject).length !== pending.length ||
    pending.some((row, index) => row.seatId !== opening.seatIds![index]) ||
    opening.electionIds.some((id) => previous.ballots.some((row) => row.id === id.toHexString()))
  )
    return null;
  const registers = Object.fromEntries(
    previous.ballots.map((row) => [row.seatId, row.registeredVoters])
  );
  const districts = new Map(
    planRussianCouncilDistricts({ ...registers, ...opening.registeredBySubject }).map((row) => [
      row.seatId,
      row,
    ])
  );
  const ballots = pending.map((row, index) => ({
    ...districts.get(row.seatId)!,
    id: opening.electionIds[index],
    predecessorId: row.id,
  }));
  return { opening, rootCohortId, ballots };
}
