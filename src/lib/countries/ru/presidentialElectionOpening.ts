/**
 * Russia opens its first direct presidential ballot after an enacted mandate.
 * materializeRussianPresidentialElectionOpening freezes the registered electorate
 * and binds one election to that mandate without activating a presidential office.
 */
import { ObjectId, type ClientSession, type Db } from "mongodb";
import type { CountryGameState, Election, State, StateRegistrationPool } from "@/lib/db/types";
import { MS_PER_TURN } from "@/lib/constants/turnTime";
import { russianPresidentialRegisteredVoters } from "./rules/presidentialElectorate";
import { calendarTurn, turnToGameMonth } from "@/lib/utils/gameDate";
import { runRequiredTransaction } from "@/lib/db/runRequiredTransaction";
import { hasAuthorizedPostSovietTransition } from "./rules/postSovietTransition";
import { planRussianPresidentialBallot } from "./rules/presidentialSchedule";
import type { RussianConstitutionalCalendar } from "./constitutionalProposals";

export async function materializeRussianPresidentialElectionOpening(input: {
  db: Db;
  session: ClientSession;
  game: RussianConstitutionalCalendar;
  turn: number;
  now: Date;
  electionId: ObjectId;
}): Promise<{ electionId: ObjectId; created: boolean } | null> {
  const { db, session, game, turn, now, electionId } = input;
  if (!session.inTransaction() || !Number.isFinite(now.getTime()))
    throw new Error("Russian presidential opening needs an active transaction and time");
  if (game.preset !== "1991-default") return null;
  const clock = {
    preIterationActive: game.preIteration?.active,
    preIterationTurns: game.preIterationTurns,
  };
  if (calendarTurn(turn, clock) < 13) return null;
  const countries = db.collection<CountryGameState>("countryGameStates");
  const country = await countries.findOne(
    { _id: "RU" },
    {
      session,
      projection: {
        ruSovietSuccessionSinceTurn: 1,
        ruPresidencyMandateSinceTurn: 1,
        ruPresidencyFirstElectionId: 1,
        ruPresidencySinceTurn: 1,
      },
    }
  );
  if (
    !country ||
    !hasAuthorizedPostSovietTransition(
      turn,
      country.ruSovietSuccessionSinceTurn,
      country.ruPresidencyMandateSinceTurn
    )
  )
    return null;
  const elections = db.collection<Election>("elections");
  if (country.ruPresidencyFirstElectionId) {
    const existing = await elections.findOne(
      { _id: country.ruPresidencyFirstElectionId, countryId: "RU", electionType: "president" },
      { session, projection: { _id: 1, russianPresidentialRound: 1 } }
    );
    if (
      !existing ||
      existing.russianPresidentialRound?.mandateSinceTurn !== country.ruPresidencyMandateSinceTurn
    )
      throw new Error("Russian first presidential ballot no longer matches its mandate");
    return { electionId: existing._id, created: false };
  }
  // Preserve an older save's established presidency; it is not a fresh first ballot.
  if (country.ruPresidencySinceTurn != null) return null;
  const existing = await elections.findOne(
    {
      countryId: "RU",
      electionType: "president",
      status: { $in: ["active", "upcoming", "completed"] },
    },
    { session, projection: { _id: 1 } }
  );
  if (existing) throw new Error("An unresolved Russian presidential ballot already exists");
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
  const registeredVoters = russianPresidentialRegisteredVoters(
    regions.map((region) => ({
      id: String(region._id),
      population: region.population,
      votingEligiblePopulation: region.votingEligiblePopulation,
    })),
    Object.fromEntries(pools.map((pool) => [pool.stateId, pool.unregistered]))
  );
  const timing = planRussianPresidentialBallot(turn, "first");
  const toTime = (boundary: number) => new Date(now.getTime() + (boundary - turn) * MS_PER_TURN);
  const opened = await countries.updateOne(
    {
      _id: "RU",
      ruPresidencyMandateSinceTurn: country.ruPresidencyMandateSinceTurn,
      ruPresidencyFirstElectionId:
        country.ruPresidencyFirstElectionId === undefined
          ? { $exists: false }
          : country.ruPresidencyFirstElectionId,
    },
    { $set: { ruPresidencyFirstElectionId: electionId, updatedAt: now } },
    { session }
  );
  if (opened.matchedCount !== 1)
    throw new Error("Russian presidential mandate changed before opening");
  await elections.insertOne(
    {
      _id: electionId,
      countryId: "RU",
      electionType: "president",
      state: "RU",
      totalSeats: 1,
      cycle: 1,
      electionYear: turnToGameMonth(calendarTurn(timing.endTurn, clock), 1991).year,
      status: "active",
      ...timing,
      startTime: now,
      primaryEndTime: toTime(timing.primaryEndTurn),
      endTime: toTime(timing.endTurn),
      russianPresidentialRound: {
        round: 1,
        mandateSinceTurn: country.ruPresidencyMandateSinceTurn!,
        registeredVoters,
      },
      createdAt: now,
      updatedAt: now,
    },
    { session }
  );
  return { electionId, created: true };
}

export async function openRussianPresidentialElection(
  input: Omit<
    Parameters<typeof materializeRussianPresidentialElectionOpening>[0],
    "session" | "electionId"
  >
) {
  if (
    input.game.preset !== "1991-default" ||
    calendarTurn(input.turn, {
      preIterationActive: input.game.preIteration?.active,
      preIterationTurns: input.game.preIterationTurns,
    }) < 13
  )
    return null;
  const electionId = new ObjectId();
  return runRequiredTransaction(
    (session) => materializeRussianPresidentialElectionOpening({ ...input, session, electionId }),
    { client: input.db.client }
  );
}
