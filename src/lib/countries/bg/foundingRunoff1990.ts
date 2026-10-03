/**
 * Bulgarian second rounds are new campaigns for unresolved constituencies.
 * First-round list votes remain immutable, existing campaign funds
 * move with their owner, and deputies wait for one completed national count.
 */
import { createHash } from "node:crypto";
import { ObjectId, type ClientSession, type Db } from "mongodb";
import type { Election, ElectionCandidate, ElectionVoteTally } from "@/lib/db/types";
import { runRequiredTransaction } from "@/lib/db/runRequiredTransaction";
import { MS_PER_TURN } from "@/lib/constants/turnTime";
import { TALLY_WITH_LATEST_SNAPSHOT_ONLY } from "@/lib/electionEngine/tallyProjections";
import { BG_FOUNDING_COUNTS_COLLECTION, type BgFoundingAssemblyRecord } from "./foundingCount1990";
import { bgFoundingRunoffCampaigns } from "./rules/foundingRunoff1990";
import { projectBgFoundingRunoff } from "./rules/foundingBallots1990";
import { countBgFoundingElection } from "./rules/foundingCount1990";
import { bgFoundingOpenNominationDistricts } from "./rules/foundingRenewal1990";
import { planBgFoundingRenewedNpcSlates } from "./foundingRenewedNpcSlates1990";

function stableId(key: string): ObjectId {
  return new ObjectId(createHash("sha256").update(key).digest("hex").slice(0, 24));
}
export async function materializeBgFoundingRunoffOpening(input: {
  db: Db;
  session: ClientSession;
  cycle: number;
  turn: number;
  now: Date;
}): Promise<string[]> {
  const { db, session, cycle, turn, now } = input;
  if (
    !session.inTransaction() ||
    !Number.isSafeInteger(cycle) ||
    cycle < 0 ||
    !Number.isSafeInteger(turn) ||
    turn < 0 ||
    !Number.isFinite(now.getTime())
  )
    throw new Error("Bulgarian runoff opening needs an active transaction, cycle, turn and time");
  const journal = db.collection<BgFoundingAssemblyRecord>(BG_FOUNDING_COUNTS_COLLECTION);
  let receipt = await journal.findOne({ _id: `BG:founding1990:${cycle}` }, { session });
  if (!receipt || receipt.seatedAtTurn != null || receipt.count.kind !== "pending") return [];
  const activeIds =
    receipt.activeRunoffElectionIds ?? (!receipt.second ? receipt.runoffElectionIds : undefined);
  if (activeIds?.length) return activeIds;
  const generation = (receipt.runoffGeneration ?? (receipt.runoffElectionIds ? 1 : 0)) + 1;
  const namespace = generation === 1 ? receipt._id : `${receipt._id}:generation:${generation}`;
  const newSlates = await planBgFoundingRenewedNpcSlates({ db, session, receipt, namespace, now });
  receipt = newSlates.receipt;
  const planned = bgFoundingRunoffCampaigns(
    receipt.count,
    receipt.nominations,
    receipt.second ?? receipt.first
  );
  const allowed = new Set(planned.flatMap((row) => row.candidateIds));
  const roots = await db
    .collection<Election>("elections")
    .find(
      {
        _id: { $in: receipt.electionIds.map((id) => new ObjectId(id)) },
        status: { $in: ["completed", "resolved"] },
      },
      { session }
    )
    .toArray();
  if (
    roots.length !== 5 ||
    roots.some((row) => row.bulgarianFoundingRound?.receiptId !== receipt._id)
  )
    throw new Error("Bulgarian first-round custody changed");
  const retainedCandidates = await db
    .collection<ElectionCandidate>("electionCandidates")
    .find(
      {
        status: "active",
        $or: [
          { _id: { $in: [...allowed].map((id) => new ObjectId(id)) } },
          {
            electionId: { $in: (receipt.runoffElectionIds ?? []).map((id) => new ObjectId(id)) },
            "bulgarianFoundingNomination.rootCandidateId": { $in: [...allowed] },
          },
        ],
      },
      { session }
    )
    .toArray();
  const newCandidateIds = new Set(newSlates.candidates.map((row) => row._id.toHexString()));
  const candidates = [...retainedCandidates, ...newSlates.candidates];
  const polls: Election[] = [];
  const renewedCandidates: ElectionCandidate[] = [];
  for (const { regionId } of planned) {
    const root = roots.find((row) => row.state === regionId)!;
    const newNominationDistrictIds = bgFoundingOpenNominationDistricts(
      receipt.count,
      receipt.first,
      regionId
    );
    const filingTurns = newNominationDistrictIds.length ? 1 : 0;
    const electionId = stableId(`${namespace}:runoff:${regionId}`);
    polls.push({
      ...root,
      _id: electionId,
      status: "active",
      resolving: false,
      startTurn: turn,
      primaryEndTurn: turn + filingTurns,
      endTurn: turn + 2,
      durationHours: 2,
      primaryDurationHours: filingTurns,
      startTime: now,
      primaryEndTime: new Date(now.getTime() + filingTurns * MS_PER_TURN),
      endTime: new Date(now.getTime() + 2 * MS_PER_TURN),
      createdAt: now,
      updatedAt: now,
      bulgarianFoundingRound: {
        ...root.bulgarianFoundingRound!,
        round: 2,
        rootElectionId: root._id.toHexString(),
        newNominationDistrictIds,
      },
    });
    for (const candidate of candidates.filter((row) =>
      receipt.nominees.some(
        (nominee) =>
          nominee.regionId === regionId &&
          nominee.id === (row.bulgarianFoundingNomination?.rootCandidateId ?? row._id.toHexString())
      )
    ))
      renewedCandidates.push({
        ...candidate,
        _id: newCandidateIds.has(candidate._id.toHexString())
          ? candidate._id
          : stableId(
              `${namespace}:runoff-candidate:${candidate.bulgarianFoundingNomination?.rootCandidateId ?? candidate._id.toHexString()}`
            ),
        electionId,
        enteredAt: now,
        bulgarianFoundingNomination: {
          ...candidate.bulgarianFoundingNomination,
          rootCandidateId:
            candidate.bulgarianFoundingNomination?.rootCandidateId ?? candidate._id.toHexString(),
        },
      });
  }
  if (polls.length === 0) throw new Error("Bulgarian pending count has no unresolved poll");
  const ids = polls.map((row) => row._id.toHexString());
  const updated = await journal.updateOne(
    {
      _id: receipt._id,
      runoffGeneration: receipt.runoffGeneration ?? { $exists: false },
      "count.kind": "pending",
      seatedAtTurn: { $exists: false },
    },
    {
      $set: {
        runoffElectionIds: [...(receipt.runoffElectionIds ?? []), ...ids],
        activeRunoffElectionIds: ids,
        runoffGeneration: generation,
        runoffOpenedAtTurn: turn,
        nominations: receipt.nominations,
        nominees: receipt.nominees,
      },
    },
    { session }
  );
  if (updated.modifiedCount !== 1) throw new Error("Bulgarian runoff opening changed concurrently");
  await db.collection<Election>("elections").insertMany(polls, { session });
  if (renewedCandidates.length) {
    await db
      .collection<ElectionCandidate>("electionCandidates")
      .insertMany(renewedCandidates, { session });
    await db.collection<ElectionCandidate>("electionCandidates").updateMany(
      { _id: { $in: retainedCandidates.map((row) => row._id) }, status: "active" },
      {
        $set: { status: "withdrawn", withdrawnAt: now },
      },
      { session }
    );
    // Campaign balances are carried on their existing rows. No new financial
    // account or second copy of the unspent campaign funds is created.
    await db.collection("campaigns").bulkWrite(
      renewedCandidates.map((row) => ({
        updateMany: {
          filter: {
            electionId: candidates.find(
              (candidate) =>
                (candidate.bulgarianFoundingNomination?.rootCandidateId ??
                  candidate._id.toHexString()) === row.bulgarianFoundingNomination!.rootCandidateId
            )!.electionId,
            candidateId: row.isNPP ? row.nppId! : row.characterId,
            status: { $ne: "archived" },
          },
          update: { $set: { electionId: row.electionId, updatedAt: now } },
        },
      })),
      { session }
    );
  }
  await db.collection<ElectionVoteTally>("electionVoteTallies").insertMany(
    polls.map((election) => ({
      _id: stableId(`${namespace}:runoff-tally:${election.state}`),
      electionId: election._id,
      state: election.state,
      totalVotes: {},
      candidateNames: {},
      candidateParties: {},
      turnSnapshots: [],
      finalized: false,
      bulgarianFoundingBallot: true,
      createdAt: now,
      updatedAt: now,
    })),
    { session }
  );
  return ids;
}

export async function materializeBgFoundingRunoffCount(input: {
  db: Db;
  session: ClientSession;
  cycle: number;
  turn: number;
  now: Date;
}): Promise<boolean> {
  const { db, session, cycle, turn, now } = input;
  if (
    !session.inTransaction() ||
    !Number.isSafeInteger(cycle) ||
    cycle < 0 ||
    !Number.isSafeInteger(turn) ||
    turn < 0 ||
    !Number.isFinite(now.getTime())
  )
    throw new Error(
      "Bulgarian runoff certification needs an active transaction, cycle, turn and time"
    );
  const journal = db.collection<BgFoundingAssemblyRecord>(BG_FOUNDING_COUNTS_COLLECTION);
  const receipt = await journal.findOne({ _id: `BG:founding1990:${cycle}` }, { session });
  if (
    !receipt ||
    receipt.seatedAtTurn != null ||
    receipt.count.kind !== "pending" ||
    !receipt.runoffElectionIds
  )
    return false;
  const activeIds =
    receipt.activeRunoffElectionIds ?? (!receipt.second ? receipt.runoffElectionIds : undefined);
  if (!activeIds?.length) return false;
  const namespace =
    (receipt.runoffGeneration ?? 1) === 1
      ? receipt._id
      : `${receipt._id}:generation:${receipt.runoffGeneration}`;
  const ids = activeIds.map((id) => new ObjectId(id));
  const elections = await db
    .collection<Election>("elections")
    .find(
      { _id: { $in: ids } },
      { session, projection: { state: 1, status: 1, endTurn: 1, bulgarianFoundingRound: 1 } }
    )
    .toArray();
  if (
    elections.length !== ids.length ||
    elections.some((row) => row.status !== "completed" || row.endTurn == null || row.endTurn > turn)
  )
    return false;
  if (
    elections.some(
      (row) =>
        row.bulgarianFoundingRound?.receiptId !== receipt._id ||
        row.bulgarianFoundingRound?.round !== 2
    )
  )
    throw new Error("Bulgarian renewed cohort binding changed");
  const tallies = await db
    .collection<ElectionVoteTally>("electionVoteTallies")
    .find({ electionId: { $in: ids } }, { session, projection: TALLY_WITH_LATEST_SNAPSHOT_ONLY })
    .toArray();
  const candidates = await db
    .collection<ElectionCandidate>("electionCandidates")
    .find(
      { electionId: { $in: ids } },
      {
        session,
        projection: {
          electionId: 1,
          bulgarianFoundingNomination: 1,
          party: 1,
          nppId: 1,
          characterId: 1,
          isNPP: 1,
        },
      }
    )
    .toArray();
  const byTally = new Map(tallies.map((row) => [row.electionId.toHexString(), row]));
  if (byTally.size !== ids.length) return false;
  const allowed = new Map(
    bgFoundingRunoffCampaigns(
      receipt.count,
      receipt.nominations,
      receipt.second ?? receipt.first
    ).map((row) => [row.regionId, new Set(row.candidateIds)])
  );
  const renewed = receipt.firstCampaigns.map((campaign) => {
    const election = elections.find((row) => row.state === campaign.regionId);
    if (!election) return campaign;
    const tally = byTally.get(election._id.toHexString())!;
    if (tally.finalized) throw new Error("Bulgarian renewed tally finalized before handover");
    const votes = Object.keys(tally.totalVotes ?? {}).length
      ? tally.totalVotes
      : (tally.turnSnapshots?.at(-1)?.cumulativeVotes ?? {});
    const local = candidates.filter((row) => row.electionId.equals(election._id));
    if (Object.keys(votes).some((id) => !local.some((row) => row._id.toHexString() === id)))
      throw new Error("Bulgarian second-round votes name an unfiled person");
    return {
      ...campaign,
      candidates: local.map((row) => {
        const rootId = row.bulgarianFoundingNomination?.rootCandidateId;
        const nominee = receipt.nominees.find((candidate) => candidate.id === rootId);
        if (
          !rootId ||
          !nominee ||
          nominee.party !== row.party ||
          nominee.regionId !== election.state ||
          !allowed.get(election.state)?.has(rootId) ||
          nominee.isNpc !== !!row.isNPP ||
          !(row.isNPP ? row.nppId : row.characterId)?.equals(new ObjectId(nominee.ownerId)) ||
          (!row._id.equals(stableId(`${namespace}:runoff-candidate:${rootId}`)) &&
            !(
              row._id.toHexString() === rootId && nominee.electionId === election._id.toHexString()
            )) ||
          ((votes[row._id.toHexString()] ?? 0) > 0 &&
            tally.candidateParties[row._id.toHexString()] !== row.party)
        )
          throw new Error("Bulgarian second-round person or party changed");
        return { candidateId: rootId, votes: votes[row._id.toHexString()] ?? 0 };
      }),
    };
  });
  const second = projectBgFoundingRunoff(
    renewed,
    receipt.nominations,
    receipt.second ?? receipt.first
  );
  const count = countBgFoundingElection(second);
  const updated = await journal.updateOne(
    { _id: receipt._id, seatedAtTurn: { $exists: false }, "count.kind": "pending" },
    {
      $set: { second, count, activeRunoffElectionIds: null },
    },
    { session }
  );
  if (updated.modifiedCount !== 1)
    throw new Error("Bulgarian runoff certification changed concurrently");
  return true;
}
export async function openBgFoundingRunoff(
  db: Db,
  cycle: number,
  turn: number,
  now: Date
): Promise<string[]> {
  return runRequiredTransaction((session) =>
    materializeBgFoundingRunoffOpening({ db, session, cycle, turn, now })
  );
}
export async function certifyBgFoundingRunoff(
  db: Db,
  cycle: number,
  turn: number,
  now: Date
): Promise<boolean> {
  return runRequiredTransaction((session) =>
    materializeBgFoundingRunoffCount({ db, session, cycle, turn, now })
  );
}
