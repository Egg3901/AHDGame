/**
 * A ratified Assembly mandate opens 89 two-seat Council subject ballots together.
 * materializeRussianCouncilElectionOpening freezes their current registers in one
 * transaction and preserves Congress until a separate certified chamber handover.
 */
import { ObjectId, type ClientSession, type Db } from "mongodb";
import type { CountryGameState, Election, State, StateRegistrationPool } from "@/lib/db/types";
import { MS_PER_TURN } from "@/lib/constants/turnTime";
import { calendarTurn, turnToGameMonth } from "@/lib/utils/gameDate";
import { runRequiredTransaction } from "@/lib/db/runRequiredTransaction";
import { ru1993LegislatureStage } from "./eras/1991";
import { hasAuthorizedPostSovietTransition } from "./rules/postSovietTransition";
import { planRussianCouncilDistricts } from "./rules/councilDistricts";
import { freezeRussianCouncilElectorate } from "./rules/councilElectorate";
import { planRussianDumaBallot } from "./rules/assemblySchedule";
import type { RussianConstitutionalCalendar } from "./constitutionalProposals";

export const RUSSIAN_COUNCIL_OPENINGS_COLLECTION = "russianCouncilElectionOpenings";
export interface RussianCouncilOpeningRecord {
  _id: string;
  cohortId: ObjectId;
  /** Absent for the original complete89-subject opening. */
  rootCohortId?: ObjectId;
  generation?: number;
  previousResultId?: string;
  seatIds?: string[];
  countryId: "RU";
  preset: "1991-default";
  mandateSinceTurn: number;
  openedOnTurn: number;
  electionIds: ObjectId[];
  registeredBySubject: Record<string, number>;
  npcAdmission?: {
    createdCandidates: number;
    unrepresentedParties: string[];
    completedOnTurn: number;
  };
  createdAt: Date;
  /** Serializes player admission with automatic admission to this frozen cohort. */
  playerFilings?: number;
}

export async function materializeRussianCouncilElectionOpening(input: {
  db: Db;
  session: ClientSession;
  game: RussianConstitutionalCalendar;
  turn: number;
  now: Date;
  cohortId: ObjectId;
  electionIds: readonly ObjectId[];
}) {
  const { db, session, game, turn, now, cohortId, electionIds } = input;
  if (
    !session.inTransaction() ||
    !Number.isSafeInteger(turn) ||
    turn < 1 ||
    !Number.isFinite(now.getTime())
  )
    throw new Error("Council opening needs an active transaction, turn and time");
  const clock = {
    preIterationActive: game.preIteration?.active,
    preIterationTurns: game.preIterationTurns,
  };
  if (
    game.preset !== "1991-default" ||
    ru1993LegislatureStage(calendarTurn(turn, clock)) === "congress"
  )
    return null;
  const countries = db.collection<CountryGameState>("countryGameStates");
  const country = await countries.findOne(
    { _id: "RU" },
    {
      session,
      projection: {
        ruSovietSuccessionSinceTurn: 1,
        ruFederalAssemblyMandateSinceTurn: 1,
        ruFirstCouncilElectionCohortId: 1,
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
  const openings = db.collection<RussianCouncilOpeningRecord>(RUSSIAN_COUNCIL_OPENINGS_COLLECTION);
  if (country.ruFirstCouncilElectionCohortId) {
    const opening = await openings.findOne(
      { _id: country.ruFirstCouncilElectionCohortId.toHexString() },
      { session }
    );
    if (
      !opening ||
      opening.countryId !== "RU" ||
      opening.preset !== "1991-default" ||
      !opening.cohortId.equals(country.ruFirstCouncilElectionCohortId) ||
      opening.mandateSinceTurn !== country.ruFederalAssemblyMandateSinceTurn ||
      opening.electionIds.length !== 89 ||
      new Set(opening.electionIds.map((id) => id.toHexString())).size !== 89
    )
      throw new Error("The first Council opening receipt no longer matches its mandate");
    const existing = await elections
      .find(
        { countryId: "RU", "russianCouncilRound.cohortId": country.ruFirstCouncilElectionCohortId },
        {
          session,
          batchSize: 1000,
          projection: {
            electionType: 1,
            state: 1,
            seatId: 1,
            totalSeats: 1,
            russianCouncilRound: 1,
          },
        }
      )
      .toArray();
    const expected = new Map(
      planRussianCouncilDistricts(opening.registeredBySubject).map((row) => [row.seatId, row])
    );
    if (
      existing.length !== 89 ||
      new Set(existing.map((row) => row.seatId)).size !== 89 ||
      existing.some((row) => {
        const district = expected.get(row.seatId ?? "");
        return (
          !district ||
          row.electionType !== "federationCouncilMember" ||
          row.totalSeats !== 2 ||
          row.state !== district.regionId ||
          row.russianCouncilRound?.districtNumber !== district.districtNumber ||
          row.russianCouncilRound?.registeredVoters !== district.registeredVoters ||
          !opening.electionIds.some((id) => id.equals(row._id)) ||
          row.russianCouncilRound?.mandateSinceTurn !== country.ruFederalAssemblyMandateSinceTurn
        );
      })
    )
      throw new Error("The first Council cohort no longer matches its mandate");
    return { cohortId: country.ruFirstCouncilElectionCohortId, created: false };
  }
  if (country.ruFederalAssemblySinceTurn != null) return null;
  if (electionIds.length !== 89 || new Set(electionIds.map((id) => id.toHexString())).size !== 89)
    throw new Error("The first Council needs 89 distinct ballot identities");
  const conflict = await elections.findOne(
    {
      countryId: "RU",
      electionType: "federationCouncilMember",
      status: { $in: ["active", "upcoming", "completed"] },
    },
    { session, projection: { _id: 1 } }
  );
  if (conflict) throw new Error("An unresolved Russian Council ballot already exists");
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
    throw new Error("Council registration pools contain duplicate regions");
  const register = freezeRussianCouncilElectorate(
    regions.map((row) => ({
      id: String(row._id),
      population: row.population,
      votingEligiblePopulation: row.votingEligiblePopulation,
    })),
    Object.fromEntries(pools.map((row) => [row.stateId, row.unregistered]))
  );
  const timing = planRussianDumaBallot(turn);
  const mandateSinceTurn = country.ruFederalAssemblyMandateSinceTurn!;
  const ballots: Election[] = planRussianCouncilDistricts(register).map((district, index) => ({
    _id: electionIds[index],
    countryId: "RU",
    electionType: "federationCouncilMember",
    cycle: 1,
    electionYear: turnToGameMonth(calendarTurn(timing.endTurn, clock), 1991).year,
    status: "active",
    ...timing,
    state: district.regionId,
    seatId: district.seatId,
    totalSeats: 2,
    startTime: now,
    primaryEndTime: new Date(now.getTime() + (timing.primaryEndTurn - turn) * MS_PER_TURN),
    endTime: new Date(now.getTime() + (timing.endTurn - turn) * MS_PER_TURN),
    createdAt: now,
    updatedAt: now,
    russianCouncilRound: {
      cohortId,
      mandateSinceTurn,
      registeredVoters: district.registeredVoters,
      districtNumber: district.districtNumber,
    },
  }));
  const claimed = await countries.updateOne(
    {
      _id: "RU",
      ruFederalAssemblyMandateSinceTurn: mandateSinceTurn,
      ruFirstCouncilElectionCohortId: { $exists: false },
    },
    { $set: { ruFirstCouncilElectionCohortId: cohortId, updatedAt: now } },
    { session }
  );
  if (claimed.matchedCount !== 1)
    throw new Error("Russian Assembly mandate changed before Council opening");
  await elections.insertMany(ballots, { session });
  await openings.insertOne(
    {
      _id: cohortId.toHexString(),
      cohortId,
      countryId: "RU",
      preset: "1991-default",
      mandateSinceTurn,
      openedOnTurn: turn,
      electionIds: [...electionIds],
      registeredBySubject: register,
      createdAt: now,
    },
    { session }
  );
  return { cohortId, created: true };
}

export async function openRussianCouncilElection(
  input: Omit<
    Parameters<typeof materializeRussianCouncilElectionOpening>[0],
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
  const electionIds = Array.from({ length: 89 }, () => new ObjectId());
  return runRequiredTransaction(
    (session) =>
      materializeRussianCouncilElectionOpening({ ...input, session, cohortId, electionIds }),
    { client: input.db.client }
  );
}
