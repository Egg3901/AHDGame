/**
 * Real-mongod concurrency proof for committee-proposal voting.
 *
 * Opt-in only: runs when `AHD_TEST_REAL_MONGO=1`. Boots the shared isolated
 * mongod fixture and races `castVote` calls over SEPARATE MongoClients — a
 * single connection serializes its operations and hides the interleaving
 * that real parallel HTTP requests produce.
 *
 * Two invariants under test, both broken by the audited implementation:
 *
 *   1. One vote entry per voter. The old $pull-then-$push pair let N
 *      concurrent same-voter requests append N entries; resolution counts
 *      raw array entries, so a lone committee member crossed the 60%
 *      threshold alone.
 *   2. One resolution. Concurrent deciding votes each computed "passed"
 *      against the same open doc and each ran the effects — a merge's
 *      treasury $inc ran once per resolver. The atomic claim in
 *      attemptResolution admits exactly one.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MongoClient, ObjectId, type Db } from "mongodb";
import {
  REAL_MONGO_ENABLED,
  startIsolatedMongod,
  stopIsolatedMongod,
  type IsolatedMongod,
} from "@/lib/test-utils/realMongoFixture";
import { castVote } from "./proposals";
import type { CommitteeProposal } from "@/lib/db/types/committeeProposal";

const ENABLED = REAL_MONGO_ENABLED;
const RACE_SIZE = 24;
const CURRENT_TURN = 100;

function committeeIds(): ObjectId[] {
  return Array.from({ length: 6 }, () => new ObjectId());
}

function seedParty(partyId: ObjectId, sequentialId: number, extra: Record<string, unknown> = {}) {
  return {
    _id: partyId,
    sequentialId,
    countryId: "US",
    name: `Party ${sequentialId}`,
    committeeIds: committeeIds(),
    chairId: new ObjectId(),
    viceChairId: new ObjectId(),
    treasurerId: new ObjectId(),
    treasury: 0,
    memberCount: 0,
    ...extra,
  };
}

/** Five pre-seeded yes votes from distinct eligible voters (of a 9-voter set). */
function fiveYes(): { voterId: ObjectId; vote: "yes"; votedAt: Date }[] {
  return Array.from({ length: 5 }, () => ({
    voterId: new ObjectId(),
    vote: "yes" as const,
    votedAt: new Date(),
  }));
}

describe.runIf(ENABLED)("committee-proposal vote race against isolated mongod", () => {
  let fixture: IsolatedMongod | null = null;
  let db: Db;

  beforeAll(async () => {
    fixture = await startIsolatedMongod("ahd-vote-race-");
    db = fixture.db;
  }, 120_000);

  afterAll(async () => {
    await stopIsolatedMongod(fixture);
    fixture = null;
  }, 120_000);

  async function raceCastVotes(
    proposalId: ObjectId,
    voters: { voterId: ObjectId; side: "proposing" | "target" }[],
    each = 1
  ): Promise<void> {
    // One client per request — the driver's per-connection ordering otherwise
    // serializes the writes and the race never materializes.
    const clients = await Promise.all(
      voters.flatMap((v) =>
        Array.from({ length: each }, async () => {
          const client = new MongoClient(fixture!.uri);
          await client.connect();
          return { client, voter: v };
        })
      )
    );
    try {
      await Promise.all(
        clients.map(({ client, voter }) =>
          castVote(
            client.db(fixture!.dbName),
            proposalId,
            voter.voterId,
            "yes",
            voter.side,
            CURRENT_TURN
          )
        )
      );
    } finally {
      await Promise.all(clients.map(({ client }) => client.close().catch(() => {})));
    }
  }

  it("keeps exactly one entry for a voter under a burst of concurrent votes", async () => {
    const partyId = new ObjectId();
    const proposalId = new ObjectId();
    const decidingVoter = new ObjectId();

    await db.collection("politicalParties").insertOne({
      ...seedParty(partyId, 5),
      committeeIds: [...committeeIds(), decidingVoter],
    });
    await db.collection<CommitteeProposal>("committeeProposals").insertOne({
      _id: proposalId,
      type: "rename",
      status: "open",
      partyId,
      countryId: "US",
      proposedBy: decidingVoter,
      createdAtTurn: CURRENT_TURN,
      expiresAtTurn: CURRENT_TURN + 24,
      proposingVotes: fiveYes(),
      rename: { newName: "Renamed Party", newAbbreviation: "RNP" },
      createdAt: new Date(),
      updatedAt: new Date(),
    } as CommitteeProposal);

    // 5 yes + 1 deciding voter firing RACE_SIZE concurrent votes. Pre-fix this
    // produced up to RACE_SIZE duplicate entries; the tally is counted on raw
    // array length, so one member passed the proposal alone.
    await raceCastVotes(proposalId, [{ voterId: decidingVoter, side: "proposing" }], RACE_SIZE);

    const final = await db
      .collection<CommitteeProposal>("committeeProposals")
      .findOne({ _id: proposalId });
    const ownEntries = (final?.proposingVotes ?? []).filter(
      (v) => v.voterId.toString() === decidingVoter.toString()
    );
    expect(ownEntries).toHaveLength(1);
    // 5 seeded + 1 deciding = 6 of 9 → passed exactly once.
    expect(final?.status).toBe("passed");

    const party = await db.collection("politicalParties").findOne({ _id: partyId });
    expect(party?.name).toBe("Renamed Party");
  });

  it("applies a merge's effects exactly once under concurrent deciding votes", async () => {
    const proposingPartyId = new ObjectId();
    const targetPartyId = new ObjectId();
    const proposalId = new ObjectId();
    const proposingDecider = new ObjectId();
    const targetDecider = new ObjectId();

    await db.collection("politicalParties").insertMany([
      {
        ...seedParty(proposingPartyId, 11, { treasury: 500 }),
        committeeIds: [...committeeIds(), proposingDecider],
      },
      {
        ...seedParty(targetPartyId, 22, { treasury: 1000 }),
        committeeIds: [...committeeIds(), targetDecider],
      },
    ]);
    await db.collection<CommitteeProposal>("committeeProposals").insertOne({
      _id: proposalId,
      type: "merge",
      status: "open",
      partyId: proposingPartyId,
      countryId: "US",
      proposedBy: proposingDecider,
      createdAtTurn: CURRENT_TURN,
      expiresAtTurn: CURRENT_TURN + 24,
      proposingVotes: fiveYes(),
      targetVotes: fiveYes(),
      merge: { targetPartyId },
      createdAt: new Date(),
      updatedAt: new Date(),
    } as CommitteeProposal);

    // The deciding vote lands on BOTH sides at once: every request computes
    // "passed" against the same open doc. Without an atomic claim each
    // resolver ran processMergeProposal and each $inc'd the treasury.
    await raceCastVotes(
      proposalId,
      [
        { voterId: proposingDecider, side: "proposing" },
        { voterId: targetDecider, side: "target" },
      ],
      RACE_SIZE
    );

    const proposal = await db
      .collection<CommitteeProposal>("committeeProposals")
      .findOne({ _id: proposalId });
    expect(proposal?.status).toBe("passed");
    expect(
      proposal?.proposingVotes.filter((v) => v.voterId.toString() === proposingDecider.toString())
    ).toHaveLength(1);
    expect(
      proposal?.targetVotes?.filter((v) => v.voterId.toString() === targetDecider.toString())
    ).toHaveLength(1);

    // Exactly one merge: target treasury = 1000 + 500, never 1000 + k*500.
    const target = await db.collection("politicalParties").findOne({ _id: targetPartyId });
    expect(target?.treasury).toBe(1500);
  });
});
