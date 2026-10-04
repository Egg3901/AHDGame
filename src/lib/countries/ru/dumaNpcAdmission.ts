/**
 * First-Duma NPC nominees share profiles without cloning personal accounts.
 * materializeRussianDumaNpcAdmission registers bounded party slates atomically
 * against the frozen cohort and leaves existing player candidacies intact.
 */
import { ObjectId, type ClientSession, type Db } from "mongodb";
import type { CountryGameState, Election, GameState } from "@/lib/db/types";
import { runRequiredTransaction } from "@/lib/db/runRequiredTransaction";
import { ensureBoundedNpcCandidateGuards } from "@/lib/admin/seed/indexes/boundedNpcCandidates";
import { registerRussianDumaNpcSlates } from "./dumaNpcRegistration";
import { resolveRussianDumaCohort } from "./rules/assemblyCohort";
import {
  russianDumaBoundRoot,
  loadRussianDumaAuthority,
  russianDumaRootFilter,
} from "./dumaConvocationAuthority";
import { hasAuthorizedPostSovietTransition } from "./rules/postSovietTransition";
export async function materializeRussianDumaNpcAdmission(input: {
  db: Db;
  session: ClientSession;
  cohortId: ObjectId;
  turn: number;
  now: Date;
}): Promise<{ created: number; unrepresentedParties: string[] } | null> {
  const { db, session, cohortId, turn, now } = input;
  if (
    !session.inTransaction() ||
    !Number.isSafeInteger(turn) ||
    turn < 1 ||
    !Number.isSafeInteger(now.getTime()) ||
    now.getTime() < 0
  )
    throw new Error("Duma NPC admission requires a transaction, turn and time");
  const game = await db
    .collection<GameState>("gameState")
    .findOne({ _id: "current" }, { session, projection: { preset: 1 } });
  if (game?.preset !== "1991-default") return null;
  const countries = db.collection<CountryGameState>("countryGameStates");
  const country = await countries.findOne(
    { _id: "RU" },
    {
      session,
      projection: {
        ruSovietSuccessionSinceTurn: 1,
        ruFederalAssemblyMandateSinceTurn: 1,
        ruFirstDumaElectionCohortId: 1,
        ruDumaConvocationCohortId: 1,
        ruDumaCurrentConvocationCohortId: 1,
        ruFirstCouncilElectionCohortId: 1,
        ruFederalAssemblySinceTurn: 1,
        ruDumaNpcAdmissionCohortId: 1,
        ruDumaUnrepresentedParties: 1,
      },
    }
  );
  if (
    !country ||
    !russianDumaBoundRoot(country)?.equals(cohortId) ||
    !hasAuthorizedPostSovietTransition(
      turn,
      country.ruSovietSuccessionSinceTurn,
      country.ruFederalAssemblyMandateSinceTurn
    )
  )
    return null;
  const authority = await loadRussianDumaAuthority({ db, session, country, root: cohortId, turn });
  if (!authority) throw new Error("Duma campaign authority changed");
  if (country.ruDumaNpcAdmissionCohortId?.equals(cohortId))
    return { created: 0, unrepresentedParties: country.ruDumaUnrepresentedParties ?? [] };
  const elections = await db
    .collection<Election>("elections")
    .find(
      { countryId: "RU", "russianDumaRound.cohortId": cohortId },
      {
        session,
        batchSize: 1000,
        projection: {
          state: 1,
          seatId: 1,
          totalSeats: 1,
          status: 1,
          electionType: 1,
          primaryEndTurn: 1,
          russianDumaRound: 1,
        },
      }
    )
    .toArray();
  if (
    elections.some(
      (row) =>
        !["upcoming", "active"].includes(row.status) ||
        !Number.isSafeInteger(row.primaryEndTurn) ||
        row.primaryEndTurn! <= turn
    )
  )
    return null;
  if (
    elections.some(
      (row) =>
        row.electionType !== "dumaDeputy" ||
        row.russianDumaRound?.mandateSinceTurn !== country.ruFederalAssemblyMandateSinceTurn ||
        row.totalSeats !== (row.russianDumaRound?.tier === "list" ? 225 : 1)
    )
  )
    throw new Error("Duma NPC admission found an invalid bound ballot");
  // Reuse complete-cohort and frozen-register validation without awarding a
  // mandate: zero participation yields only vacancies and a repeat list.
  resolveRussianDumaCohort(
    elections.map((row) => ({
      id: row._id.toHexString(),
      seatId: row.seatId ?? "",
      regionId: row.state,
      tier: row.russianDumaRound!.tier,
      registeredVoters: row.russianDumaRound!.registeredVoters,
      againstAllVotes: 0,
      candidates: [],
    }))
  );
  const registration = await registerRussianDumaNpcSlates({
    db,
    session,
    cohortId,
    elections,
    councilCohortId: country.ruFirstCouncilElectionCohortId,
    mandateSinceTurn: country.ruFederalAssemblyMandateSinceTurn,
    now,
    convocationNumber: authority.number,
  });
  const claimed = await countries.updateOne(
    {
      _id: "RU",
      ...russianDumaRootFilter(country, cohortId),
      ruDumaNpcAdmissionCohortId: country.ruDumaNpcAdmissionCohortId ?? { $exists: false },
    },
    {
      $set: {
        ruDumaNpcAdmissionCohortId: cohortId,
        ruDumaUnrepresentedParties: registration.unrepresentedParties,
        updatedAt: now,
      },
    },
    { session }
  );
  if (claimed.matchedCount !== 1)
    throw new Error("Duma NPC admission binding changed during registration");
  return registration;
}
export async function admitRussianDumaNpcNominees(input: {
  db: Db;
  cohortId: ObjectId;
  turn: number;
  now: Date;
}) {
  if (
    !Number.isSafeInteger(input.turn) ||
    input.turn < 1 ||
    !Number.isSafeInteger(input.now.getTime()) ||
    input.now.getTime() < 0
  )
    throw new Error("Duma NPC admission requires a turn and time");
  const game = await input.db
    .collection<GameState>("gameState")
    .findOne({ _id: "current" }, { projection: { preset: 1 } });
  if (game?.preset !== "1991-default") return null;
  const country = await input.db.collection<CountryGameState>("countryGameStates").findOne(
    { _id: "RU" },
    {
      projection: {
        ruFirstDumaElectionCohortId: 1,
        ruDumaConvocationCohortId: 1,
        ruDumaNpcAdmissionCohortId: 1,
        ruDumaUnrepresentedParties: 1,
      },
    }
  );
  if (!country || !russianDumaBoundRoot(country)?.equals(input.cohortId)) return null;
  if (country.ruDumaNpcAdmissionCohortId?.equals(input.cohortId))
    return { created: 0, unrepresentedParties: country.ruDumaUnrepresentedParties ?? [] };
  // DDL must finish outside the transaction. The source-pinned bootstrap
  // normally already created these guards; verification also protects old saves.
  await ensureBoundedNpcCandidateGuards(input.db);
  return runRequiredTransaction(
    (session) => materializeRussianDumaNpcAdmission({ ...input, session }),
    { client: input.db.client }
  );
}
