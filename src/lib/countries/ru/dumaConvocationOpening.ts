/**
 * Ordinary Duma campaigns open both electoral tiers under a proved predecessor.
 * materializeRussianDumaConvocationOpening atomically publishes 226 frozen ballots
 * and a new authority receipt while retaining the current Duma and Council offices.
 */
import { loadEnactedRussianDumaLaw } from "./dumaElectoralProposals1995";
import { ObjectId, type ClientSession, type Db } from "mongodb";
import type { CountryGameState, Election, State, StateRegistrationPool } from "@/lib/db/types";
import { runRequiredTransaction } from "@/lib/db/runRequiredTransaction";
import { MS_PER_TURN } from "@/lib/constants/turnTime";
import { calendarTurn, turnToGameMonth } from "@/lib/utils/gameDate";
import type { RussianConstitutionalCalendar } from "./constitutionalProposals";
import { freezeRussianDumaElectorate } from "./rules/assemblyElectorate";
import { planRussianDumaDistricts } from "./rules/assemblyDistricts";
import { planRussianDumaConvocation, russianDumaConvocationTermEnd } from "./rules/dumaConvocation";
import {
  loadCurrentRussianDumaClock,
  loadRussianDumaAuthority,
  RUSSIAN_DUMA_AUTHORITY_PROJECTION,
  RUSSIAN_DUMA_CONVOCATIONS_COLLECTION,
  type RussianDumaConvocationRecord,
} from "./dumaConvocationAuthority";

export async function materializeRussianDumaConvocationOpening(input: {
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
    throw new Error("Ordinary Duma opening needs a transaction, turn and time");
  if (game.preset !== "1991-default") return null;
  const countries = db.collection<CountryGameState>("countryGameStates");
  const country = await countries.findOne(
    { _id: "RU" },
    {
      session,
      projection: {
        ...RUSSIAN_DUMA_AUTHORITY_PROJECTION,
        ruDumaElectoralMandate: 1,
        dissolvedTurn: 1,
      },
    }
  );
  if (!country || country.dissolvedTurn != null) return null;
  const current = await loadCurrentRussianDumaClock({ db, session, country, turn });
  if (!current) return null;
  const pending =
    country.ruDumaConvocationCohortId &&
    !country.ruDumaConvocationCohortId.equals(
      country.ruDumaCurrentConvocationCohortId ?? country.ruFirstDumaElectionCohortId!
    )
      ? country.ruDumaConvocationCohortId
      : undefined;
  const planned = planRussianDumaConvocation({
    turn,
    current,
    pendingRootId: pending?.toHexString(),
  });
  if (planned.kind === "wait") return null;
  if (planned.kind === "resume") {
    const authority = await loadRussianDumaAuthority({
      db,
      session,
      country,
      root: pending!,
      turn,
    });
    if (!authority?.record) throw new Error("Pending ordinary Duma lacks its authority");
    return { cohortId: pending!, number: authority.number, created: false };
  }
  if (electionIds.length !== 226 || new Set(electionIds.map((id) => id.toHexString())).size !== 226)
    throw new Error("An ordinary Duma requires 226 distinct ballot identities");
  const electoralLaw = await loadEnactedRussianDumaLaw({ db, session, country, turn });
  const lawFields = electoralLaw === "law1995" ? { electoralLaw } : {};
  const elections = db.collection<Election>("elections");
  // Let a current family's last pending repeat certify before changing its authority.
  if (
    await elections.findOne(
      {
        countryId: "RU",
        electionType: "dumaDeputy",
        status: { $in: ["upcoming", "active", "completed"] },
      },
      { session, projection: { _id: 1 } }
    )
  )
    return null;
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
    throw new Error("Ordinary Duma registration contains duplicate regions");
  const register = freezeRussianDumaElectorate(
    regions.map((row) => ({
      id: String(row._id),
      population: row.population,
      votingEligiblePopulation: row.votingEligiblePopulation,
    })),
    Object.fromEntries(pools.map((row) => [row.stateId, row.unregistered]))
  );
  const districts = planRussianDumaDistricts(register);
  const timing = planned.timing;
  const mandateSinceTurn = country.ruFederalAssemblyMandateSinceTurn!;
  const common = {
    countryId: "RU" as const,
    electionType: "dumaDeputy",
    cycle: planned.number,
    electionYear: turnToGameMonth(
      calendarTurn(timing.endTurn, {
        preIterationActive: game.preIteration?.active,
        preIterationTurns: game.preIterationTurns,
      }),
      1991
    ).year,
    status: "active" as const,
    ...timing,
    startTime: now,
    primaryEndTime: new Date(now.getTime() + (timing.primaryEndTurn - turn) * MS_PER_TURN),
    endTime: new Date(now.getTime() + (timing.endTurn - turn) * MS_PER_TURN),
    createdAt: now,
    updatedAt: now,
  };
  const ballots: Election[] = districts.map((district, index) => ({
    ...common,
    _id: electionIds[index],
    state: district.regionId,
    seatId: district.seatId,
    totalSeats: 1,
    russianDumaRound: {
      ...lawFields,
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
      ...lawFields,
      cohortId,
      mandateSinceTurn,
      tier: "list",
      registeredVoters: Object.values(register).reduce((sum, value) => sum + value, 0),
    },
  });
  const record: RussianDumaConvocationRecord = {
    _id: cohortId.toHexString(),
    countryId: "RU",
    preset: "1991-default",
    cohortId,
    firstDumaRoot: country.ruFirstDumaElectionCohortId!,
    firstCouncilRoot: country.ruFirstCouncilElectionCohortId!,
    mandateSinceTurn,
    number: planned.number,
    ...lawFields,
    ...(electoralLaw === "law1995" ? { electoralMandate: country.ruDumaElectoralMandate } : {}),
    predecessorCohortId: new ObjectId(current.rootId),
    predecessorSeatedOnTurn: current.seatedOnTurn,
    predecessorTermEndTurn: current.termEndTurn,
    openedOnTurn: turn,
    originalPollEndTurn: timing.endTurn,
    termEndTurn: russianDumaConvocationTermEnd(timing.endTurn, planned.number),
    electionIds: [...electionIds],
    createdAt: now,
  };
  const claimed = await countries.updateOne(
    {
      _id: "RU",
      ruFederalAssemblySinceTurn: country.ruFederalAssemblySinceTurn,
      ruFederalAssemblyMandateSinceTurn: mandateSinceTurn,
      ruFirstDumaElectionCohortId: country.ruFirstDumaElectionCohortId,
      ruFirstCouncilElectionCohortId: country.ruFirstCouncilElectionCohortId,
      ruDumaConvocationCohortId: country.ruDumaConvocationCohortId ?? { $exists: false },
      ruDumaCurrentConvocationCohortId: country.ruDumaCurrentConvocationCohortId ?? {
        $exists: false,
      },
    },
    { $set: { ruDumaConvocationCohortId: cohortId, updatedAt: now } },
    { session }
  );
  if (claimed.matchedCount !== 1) throw new Error("Duma predecessor changed before opening");
  await elections.insertMany(ballots, { session });
  await db
    .collection<RussianDumaConvocationRecord>(RUSSIAN_DUMA_CONVOCATIONS_COLLECTION)
    .insertOne(record, { session });
  return { cohortId, number: planned.number, created: true };
}
export async function openRussianDumaConvocation(
  input: Omit<
    Parameters<typeof materializeRussianDumaConvocationOpening>[0],
    "session" | "cohortId" | "electionIds"
  >
) {
  if (input.game.preset !== "1991-default") return null;
  // Waiting turns do not start a transaction or allocate hundreds of ids.
  const country = await input.db
    .collection<CountryGameState>("countryGameStates")
    .findOne({ _id: "RU" }, { projection: RUSSIAN_DUMA_AUTHORITY_PROJECTION });
  if (!country) return null;
  const current = await loadCurrentRussianDumaClock({ db: input.db, country, turn: input.turn });
  if (!current) return null;
  const pending =
    country.ruDumaConvocationCohortId &&
    !country.ruDumaConvocationCohortId.equals(
      country.ruDumaCurrentConvocationCohortId ?? country.ruFirstDumaElectionCohortId!
    )
      ? country.ruDumaConvocationCohortId
      : undefined;
  const planned = planRussianDumaConvocation({
    turn: input.turn,
    current,
    pendingRootId: pending?.toHexString(),
  });
  if (planned.kind === "wait") return null;
  if (planned.kind === "resume") {
    const authority = await loadRussianDumaAuthority({
      db: input.db,
      country,
      root: pending!,
      turn: input.turn,
    });
    if (!authority?.record) throw new Error("Pending ordinary Duma lacks its authority");
    return { cohortId: pending!, number: authority.number, created: false };
  }
  const cohortId = new ObjectId(),
    electionIds = Array.from({ length: 226 }, () => new ObjectId());
  return runRequiredTransaction(
    (session) =>
      materializeRussianDumaConvocationOpening({ ...input, session, cohortId, electionIds }),
    { client: input.db.client }
  );
}
