import { MongoServerError, type Db } from "mongodb";
import {
  buildBgOrdinaryElectionPlan,
  type BgOrdinaryElectionPlan,
  type BgOrdinaryRace,
} from "@/lib/countries/bg/rules/ordinaryElectionPlan";
import { TALLY_WITH_LATEST_SNAPSHOT_ONLY } from "@/lib/electionEngine/tallyProjections";
import type {
  Character,
  Election,
  ElectionCandidate,
  ElectionVoteTally,
  NPP,
} from "@/lib/db/types";
import {
  BG_ORDINARY_ASSEMBLY_SEATS,
  BG_LEGACY_ORDINARY_ASSEMBLY_SEATS,
} from "@/lib/countries/bg/rules/assemblyTransition";
import { bgNationwideEligibleParties } from "@/lib/countries/bg/rules/ordinaryElection";

/** Read the full 1991 slate once before any regional race is seated. */
export async function readBgOrdinaryEligibleParties(db: Db): Promise<ReadonlySet<string> | null> {
  const elections = await db
    .collection<Election>("elections")
    .find({ countryId: "BG", electionType: "nationalAssembly", cycle: 1 })
    .toArray();
  const tallies = await db
    .collection<ElectionVoteTally>("electionVoteTallies")
    .find({ electionId: { $in: elections.map((e) => e._id) } })
    .toArray();
  const talliesById = new Map(tallies.map((tally) => [tally.electionId.toString(), tally]));
  return bgNationwideEligibleParties(
    elections.map((election) => {
      const tally = talliesById.get(election._id.toString());
      const lastSnapshot = tally?.turnSnapshots?.[tally.turnSnapshots.length - 1];
      const votes =
        tally && Object.keys(tally.totalVotes).length > 0
          ? tally.totalVotes
          : (lastSnapshot?.cumulativeVotes ?? {});
      return {
        state: election.state,
        totalSeats: election.totalSeats ?? 0,
        status: election.status,
        votes,
        candidateParties: tally?.candidateParties ?? {},
      };
    })
  );
}

export const BG_ORDINARY_PLANS_COLLECTION = "bgOrdinaryElectionPlans";
export interface BgOrdinaryPlanRecord {
  _id: string;
  countryId: "BG";
  cycle: number;
  electionIds: string[];
  legacyResolvedElectionIds?: string[];
  nominees: Array<{
    id: string;
    ownerId: string;
    electionId: string;
    isNpc: boolean;
    party: string;
    listOrder: number;
    name: string;
  }>;
  settledCandidateSeats?: Record<string, Record<string, number>>;
  plan: BgOrdinaryElectionPlan;
  createdAt: Date;
  seatedAtTurn?: number;
  seatedAt?: Date;
  officialIds?: import("mongodb").ObjectId[];
}

/**
 * Freeze the national count before any regional seating. A deterministic unique
 * journal id makes concurrent readers choose the same stored allocation. Later
 * retries read it directly, including after candidate rows have been withdrawn.
 */
export async function readBgOrdinaryElectionPlan(
  db: Db,
  cycle: number,
  now: Date
): Promise<BgOrdinaryElectionPlan | null> {
  if (!Number.isSafeInteger(cycle) || cycle < 1)
    throw new Error("Invalid Bulgarian ordinary cycle");
  const journal = db.collection<BgOrdinaryPlanRecord>(BG_ORDINARY_PLANS_COLLECTION);
  const key = `BG:ordinary:${cycle}`;
  const saved = await journal.findOne({ _id: key });
  if (saved) return saved.plan;
  const elections = await db
    .collection<Election>("elections")
    .find(
      { countryId: "BG", electionType: "nationalAssembly", cycle },
      { projection: { state: 1, status: 1, totalSeats: 1 } }
    )
    .toArray();
  if (
    elections.length !== 5 ||
    elections.some((row) => !["completed", "resolved"].includes(row.status))
  )
    return null;
  // A rejected constitution retains400-seat campaigns. Only an actual frozen
  // ordinary cohort enters the native240-seat count, including old recorded polls.
  if (
    ![BG_ORDINARY_ASSEMBLY_SEATS, BG_LEGACY_ORDINARY_ASSEMBLY_SEATS].some((capacities) =>
      elections.every((row) => row.totalSeats === capacities[row.state])
    )
  )
    return null;
  // Fully settled legacy cycles retain their result. A partly installed old
  // cycle is reconciled together, with its previous offices archived, so its
  // remaining regions cannot stall forever between two counting systems.
  if (elections.every((row) => row.status === "resolved")) return null;
  const legacyResolvedElectionIds = elections
    .filter((row) => row.status === "resolved")
    .map((row) => row._id.toHexString());
  const ids = elections.map((row) => row._id);
  const [tallies, candidates] = await Promise.all([
    db
      .collection<ElectionVoteTally>("electionVoteTallies")
      .find({ electionId: { $in: ids } }, { projection: TALLY_WITH_LATEST_SNAPSHOT_ONLY })
      .toArray(),
    db
      .collection<ElectionCandidate>("electionCandidates")
      .find(
        { electionId: { $in: ids } },
        {
          projection: {
            electionId: 1,
            characterId: 1,
            nppId: 1,
            isNPP: 1,
            party: 1,
            status: 1,
            enteredAt: 1,
            characterName: 1,
          },
        }
      )
      .toArray(),
  ]);
  const npcIds = candidates.filter((row) => row.isNPP && row.nppId).map((row) => row.nppId!);
  const playerIds = candidates.filter((row) => !row.isNPP).map((row) => row.characterId);
  const [npcs, players] = await Promise.all([
    npcIds.length
      ? db
          .collection<NPP>("npps")
          .find(
            { _id: { $in: npcIds }, countryId: "BG", retiredAt: null, isTechnocrat: { $ne: true } },
            { projection: { _id: 1 } }
          )
          .toArray()
      : Promise.resolve([]),
    playerIds.length
      ? db
          .collection<Character>("characters")
          .find(
            {
              _id: { $in: playerIds },
              countryId: "BG",
              federationPendingResidenceId: { $exists: false },
            },
            { projection: { _id: 1 } }
          )
          .toArray()
      : Promise.resolve([]),
  ]);
  const liveNpcs = new Set(npcs.map((row) => row._id.toHexString()));
  const livePlayers = new Set(players.map((row) => row._id.toHexString()));
  const tallyMap = new Map(tallies.map((row) => [row.electionId.toHexString(), row]));
  const races: BgOrdinaryRace[] = [];
  for (const election of elections) {
    const tally = tallyMap.get(election._id.toHexString());
    if (
      !tally ||
      (tally.finalized && !legacyResolvedElectionIds.includes(election._id.toHexString()))
    )
      return null;
    const votes = Object.keys(tally.totalVotes ?? {}).length
      ? tally.totalVotes
      : tally.turnSnapshots?.at(-1)?.cumulativeVotes;
    if (!votes || !Object.values(votes).some((value) => value > 0)) return null;
    const nominees = candidates.filter((row) => row.electionId.equals(election._id));
    const known = new Set(nominees.map((row) => row._id.toHexString()));
    if (Object.keys(votes).some((id) => !known.has(id))) return null;
    races.push({
      electionId: election._id.toHexString(),
      regionId: election.state,
      candidates: nominees.map((row) => {
        const ownerId = (row.isNPP ? row.nppId : row.characterId)?.toHexString();
        if (!ownerId) throw new Error("Bulgarian nominee has no owner");
        return {
          id: row._id.toHexString(),
          ownerId,
          party: row.party,
          votes: votes[row._id.toHexString()] ?? 0,
          listOrder: row.enteredAt.getTime(),
          isNpc: !!row.isNPP,
          eligible:
            (row.status === "active" ||
              legacyResolvedElectionIds.includes(election._id.toHexString())) &&
            (row.isNPP ? liveNpcs : livePlayers).has(ownerId),
        };
      }),
    });
  }
  const plan = buildBgOrdinaryElectionPlan(races);
  if (plan.kind === "deferred") return null;
  try {
    await journal.updateOne(
      { _id: key },
      {
        $setOnInsert: {
          countryId: "BG",
          cycle,
          electionIds: ids.map((id) => id.toHexString()),
          legacyResolvedElectionIds,
          plan,
          nominees: candidates.map((row) => ({
            id: row._id.toHexString(),
            ownerId: (row.isNPP ? row.nppId! : row.characterId).toHexString(),
            electionId: row.electionId.toHexString(),
            isNpc: !!row.isNPP,
            party: row.party,
            listOrder: row.enteredAt.getTime(),
            name: row.characterName,
          })),
          createdAt: now,
        },
      },
      { upsert: true }
    );
  } catch (error) {
    // Concurrent first writers can race on the unique _id; only that expected
    // collision permits reading the winner's receipt. Every other error fails.
    if (!(error instanceof MongoServerError) || error.code !== 11000) throw error;
  }
  const stored = await journal.findOne({ _id: key });
  if (!stored) throw new Error("Bulgarian national allocation receipt is missing");
  return stored.plan;
}
