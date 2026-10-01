/**
 * First-Duma NPC nominees share profiles without cloning personal accounts.
 * materializeRussianDumaNpcAdmission registers bounded party slates atomically
 * against the frozen cohort and leaves existing player candidacies intact.
 */
import { createHash } from "node:crypto";
import { ObjectId, type ClientSession, type Db } from "mongodb";
import type {
  CountryGameState,
  Election,
  ElectionCandidate,
  GameState,
  NPP,
  PoliticalParty,
} from "@/lib/db/types";
import { runRequiredTransaction } from "@/lib/db/runRequiredTransaction";
import { ensureBoundedNpcCandidateGuards } from "@/lib/admin/seed/indexes/boundedNpcCandidates";
import { DEFAULT_CANDIDATE_SUPPORT } from "@/lib/electionEngine/electionFormulaFactors";
import { planRussianDumaNpcSlates } from "./rules/assemblyNpcSlates";
import { resolveRussianDumaCohort } from "./rules/assemblyCohort";
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
        ruDumaNpcAdmissionCohortId: 1,
        ruDumaUnrepresentedParties: 1,
      },
    }
  );
  if (
    !country?.ruFirstDumaElectionCohortId?.equals(cohortId) ||
    !hasAuthorizedPostSovietTransition(
      turn,
      country.ruSovietSuccessionSinceTurn,
      country.ruFederalAssemblyMandateSinceTurn
    )
  )
    return null;
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
  const parties = await db
    .collection<PoliticalParty>("politicalParties")
    .find(
      { countryId: "RU", regimeStatus: { $ne: "banned" } },
      { session, projection: { sequentialId: 1 } }
    )
    .toArray();
  const partyIds = parties.map((party) => String(party.sequentialId));
  if (parties.some((party) => !Number.isSafeInteger(party.sequentialId) || party.sequentialId < 1))
    throw new Error("Duma NPC admission needs registered party identities");
  const profiles = await db
    .collection<NPP>("npps")
    .find(
      {
        countryId: "RU",
        party: { $in: partyIds },
        isTechnocrat: { $ne: true },
        $or: [{ retiredAt: null }, { retiredAt: { $exists: false } }],
      },
      {
        session,
        batchSize: 1000,
        projection: { name: 1, party: 1, homeState: 1, currentOffice: 1 },
      }
    )
    .toArray();
  const active = await db
    .collection<ElectionCandidate>("electionCandidates")
    .find(
      { electionId: { $in: elections.map((row) => row._id) }, status: "active" },
      {
        session,
        batchSize: 1000,
        projection: { electionId: 1, party: 1, isNPP: 1, russianDumaNomination: 1 },
      }
    )
    .toArray();
  if (active.some((row) => !row.russianDumaNomination))
    throw new Error("Duma active candidacy has no frozen nomination");
  const plan = planRussianDumaNpcSlates({
    ballots: elections.map((row) => ({
      id: row._id.toHexString(),
      regionId: row.state,
      tier: row.russianDumaRound!.tier,
    })),
    parties: partyIds,
    profiles: profiles.map((row) => ({
      id: row._id.toHexString(),
      party: row.party,
      homeState: row.homeState,
      eligible:
        !row.currentOffice ||
        ["congressDeputy", "dumaDeputy", "federationCouncilMember"].includes(row.currentOffice),
    })),
    activeCandidates: active.map((row) => ({
      electionId: row.electionId.toHexString(),
      party: row.party,
      isNpc: row.isNPP === true,
    })),
  });
  const profileById = new Map(profiles.map((row) => [row._id.toHexString(), row]));
  const documents: ElectionCandidate[] = plan.nominees.map((nominee) => {
    const profile = profileById.get(nominee.profileId)!;
    const id = new ObjectId(
      createHash("sha256")
        .update(`duma:${cohortId.toHexString()}:${nominee.nomineeKey}`)
        .digest("hex")
        .slice(0, 24)
    );
    return {
      _id: id,
      boundedNpcNomineeId: id,
      electionId: new ObjectId(nominee.electionId),
      countryId: "RU",
      characterId: profile._id,
      nppId: profile._id,
      isNPP: true,
      characterName: `${profile.name} slate`,
      party: nominee.party,
      status: "active",
      enteredAt: now,
      support: DEFAULT_CANDIDATE_SUPPORT,
      russianDumaNomination: {
        capacity: nominee.capacity,
        registrationOrder: now.getTime(),
        nominationOrder: Number.MAX_SAFE_INTEGER,
      },
    };
  });
  if (documents.length)
    await db
      .collection<ElectionCandidate>("electionCandidates")
      .insertMany(documents, { session, ordered: true });
  const claimed = await countries.updateOne(
    {
      _id: "RU",
      ruFirstDumaElectionCohortId: cohortId,
      ruDumaNpcAdmissionCohortId: country.ruDumaNpcAdmissionCohortId ?? { $exists: false },
    },
    {
      $set: {
        ruDumaNpcAdmissionCohortId: cohortId,
        ruDumaUnrepresentedParties: plan.unrepresentedParties,
        updatedAt: now,
      },
    },
    { session }
  );
  if (claimed.matchedCount !== 1)
    throw new Error("Duma NPC admission binding changed during registration");
  return { created: documents.length, unrepresentedParties: plan.unrepresentedParties };
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
  const country = await input.db
    .collection<CountryGameState>("countryGameStates")
    .findOne(
      { _id: "RU", ruFirstDumaElectionCohortId: input.cohortId },
      { projection: { ruDumaNpcAdmissionCohortId: 1, ruDumaUnrepresentedParties: 1 } }
    );
  if (!country) return null;
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
