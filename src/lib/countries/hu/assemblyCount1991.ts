/**
 * Hungary certifies its whole mixed election before any regional office changes.
 * First-round votes and filed people freeze in one journal; subsequent readers
 * reuse that count instead of recalculating after withdrawals or partial seating.
 */
import { type ClientSession, type Db } from "mongodb";
import type { Election, ElectionCandidate, ElectionVoteTally, GameState } from "@/lib/db/types";
import { runRequiredTransaction } from "@/lib/db/runRequiredTransaction";
import { TALLY_WITH_LATEST_SNAPSHOT_ONLY } from "@/lib/electionEngine/tallyProjections";
import { buildHu1991Slates } from "./rules/slates1991";
import type { Hu1991Nominations } from "./rules/mandates1991";
import { projectHu1991CampaignBallots } from "./rules/campaignBallots1991";
import {
  countHuMixed1991,
  type Hu1991MixedBallots,
  type Hu1991MixedCount,
} from "./rules/mixedElection1991";
import { HU_1991_TERRITORIAL_DISTRICTS } from "./data/electoralDistricts1991";

export const HU_1991_COUNTS_COLLECTION = "hu1991AssemblyCounts";
export interface Hu1991AssemblyRecord {
  _id: string;
  countryId: "HU";
  cycle: number;
  ruleVersion: "mixed-1989-v1";
  electionIds: string[];
  legacyResolvedElectionIds: string[];
  nominations: Hu1991Nominations;
  playerConstituencies: Record<string, string>;
  first: Hu1991MixedBallots;
  firstCampaigns: import("./rules/campaignBallots1991").Hu1991RegionalCampaign[];
  count: Hu1991MixedCount;
  nominees: Array<{
    id: string;
    ownerId: string;
    electionId: string;
    isNpc: boolean;
    party: string;
    name: string;
    regionId: string;
  }>;
  createdAt: Date;
  runoffElectionIds?: string[];
  runoffOpenedAtTurn?: number;
  runoffGeneration?: number;
  byElectionGeneration?: number;
  activeRunoffElectionIds?: string[] | null;
  second?: Hu1991MixedBallots;
  seatedAtTurn?: number;
  seatedAt?: Date;
  officialIds?: import("mongodb").ObjectId[];
  settled?: import("./rules/mandates1991").Hu1991InstalledMandates;
}

export async function materializeHu1991FirstCount(input: {
  db: Db;
  session: ClientSession;
  cycle: number;
  turn: number;
  now: Date;
}): Promise<Hu1991AssemblyRecord | null> {
  const { db, session, cycle, turn, now } = input;
  if (
    !session.inTransaction() ||
    !Number.isSafeInteger(cycle) ||
    cycle < 1 ||
    !Number.isSafeInteger(turn) ||
    turn < 1 ||
    !Number.isFinite(now.getTime())
  )
    throw new Error("Hungarian certification needs an active transaction, cycle, turn and time");
  const receiptId = `HU:mixed1989:${cycle}`;
  const journal = db.collection<Hu1991AssemblyRecord>(HU_1991_COUNTS_COLLECTION);
  const saved = await journal.findOne({ _id: receiptId }, { session });
  if (saved) return saved;
  const game = await db
    .collection<GameState>("gameState")
    .findOne({ _id: "current" }, { session, projection: { preset: 1 } });
  if (game?.preset !== "1991-default") return null;
  const elections = await db
    .collection<Election>("elections")
    .find(
      {
        countryId: "HU",
        electionType: "nationalAssembly",
        cycle,
        "hungarianAssemblyRound.round": 1,
      },
      {
        session,
        projection: { state: 1, status: 1, endTurn: 1, endTime: 1, hungarianAssemblyRound: 1 },
      }
    )
    .toArray();
  const regions = [...new Set(HU_1991_TERRITORIAL_DISTRICTS.map((row) => row.regionId))];
  if (
    elections.length !== 6 ||
    new Set(elections.map((row) => row.state)).size !== 6 ||
    elections.some(
      (row) =>
        !regions.includes(row.state) ||
        !["completed", "resolved"].includes(row.status) ||
        (row.endTurn != null ? row.endTurn > turn : !row.endTime || row.endTime > now)
    ) ||
    elections.every((row) => row.status === "resolved")
  )
    return null;
  if (
    elections.some(
      (row) =>
        row.hungarianAssemblyRound?.receiptId !== receiptId ||
        row.hungarianAssemblyRound?.ruleVersion !== "mixed-1989-v1" ||
        !Number.isSafeInteger(row.hungarianAssemblyRound?.registeredVoters) ||
        (row.hungarianAssemblyRound?.registeredVoters ?? 0) < 1
    )
  )
    throw new Error("Hungarian certification has a changed electorate or receipt");
  const ids = elections.map((row) => row._id);
  const tallies = await db
    .collection<ElectionVoteTally>("electionVoteTallies")
    .find(
      { electionId: { $in: ids } },
      {
        session,
        projection: TALLY_WITH_LATEST_SNAPSHOT_ONLY,
      }
    )
    .toArray();
  const candidates = await db
    .collection<ElectionCandidate>("electionCandidates")
    .find(
      { electionId: { $in: ids } },
      {
        session,
        projection: {
          electionId: 1,
          characterId: 1,
          nppId: 1,
          isNPP: 1,
          party: 1,
          characterName: 1,
          enteredAt: 1,
          hungarianAssemblyNomination: 1,
        },
      }
    )
    .toArray();
  const byTally = new Map(tallies.map((row) => [row.electionId.toHexString(), row]));
  if (byTally.size !== 6) return null;
  const byElection = new Map(elections.map((row) => [row._id.toHexString(), row]));
  const nominees = candidates.map((row) => {
    const ownerId = (row.isNPP ? row.nppId : row.characterId)?.toHexString();
    if (!ownerId) throw new Error("Hungarian candidate has no financial owner");
    return {
      id: row._id.toHexString(),
      ownerId,
      electionId: row.electionId.toHexString(),
      isNpc: !!row.isNPP,
      party: row.party,
      name: row.characterName,
      regionId: byElection.get(row.electionId.toHexString())!.state,
    };
  });
  const filed = buildHu1991Slates(
    candidates.map((row) => ({
      id: row._id.toHexString(),
      ownerId: (row.isNPP ? row.nppId! : row.characterId).toHexString(),
      partyId: row.party,
      regionId: byElection.get(row.electionId.toHexString())!.state,
      isNpc: !!row.isNPP,
      filingOrder: row.enteredAt.getTime(),
      constituencyId: row.hungarianAssemblyNomination?.constituencyId,
    }))
  );
  const campaigns = elections.map((election) => {
    const tally = byTally.get(election._id.toHexString())!;
    const legacy = election.status === "resolved";
    if (tally.finalized && !legacy)
      throw new Error("Hungarian first-round tally was finalized before chamber certification");
    const votes = Object.keys(tally.totalVotes ?? {}).length
      ? tally.totalVotes
      : (tally.turnSnapshots?.at(-1)?.cumulativeVotes ?? {});
    const local = nominees.filter((row) => row.electionId === election._id.toHexString());
    const known = new Set(local.map((row) => row.id));
    if (Object.keys(votes).some((id) => !known.has(id)))
      throw new Error("Hungarian first-round votes name an unfiled candidate");
    if (
      local.some((row) => (votes[row.id] ?? 0) > 0 && tally.candidateParties[row.id] !== row.party)
    )
      throw new Error("Hungarian first-round nominee changes their counted party");
    return {
      regionId: election.state,
      registeredVoters: election.hungarianAssemblyRound!.registeredVoters,
      candidates: local.map((row) => ({ candidateId: row.id, votes: votes[row.id] ?? 0 })),
    };
  });
  const first = projectHu1991CampaignBallots(campaigns, filed.nominations);
  const count = countHuMixed1991(first);
  const record: Hu1991AssemblyRecord = {
    _id: receiptId,
    countryId: "HU",
    cycle,
    ruleVersion: "mixed-1989-v1",
    electionIds: ids.map((id) => id.toHexString()),
    legacyResolvedElectionIds: elections
      .filter((row) => row.status === "resolved")
      .map((row) => row._id.toHexString()),
    nominations: filed.nominations,
    playerConstituencies: filed.playerConstituencies,
    first,
    firstCampaigns: campaigns,
    count,
    nominees,
    createdAt: now,
  };
  await journal.insertOne(record, { session });
  return record;
}

export async function certifyHu1991FirstCount(
  db: Db,
  cycle: number,
  turn: number,
  now: Date
): Promise<Hu1991AssemblyRecord | null> {
  return runRequiredTransaction((session) =>
    materializeHu1991FirstCount({ db, session, cycle, turn, now })
  );
}
