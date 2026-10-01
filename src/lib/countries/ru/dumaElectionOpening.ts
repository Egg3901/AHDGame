/**
 * A ratified Russian Assembly mandate opens 225 constituency ballots and one list ballot.
 * materializeRussianDumaElectionOpening binds the entire Duma cohort atomically,
 * preserving Congress and its officeholders until a replacement is certified and seated.
 */
import { ObjectId, type ClientSession, type Db } from "mongodb";
import type { CountryGameState, Election, State, StateRegistrationPool } from "@/lib/db/types";
import { MS_PER_TURN } from "@/lib/constants/turnTime";
import { calendarTurn, turnToGameMonth } from "@/lib/utils/gameDate";
import { runRequiredTransaction } from "@/lib/db/runRequiredTransaction";
import { ru1993LegislatureStage } from "./eras/1991";
import { hasAuthorizedPostSovietTransition } from "./rules/postSovietTransition";
import { planRussianDumaDistricts } from "./rules/assemblyDistricts";
import { freezeRussianDumaElectorate } from "./rules/assemblyElectorate";
import { planRussianDumaBallot } from "./rules/assemblySchedule";
import { RU_1991_ECONOMIC_REGION_POPULATION } from "./data/ruPopulation1991";
import type { RussianConstitutionalCalendar } from "./constitutionalProposals";

export async function materializeRussianDumaElectionOpening(input: {
  db: Db;
  session: ClientSession;
  game: RussianConstitutionalCalendar;
  turn: number;
  now: Date;
  cohortId: ObjectId;
  electionIds: readonly ObjectId[];
}): Promise<{ cohortId: ObjectId; created: boolean } | null> {
  const { db, session, game, turn, now, cohortId, electionIds } = input;
  if (
    !session.inTransaction() ||
    !Number.isFinite(now.getTime()) ||
    !Number.isSafeInteger(turn) ||
    turn < 1
  )
    throw new Error("Russian Duma opening needs an active transaction and time");
  if (game.preset !== "1991-default") return null;
  const clock = {
    preIterationActive: game.preIteration?.active,
    preIterationTurns: game.preIterationTurns,
  };
  if (ru1993LegislatureStage(calendarTurn(turn, clock)) === "congress") return null;
  const countries = db.collection<CountryGameState>("countryGameStates");
  const country = await countries.findOne(
    { _id: "RU" },
    {
      session,
      projection: {
        ruSovietSuccessionSinceTurn: 1,
        ruFederalAssemblyMandateSinceTurn: 1,
        ruFirstDumaElectionCohortId: 1,
        ruFederalAssemblySinceTurn: 1,
      },
    }
  );
  if (
    !country ||
    !hasAuthorizedPostSovietTransition(
      turn,
      country.ruSovietSuccessionSinceTurn,
      country.ruFederalAssemblyMandateSinceTurn
    )
  )
    return null;
  const elections = db.collection<Election>("elections");
  if (country.ruFirstDumaElectionCohortId) {
    const existing = await elections
      .find(
        { countryId: "RU", "russianDumaRound.cohortId": country.ruFirstDumaElectionCohortId },
        {
          session,
          batchSize: 1000,
          projection: {
            _id: 1,
            electionType: 1,
            state: 1,
            seatId: 1,
            totalSeats: 1,
            russianDumaRound: 1,
          },
        }
      )
      .toArray();
    const expectedDistricts = planRussianDumaDistricts(
      Object.fromEntries(Object.keys(RU_1991_ECONOMIC_REGION_POPULATION).map((id) => [id, 1]))
    );
    const expectedBySeat = new Map(expectedDistricts.map((row) => [row.seatId, row]));
    const expected = new Set(expectedBySeat.keys());
    expected.add("RU-duma-national-list");
    if (
      existing.length !== expected.size ||
      new Set(existing.map((row) => row.seatId)).size !== expected.size ||
      existing.some(
        (row) =>
          !row.seatId ||
          !expected.has(row.seatId) ||
          row.electionType !== "dumaDeputy" ||
          row.russianDumaRound?.mandateSinceTurn !== country.ruFederalAssemblyMandateSinceTurn ||
          !Number.isSafeInteger(row.russianDumaRound?.registeredVoters) ||
          (row.russianDumaRound?.registeredVoters ?? -1) < 0 ||
          (row.seatId === "RU-duma-national-list"
            ? row.totalSeats !== 225 || row.state !== "RU" || row.russianDumaRound?.tier !== "list"
            : row.totalSeats !== 1 ||
              row.russianDumaRound?.tier !== "constituency" ||
              row.state !== expectedBySeat.get(row.seatId)?.regionId ||
              row.russianDumaRound?.regionalDistrictCount !==
                expectedBySeat.get(row.seatId)?.regionalDistrictCount)
      )
    )
      throw new Error("The first Russian Duma cohort no longer matches its mandate");
    const districtVoters = existing
      .filter((row) => row.russianDumaRound?.tier === "constituency")
      .reduce((sum, row) => sum + BigInt(row.russianDumaRound!.registeredVoters), BigInt(0));
    const list = existing.find((row) => row.russianDumaRound?.tier === "list")!;
    if (
      districtVoters < BigInt(1) ||
      districtVoters !== BigInt(list.russianDumaRound!.registeredVoters)
    )
      throw new Error("The first Russian Duma cohort has inconsistent registration");
    return { cohortId: country.ruFirstDumaElectionCohortId, created: false };
  }
  if (country.ruFederalAssemblySinceTurn != null) return null;
  if (electionIds.length !== 226 || new Set(electionIds.map((id) => id.toHexString())).size !== 226)
    throw new Error("The first Russian Duma needs 226 distinct ballot identities");
  const conflict = await elections.findOne(
    {
      countryId: "RU",
      electionType: "dumaDeputy",
      status: { $in: ["active", "upcoming", "completed"] },
    },
    { session, projection: { _id: 1 } }
  );
  if (conflict) throw new Error("An unresolved Russian Duma ballot already exists");
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
    throw new Error("Russian Duma registration pools contain duplicate regions");
  const register = freezeRussianDumaElectorate(
    regions.map((row) => ({
      id: String(row._id),
      population: row.population,
      votingEligiblePopulation: row.votingEligiblePopulation,
    })),
    Object.fromEntries(pools.map((row) => [row.stateId, row.unregistered]))
  );
  const districts = planRussianDumaDistricts(register);
  const timing = planRussianDumaBallot(turn);
  const common = {
    countryId: "RU" as const,
    electionType: "dumaDeputy",
    cycle: 1,
    electionYear: turnToGameMonth(calendarTurn(timing.endTurn, clock), 1991).year,
    status: "active" as const,
    ...timing,
    startTime: now,
    primaryEndTime: new Date(now.getTime() + (timing.primaryEndTurn - turn) * MS_PER_TURN),
    endTime: new Date(now.getTime() + (timing.endTurn - turn) * MS_PER_TURN),
    createdAt: now,
    updatedAt: now,
  };
  const mandateSinceTurn = country.ruFederalAssemblyMandateSinceTurn!;
  const ballots: Election[] = districts.map((district, index) => ({
    ...common,
    _id: electionIds[index],
    state: district.regionId,
    seatId: district.seatId,
    totalSeats: 1,
    russianDumaRound: {
      cohortId,
      mandateSinceTurn,
      tier: "constituency",
      registeredVoters: district.registeredVoters,
      regionalDistrictCount: district.regionalDistrictCount,
    },
  }));
  ballots.push({
    ...common,
    _id: electionIds[225],
    state: "RU",
    seatId: "RU-duma-national-list",
    totalSeats: 225,
    russianDumaRound: {
      cohortId,
      mandateSinceTurn,
      tier: "list",
      registeredVoters: Object.values(register).reduce((sum, voters) => sum + voters, 0),
    },
  });
  const claimed = await countries.updateOne(
    {
      _id: "RU",
      ruFederalAssemblyMandateSinceTurn: mandateSinceTurn,
      ruFirstDumaElectionCohortId: { $exists: false },
    },
    { $set: { ruFirstDumaElectionCohortId: cohortId, updatedAt: now } },
    { session }
  );
  if (claimed.matchedCount !== 1)
    throw new Error("Russian Assembly mandate changed before opening");
  await elections.insertMany(ballots, { session });
  return { cohortId, created: true };
}

export async function openRussianDumaElection(
  input: Omit<
    Parameters<typeof materializeRussianDumaElectionOpening>[0],
    "session" | "cohortId" | "electionIds"
  >
) {
  if (
    input.game.preset !== "1991-default" ||
    ru1993LegislatureStage(
      calendarTurn(input.turn, {
        preIterationActive: input.game.preIteration?.active,
        preIterationTurns: input.game.preIterationTurns,
      })
    ) === "congress"
  )
    return null;
  const cohortId = new ObjectId();
  const electionIds = Array.from({ length: 226 }, () => new ObjectId());
  return runRequiredTransaction(
    (session) =>
      materializeRussianDumaElectionOpening({ ...input, session, cohortId, electionIds }),
    { client: input.db.client }
  );
}
