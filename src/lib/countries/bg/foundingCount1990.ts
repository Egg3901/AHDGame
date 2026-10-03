/**
 * Bulgaria certifies its whole mixed election before any regional office changes.
 * First-round votes and filed people freeze in one journal; subsequent readers
 * reuse that count instead of recalculating after withdrawals or partial seating.
 */
import { type ClientSession, type Db } from "mongodb";
import type { Election, ElectionCandidate, ElectionVoteTally, GameState } from "@/lib/db/types";
import { runRequiredTransaction } from "@/lib/db/runRequiredTransaction";
import { TALLY_WITH_LATEST_SNAPSHOT_ONLY } from "@/lib/electionEngine/tallyProjections";
import { buildBgFoundingSlates } from "./rules/foundingSlates1990";
import type { BgFoundingNominations } from "./rules/foundingMandates1990";
import { projectBgFoundingBallots } from "./rules/foundingBallots1990";
import { countBgFoundingElection, type BgFoundingCount } from "./rules/foundingCount1990";
import { BG_1990_LIST_DISTRICTS } from "./data/foundingDistricts1990";
import type { BgFoundingBallots } from "./rules/foundingBallots1990";

export const BG_FOUNDING_COUNTS_COLLECTION = "bgFoundingAssemblyCounts";
export interface BgFoundingAssemblyRecord {
  _id: string;
  countryId: "BG";
  cycle: number;
  ruleVersion: "parallel-1990-v1";
  electionIds: string[];
  legacyResolvedElectionIds: string[];
  nominations: BgFoundingNominations;
  playerConstituencies: Record<string, string>;
  first: BgFoundingBallots;
  firstCampaigns: import("./rules/foundingBallots1990").BgFoundingRegionalCampaign[];
  count: BgFoundingCount;
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
  activeRunoffElectionIds?: string[] | null;
  second?: BgFoundingBallots;
  seatedAtTurn?: number;
  seatedAt?: Date;
  officialIds?: import("mongodb").ObjectId[];
  settled?: ReturnType<typeof import("./rules/foundingMandates1990").settleBgFoundingMandates>;
}

export async function materializeBgFoundingFirstCount(input: {
  db: Db;
  session: ClientSession;
  cycle: number;
  turn: number;
  now: Date;
}): Promise<BgFoundingAssemblyRecord | null> {
  const { db, session, cycle, turn, now } = input;
  if (
    !session.inTransaction() ||
    !Number.isSafeInteger(cycle) ||
    cycle < 0 ||
    !Number.isSafeInteger(turn) ||
    turn < 0 ||
    !Number.isFinite(now.getTime())
  )
    throw new Error("Bulgarian certification needs an active transaction, cycle, turn and time");
  const receiptId = `BG:founding1990:${cycle}`;
  const journal = db.collection<BgFoundingAssemblyRecord>(BG_FOUNDING_COUNTS_COLLECTION);
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
        countryId: "BG",
        electionType: "nationalAssembly",
        cycle,
        "bulgarianFoundingRound.round": 1,
      },
      {
        session,
        projection: { state: 1, status: 1, endTurn: 1, endTime: 1, bulgarianFoundingRound: 1 },
      }
    )
    .toArray();
  const regions = [...new Set(BG_1990_LIST_DISTRICTS.map((row) => row.regionId))];
  if (
    elections.length !== 5 ||
    new Set(elections.map((row) => row.state)).size !== 5 ||
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
        row.bulgarianFoundingRound?.receiptId !== receiptId ||
        row.bulgarianFoundingRound?.ruleVersion !== "parallel-1990-v1" ||
        !Number.isSafeInteger(row.bulgarianFoundingRound?.registeredVoters) ||
        (row.bulgarianFoundingRound?.registeredVoters ?? 0) < 1
    )
  )
    throw new Error("Bulgarian certification has a changed electorate or receipt");
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
          bulgarianFoundingNomination: 1,
        },
      }
    )
    .toArray();
  const byTally = new Map(tallies.map((row) => [row.electionId.toHexString(), row]));
  if (byTally.size !== 5) return null;
  const byElection = new Map(elections.map((row) => [row._id.toHexString(), row]));
  const nominees = candidates.map((row) => {
    const ownerId = (row.isNPP ? row.nppId : row.characterId)?.toHexString();
    if (!ownerId) throw new Error("Bulgarian candidate has no financial owner");
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
  const filed = buildBgFoundingSlates(
    candidates.map((row) => ({
      id: row._id.toHexString(),
      ownerId: (row.isNPP ? row.nppId! : row.characterId).toHexString(),
      partyId: row.party,
      regionId: byElection.get(row.electionId.toHexString())!.state,
      isNpc: !!row.isNPP,
      listOrder: row.enteredAt.getTime(),
      constituencyId: row.bulgarianFoundingNomination?.constituencyId,
      listDistrictId: row.bulgarianFoundingNomination?.listDistrictId,
    }))
  );
  const campaigns = elections.map((election) => {
    const tally = byTally.get(election._id.toHexString())!;
    const legacy = election.status === "resolved";
    if (tally.finalized && !legacy)
      throw new Error("Bulgarian first-round tally was finalized before chamber certification");
    const votes = Object.keys(tally.totalVotes ?? {}).length
      ? tally.totalVotes
      : (tally.turnSnapshots?.at(-1)?.cumulativeVotes ?? {});
    const local = nominees.filter((row) => row.electionId === election._id.toHexString());
    const known = new Set(local.map((row) => row.id));
    if (Object.keys(votes).some((id) => !known.has(id)))
      throw new Error("Bulgarian first-round votes name an unfiled candidate");
    if (
      local.some((row) => (votes[row.id] ?? 0) > 0 && tally.candidateParties[row.id] !== row.party)
    )
      throw new Error("Bulgarian first-round nominee changes their counted party");
    return {
      regionId: election.state,
      registeredVoters: election.bulgarianFoundingRound!.registeredVoters,
      candidates: local.map((row) => ({ candidateId: row.id, votes: votes[row.id] ?? 0 })),
    };
  });
  const first = projectBgFoundingBallots(campaigns, filed.nominations);
  const count = countBgFoundingElection(first);
  const record: BgFoundingAssemblyRecord = {
    _id: receiptId,
    countryId: "BG",
    cycle,
    ruleVersion: "parallel-1990-v1",
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

export async function certifyBgFoundingFirstCount(
  db: Db,
  cycle: number,
  turn: number,
  now: Date
): Promise<BgFoundingAssemblyRecord | null> {
  return runRequiredTransaction((session) =>
    materializeBgFoundingFirstCount({ db, session, cycle, turn, now })
  );
}
