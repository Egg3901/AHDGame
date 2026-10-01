/**
 * Failed Council subject polls reopen against their immutable certified predecessor.
 * materializeRussianCouncilRepeatOpening freezes fresh registers atomically and
 * preserves successful mandates and Congress until joint chamber handover.
 */
import { ObjectId, type ClientSession, type Db } from "mongodb";
import type {
  CountryGameState,
  Election,
  GameState,
  State,
  StateRegistrationPool,
} from "@/lib/db/types";
import { MS_PER_TURN } from "@/lib/constants/turnTime";
import { calendarTurn, turnToGameMonth } from "@/lib/utils/gameDate";
import { runRequiredTransaction } from "@/lib/db/runRequiredTransaction";
import {
  RUSSIAN_COUNCIL_RESULTS_COLLECTION,
  type RussianCouncilResultRecord,
} from "./councilElectionResult";
import {
  RUSSIAN_COUNCIL_OPENINGS_COLLECTION,
  type RussianCouncilOpeningRecord,
} from "./councilElectionOpening";
import { pendingRussianCouncilRepeatBallots } from "./rules/councilRepeat";
import { freezeRussianCouncilElectorate } from "./rules/councilElectorate";
import { planRussianCouncilDistricts } from "./rules/councilDistricts";
import { planRussianDumaBallot } from "./rules/assemblySchedule";
import { loadRussianAssemblyRepeatTerm } from "./assemblyRepeatTerm";
import { hasAuthorizedPostSovietTransition } from "./rules/postSovietTransition";

export async function materializeRussianCouncilRepeatOpening(input: {
  db: Db;
  session: ClientSession;
  rootCohortId: ObjectId;
  previousResultId: string;
  cohortId: ObjectId;
  electionIds: readonly ObjectId[];
  turn: number;
  now: Date;
}): Promise<{ record: RussianCouncilOpeningRecord; created: boolean } | null> {
  const { db, session, rootCohortId, previousResultId, cohortId, electionIds, turn, now } = input;
  if (
    !session.inTransaction() ||
    !Number.isSafeInteger(turn) ||
    turn < 1 ||
    !Number.isFinite(now.getTime())
  )
    throw new Error("Council repeats need a transaction, turn and time");
  const game = await db
    .collection<GameState>("gameState")
    .findOne(
      { _id: "current" },
      { session, projection: { preset: 1, preIteration: 1, preIterationTurns: 1 } }
    );
  if (game?.preset !== "1991-default") return null;
  const countries = db.collection<CountryGameState>("countryGameStates");
  const country = await countries.findOne(
    { _id: "RU" },
    {
      session,
      projection: {
        ruFirstCouncilElectionCohortId: 1,
        ruSovietSuccessionSinceTurn: 1,
        ruFederalAssemblyMandateSinceTurn: 1,
        ruFederalAssemblySinceTurn: 1,
        ruFirstDumaElectionCohortId: 1,
      },
    }
  );
  if (
    !country?.ruFirstCouncilElectionCohortId?.equals(rootCohortId) ||
    !hasAuthorizedPostSovietTransition(
      turn,
      country.ruSovietSuccessionSinceTurn,
      country.ruFederalAssemblyMandateSinceTurn
    )
  )
    throw new Error("Council repeat mandate changed");
  const previous = await db
    .collection<RussianCouncilResultRecord>(RUSSIAN_COUNCIL_RESULTS_COLLECTION)
    .findOne({ _id: previousResultId }, { session });
  if (
    !previous ||
    previous.countryId !== "RU" ||
    previous.preset !== "1991-default" ||
    previous.mandateSinceTurn !== country.ruFederalAssemblyMandateSinceTurn ||
    !(previous.rootCohortId ?? previous.cohortId).equals(rootCohortId) ||
    previous._id !== previous.cohortId.toHexString() ||
    !Number.isSafeInteger(previous.resolvedOnTurn) ||
    previous.resolvedOnTurn < 1 ||
    previous.resolvedOnTurn > turn ||
    (previous.seatedOnTurn != null && country.ruFederalAssemblySinceTurn == null)
  )
    throw new Error("Council repeats need an unseated certified predecessor");
  const previousGeneration = previous.generation ?? 0;
  if (
    !Number.isSafeInteger(previousGeneration) ||
    previousGeneration < 0 ||
    previousGeneration >= Number.MAX_SAFE_INTEGER ||
    (previousGeneration === 0 &&
      (!previous.cohortId.equals(rootCohortId) || previous.rootCohortId != null))
  )
    throw new Error("Council repeat generation identity changed");
  // Resolving preserved ballots validates the complete accumulated89-subject family before any write.
  const pending = pendingRussianCouncilRepeatBallots(previous.ballots);
  const openings = db.collection<RussianCouncilOpeningRecord>(RUSSIAN_COUNCIL_OPENINGS_COLLECTION);
  if (previousGeneration > 0) {
    const binding = await openings.findOne(
      { _id: `${rootCohortId.toHexString()}:repeat:${previousGeneration}` },
      { session }
    );
    if (
      !binding?.cohortId.equals(previous.cohortId) ||
      !binding.rootCohortId?.equals(rootCohortId) ||
      binding.mandateSinceTurn !== previous.mandateSinceTurn ||
      binding.generation !== previousGeneration ||
      !binding.seatIds?.length ||
      binding.seatIds.length !== binding.electionIds.length ||
      new Set(binding.seatIds).size !== binding.seatIds.length ||
      binding.seatIds.some(
        (seatId, index) =>
          previous.ballots.find((ballot) => ballot.seatId === seatId)?.id !==
          binding.electionIds[index]?.toHexString()
      )
    )
      throw new Error("Council predecessor has no matching generation opening");
  }
  const generation = previousGeneration + 1;
  const id = `${rootCohortId.toHexString()}:repeat:${generation}`;
  const replay = await openings.findOne({ _id: id }, { session });
  if (replay) {
    if (
      replay.previousResultId !== previousResultId ||
      !replay.rootCohortId?.equals(rootCohortId) ||
      replay.mandateSinceTurn !== previous.mandateSinceTurn ||
      replay.generation !== generation
    )
      throw new Error("Council repeat opening identity changed");
    return { record: replay, created: false };
  }
  const timing = planRussianDumaBallot(turn);
  await loadRussianAssemblyRepeatTerm({
    db,
    session,
    country,
    chamber: "council",
    turn,
    electionEndTurn: timing.endTurn,
    previous,
  });
  if (!pending.length) return null;
  if (
    electionIds.length !== pending.length ||
    new Set(electionIds.map((id) => id.toHexString())).size !== pending.length ||
    cohortId.equals(rootCohortId) ||
    cohortId.equals(previous.cohortId) ||
    previous.ballots.some((row) => !ObjectId.isValid(row.id)) ||
    electionIds.some((id) => previous.ballots.some((row) => row.id === id.toHexString()))
  )
    throw new Error("Council repeats need distinct new ballot identities");
  const regions = await db
    .collection<State>("states")
    .find(
      { countryId: "RU" },
      { session, projection: { _id: 1, population: 1, votingEligiblePopulation: 1 } }
    )
    .toArray();
  const pools = await db
    .collection<StateRegistrationPool>("stateRegistrationPool")
    .find({ countryId: "RU" }, { session, projection: { stateId: 1, unregistered: 1 } })
    .toArray();
  if (new Set(pools.map((row) => row.stateId)).size !== pools.length)
    throw new Error("Duplicate Council registration pools");
  const register = freezeRussianCouncilElectorate(
    regions.map((row) => ({
      id: String(row._id),
      population: row.population,
      votingEligiblePopulation: row.votingEligiblePopulation,
    })),
    Object.fromEntries(pools.map((row) => [row.stateId, row.unregistered]))
  );
  const districts = new Map(planRussianCouncilDistricts(register).map((row) => [row.seatId, row]));
  const clock = {
    preIterationActive: game.preIteration?.active,
    preIterationTurns: game.preIterationTurns,
  };
  const ballots: Election[] = pending.map((old, index) => ({
    _id: electionIds[index],
    countryId: "RU",
    electionType: "federationCouncilMember",
    cycle: 1,
    state: old.regionId,
    seatId: old.seatId,
    totalSeats: 2,
    electionYear: turnToGameMonth(calendarTurn(timing.endTurn, clock), 1991).year,
    status: "active",
    ...timing,
    startTime: now,
    primaryEndTime: new Date(now.getTime() + (timing.primaryEndTurn - turn) * MS_PER_TURN),
    endTime: new Date(now.getTime() + (timing.endTurn - turn) * MS_PER_TURN),
    createdAt: now,
    updatedAt: now,
    russianCouncilRound: {
      cohortId,
      rootCohortId,
      generation,
      predecessorElectionId: new ObjectId(old.id),
      mandateSinceTurn: previous.mandateSinceTurn,
      registeredVoters: districts.get(old.seatId)!.registeredVoters,
      districtNumber: districts.get(old.seatId)!.districtNumber,
    },
  }));
  const record: RussianCouncilOpeningRecord = {
    _id: id,
    rootCohortId,
    cohortId,
    previousResultId,
    generation,
    countryId: "RU",
    preset: "1991-default",
    mandateSinceTurn: previous.mandateSinceTurn,
    openedOnTurn: turn,
    createdAt: now,
    electionIds: [...electionIds],
    seatIds: pending.map((row) => row.seatId),
    registeredBySubject: Object.fromEntries(
      pending.map((row) => [row.seatId, register[row.seatId]])
    ),
  };
  await db.collection<Election>("elections").insertMany(ballots, { session });
  await openings.insertOne(record, { session });
  const bound = await countries.updateOne(
    {
      _id: "RU",
      ruFirstCouncilElectionCohortId: rootCohortId,
      ruFederalAssemblyMandateSinceTurn: previous.mandateSinceTurn,
      ruFederalAssemblySinceTurn: country.ruFederalAssemblySinceTurn ?? { $exists: false },
    },
    { $set: { updatedAt: now } },
    { session }
  );
  if (bound.matchedCount !== 1) throw new Error("Council repeat mandate changed during opening");
  return { record, created: true };
}

export async function openRussianCouncilRepeat(
  input: Omit<
    Parameters<typeof materializeRussianCouncilRepeatOpening>[0],
    "session" | "cohortId" | "electionIds"
  >
) {
  const previous = await input.db
    .collection<RussianCouncilResultRecord>(RUSSIAN_COUNCIL_RESULTS_COLLECTION)
    .findOne({ _id: input.previousResultId }, { projection: { ballots: 1 } });
  if (!previous?.ballots) throw new Error("Council repeats need preserved predecessor ballots");
  const electionIds = pendingRussianCouncilRepeatBallots(previous.ballots).map(
    () => new ObjectId()
  );
  const cohortId = new ObjectId();
  return runRequiredTransaction(
    (session) =>
      materializeRussianCouncilRepeatOpening({ ...input, session, cohortId, electionIds }),
    { client: input.db.client }
  );
}
