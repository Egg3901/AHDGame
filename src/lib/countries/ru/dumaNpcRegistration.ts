/**
 * Duma NPC slates register bounded nominees using existing profiles and accounts.
 * registerRussianDumaNpcSlates shares projected batch loading between initial
 * and repeat rounds without creating personal identities or changing player entries.
 */
import { createHash } from "node:crypto";
import { ObjectId, type ClientSession, type Db } from "mongodb";
import type { Election, ElectionCandidate, NPP, PoliticalParty } from "@/lib/db/types";
import { DEFAULT_CANDIDATE_SUPPORT } from "@/lib/electionEngine/electionFormulaFactors";
import { loadPendingRussianCouncilOwners } from "./pendingCouncilMandates";
import { russianDumaConvocationOfficeCompatible } from "./rules/dumaConvocation";
import { planRussianDumaNpcSlates } from "./rules/assemblyNpcSlates";

export async function registerRussianDumaNpcSlates(input: {
  db: Db;
  session: ClientSession;
  cohortId: ObjectId;
  elections: readonly Election[];
  councilCohortId?: ObjectId;
  mandateSinceTurn?: number;
  convocationNumber?: number;
  now: Date;
}) {
  const { db, session, cohortId, elections, now } = input;
  if (!session.inTransaction() || !Number.isSafeInteger(now.getTime()) || now.getTime() < 0)
    throw new Error("Duma slate registration needs an active transaction and time");
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
  const councilOwners = await loadPendingRussianCouncilOwners({
    db,
    session,
    cohortId: input.councilCohortId,
    mandateSinceTurn: input.mandateSinceTurn,
  });
  const plan = planRussianDumaNpcSlates({
    ballots: elections.map((row) => ({
      id: row._id.toHexString(),
      regionId: row.state,
      tier: row.russianDumaRound!.tier,
    })),
    parties: partyIds,
    profiles: profiles.map((row) => {
      const office =
        typeof row.currentOffice === "string" ? row.currentOffice : row.currentOffice?.type;
      return {
        id: row._id.toHexString(),
        party: row.party,
        homeState: row.homeState,
        eligible:
          !councilOwners.has(`npc:${row._id.toHexString()}`) &&
          (office === "dumaDeputy" ||
            russianDumaConvocationOfficeCompatible(input.convocationNumber ?? 1, office, "RU")),
      };
    }),
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
  return { created: documents.length, unrepresentedParties: plan.unrepresentedParties };
}
