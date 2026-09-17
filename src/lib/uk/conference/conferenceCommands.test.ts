import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import {
  applyConferencePayoff,
  CONFERENCE_RACE_VOID_CONFIRMED,
  CONFERENCE_RACE_VOID_REASON,
  conferencePayoffNeedsSettle,
  conferenceResolutionNeedsHeal,
  ensureNppPlatformProposal,
  getConferenceState,
  getStandingPlatformsForCountry,
  postConferenceNews,
  proposePlatform,
  proposeRulesMotion,
  resolveConference,
  scheduleConference,
  voteOnMotion,
  voteOnPlatform,
  type ConferenceActor,
} from "./conferenceCommands";
import { conferenceDocId, getConference } from "./conferenceStore";
import {
  CONFERENCE_APPROVAL_DELTA,
  CONFERENCE_COHESION_PS,
  CONFERENCE_PAYOFF_DURATION_TURNS,
  conferenceOpensAtTurn,
  conferenceVotingClosesTurn,
  conferenceYearForTurn,
  payoffGroupsForPledges,
} from "./rules";
import { createFakeLeadershipDb, withCollectionFaults } from "../leadership/leadershipTestDb";
import { LEADERSHIP_AMENDMENT_COOLDOWN_TURNS } from "../leadership/rules";
import { getOrSeedPartyLeadership } from "../leadership/leadershipStore";
import {
  buildEmbeddedVoteTallyUpdate,
  buildMotionVoteTallyUpdate,
} from "@/lib/votes/embeddedVoteTally";
import {
  getUKPartyConferencesCollection,
  getUKPartyPlatformsCollection,
} from "@/lib/db/collections/ukPartyConferences";
import { getUKPartyLeadershipCollection } from "@/lib/db/collections/ukPartyLeadership";
import { pledgeCatalogFor } from "../manifesto/pledgeCatalog";
import { ApiError } from "@/lib/api/errors";
import type { PoliticalParty } from "@/lib/db/types";

vi.mock("@/lib/notifications", () => ({ createNotification: vi.fn(async () => undefined) }));
vi.mock("@/lib/news", () => ({ createSystemNewsPost: vi.fn(async () => undefined) }));

const NOW = () => new Date("2026-09-17T00:00:00Z");
const TURN_YEAR1_OPEN = conferenceOpensAtTurn(1);

function validPledgeIds(): string[] {
  return pledgeCatalogFor("UK")
    .slice(0, 3)
    .map((e) => e.id);
}

function altPledgeIds(): string[] {
  return pledgeCatalogFor("UK")
    .slice(3, 6)
    .map((e) => e.id);
}

interface SeedMember {
  id: ObjectId;
  name: string;
  actor: ConferenceActor;
}

interface SeedWorld {
  db: Db;
  party: PoliticalParty;
  partySeq: string;
  leader: SeedMember;
  committee: SeedMember[];
  members: SeedMember[];
  outsider: ConferenceActor;
}

async function seedWorld(
  opts: { seq?: number; name?: string; chairless?: boolean; memberCount?: number } = {}
): Promise<SeedWorld> {
  const seq = opts.seq ?? 2;
  const partySeq = String(seq);
  const memberCount = opts.memberCount ?? 4;
  const db = createFakeLeadershipDb();

  const mkChar = async (charName: string, party?: string): Promise<SeedMember> => {
    const id = new ObjectId();
    await db.collection("characters").insertOne({
      _id: id,
      name: charName,
      ...(party ? { party } : {}),
      userId: new ObjectId(),
    });
    return { id, name: charName, actor: { _id: id, name: charName, party } };
  };

  const leader = await mkChar("Leader Lex", partySeq);
  const committee: SeedMember[] = [];
  for (let i = 0; i < 3; i++) committee.push(await mkChar(`Committee ${i}`, partySeq));
  const members: SeedMember[] = [];
  for (let i = 0; i < memberCount; i++) members.push(await mkChar(`Member ${i}`, partySeq));
  const outsiderChar = await mkChar("Outsider Ollie", "99");

  const party = {
    _id: new ObjectId(),
    sequentialId: seq,
    countryId: "UK",
    name: opts.name ?? "Conservative Party",
    abbreviation: "CON",
    color: "#0087DC",
    economicPosition: 2,
    socialPosition: 2,
    chairId: opts.chairless ? null : leader.id,
    viceChairId: null,
    treasurerId: null,
    committeeIds: committee.map((m) => m.id),
    memberCount: memberCount + 4,
    isDefault: true,
    politicalStrength: 0,
    createdAt: NOW(),
    updatedAt: NOW(),
  } as unknown as PoliticalParty;
  await db.collection("politicalParties").insertOne({ ...party });

  return {
    db,
    party,
    partySeq,
    leader,
    committee,
    members,
    outsider: outsiderChar.actor,
  };
}

/** Seed a scheduled row, then flip it open so agenda commands can run. */
async function seedOpenConference(world: SeedWorld, turn: number) {
  const { db, partySeq } = world;
  // Chairless (NPP) parties schedule through the committee instead.
  // Schedule early in the year so the seeded opening matches the canonical
  // conferenceOpensAtTurn(year); the row is then flipped open for agenda tests.
  const scheduler = world.party.chairId ? world.leader.actor : world.committee[0].actor;
  await scheduleConference(db, "UK", partySeq, scheduler, 2, NOW());
  const year = conferenceYearForTurn(turn);
  await getUKPartyConferencesCollection(db).updateOne(
    { _id: conferenceDocId("UK", partySeq, year) },
    { $set: { status: "open", openedAtTurn: turn } }
  );
  return year;
}

async function expectApiError(promise: Promise<unknown>, status: number) {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(status);
    return;
  }
  throw new Error(`expected ApiError ${status}, but the call succeeded`);
}

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.UK_CONFERENCE_PAYOFF;
});

describe("scheduleConference", () => {
  it("seeds this year's row and returns it", async () => {
    const world = await seedWorld();
    const result = await scheduleConference(
      world.db,
      "UK",
      world.partySeq,
      world.leader.actor,
      2,
      NOW()
    );
    expect(result.success).toBe(true);
    expect(result.conferenceId).toBe(conferenceDocId("UK", world.partySeq, 1));
    expect(result.status).toBe("scheduled");
  });

  it("is idempotent: re-scheduling returns the same row", async () => {
    const world = await seedWorld();
    const first = await scheduleConference(
      world.db,
      "UK",
      world.partySeq,
      world.leader.actor,
      2,
      NOW()
    );
    const second = await scheduleConference(
      world.db,
      "UK",
      world.partySeq,
      world.leader.actor,
      3,
      NOW()
    );
    expect(second.conferenceId).toBe(first.conferenceId);
    const rows = await getUKPartyConferencesCollection(world.db)
      .find({ _id: first.conferenceId })
      .toArray();
    expect(rows).toHaveLength(1);
  });

  it("lets a committee member schedule, but rejects plain members and outsiders", async () => {
    const world = await seedWorld();
    const byCommittee = await scheduleConference(
      world.db,
      "UK",
      world.partySeq,
      world.committee[0].actor,
      2,
      NOW()
    );
    expect(byCommittee.success).toBe(true);
    await expectApiError(
      scheduleConference(world.db, "UK", world.partySeq, world.members[0].actor, 2, NOW()),
      403
    );
    await expectApiError(
      scheduleConference(world.db, "UK", world.partySeq, world.outsider, 2, NOW()),
      403
    );
  });

  it("404s on an unknown party", async () => {
    const world = await seedWorld();
    await expectApiError(
      scheduleConference(world.db, "UK", "999", world.leader.actor, 2, NOW()),
      404
    );
  });

  it("schedules on the last turn whose window still fits inside the year", async () => {
    // Year 1 runs turns 1-48 with an 18-turn window: scheduling on turn 29
    // opens on turn 30 and closes exactly on turn 48.
    const world = await seedWorld();
    const result = await scheduleConference(
      world.db,
      "UK",
      world.partySeq,
      world.leader.actor,
      29,
      NOW()
    );
    expect(result.success).toBe(true);
    const doc = await getConference(world.db, "UK", world.partySeq, 1);
    expect(doc?.opensAtTurn).toBe(30);
    expect(doc?.votingClosesTurn).toBe(48);
  });

  it("400s when a new row's voting window would spill past the year's end", async () => {
    // Turn 30 opens on turn 31 and would close on turn 49, after year 1
    // ends: the row could never resolve, so scheduling is refused and no
    // row is seeded.
    const world = await seedWorld();
    await expectApiError(
      scheduleConference(world.db, "UK", world.partySeq, world.leader.actor, 30, NOW()),
      400
    );
    expect(await getConference(world.db, "UK", world.partySeq, 1)).toBeNull();
  });

  it("still returns the existing row late in the year instead of 400ing", async () => {
    const world = await seedWorld();
    const first = await scheduleConference(
      world.db,
      "UK",
      world.partySeq,
      world.leader.actor,
      2,
      NOW()
    );
    const second = await scheduleConference(
      world.db,
      "UK",
      world.partySeq,
      world.leader.actor,
      40,
      NOW()
    );
    expect(second.conferenceId).toBe(first.conferenceId);
  });
});

describe("proposePlatform", () => {
  it("lets the leader propose a manifesto-shaped platform while open", async () => {
    const world = await seedWorld();
    await seedOpenConference(world, TURN_YEAR1_OPEN);
    const ids = validPledgeIds();
    const result = await proposePlatform(
      world.db,
      "UK",
      world.partySeq,
      world.leader.actor,
      ids,
      TURN_YEAR1_OPEN,
      NOW()
    );
    expect(result.success).toBe(true);
    const doc = await getConference(world.db, "UK", world.partySeq, 1);
    expect(doc?.proposal?.pledgeIds).toEqual(ids);
    expect(doc?.proposal?.status).toBe("voting");
  });

  it("lets a committee member propose, and replacing resets the vote", async () => {
    const world = await seedWorld();
    await seedOpenConference(world, TURN_YEAR1_OPEN);
    await proposePlatform(
      world.db,
      "UK",
      world.partySeq,
      world.committee[0].actor,
      validPledgeIds(),
      TURN_YEAR1_OPEN,
      NOW()
    );
    await voteOnPlatform(
      world.db,
      "UK",
      world.partySeq,
      world.members[0].actor,
      "aye",
      TURN_YEAR1_OPEN,
      NOW()
    );
    await proposePlatform(
      world.db,
      "UK",
      world.partySeq,
      world.leader.actor,
      altPledgeIds(),
      TURN_YEAR1_OPEN,
      NOW()
    );
    const doc = await getConference(world.db, "UK", world.partySeq, 1);
    expect(doc?.proposal?.pledgeIds).toEqual(altPledgeIds());
    expect(doc?.proposal?.votesFor).toBe(0);
    expect(doc?.proposal?.votesAgainst).toBe(0);
    expect(doc?.proposal?.votes).toEqual({});
  });

  it("rejects bad shapes: wrong count, dupes, unknown ids", async () => {
    const world = await seedWorld();
    await seedOpenConference(world, TURN_YEAR1_OPEN);
    const ids = validPledgeIds();
    await expectApiError(
      proposePlatform(
        world.db,
        "UK",
        world.partySeq,
        world.leader.actor,
        ids.slice(0, 2),
        TURN_YEAR1_OPEN,
        NOW()
      ),
      400
    );
    await expectApiError(
      proposePlatform(
        world.db,
        "UK",
        world.partySeq,
        world.leader.actor,
        [ids[0], ids[0], ids[1]],
        TURN_YEAR1_OPEN,
        NOW()
      ),
      400
    );
    await expectApiError(
      proposePlatform(
        world.db,
        "UK",
        world.partySeq,
        world.leader.actor,
        [ids[0], ids[1], "no-such-pledge"],
        TURN_YEAR1_OPEN,
        NOW()
      ),
      400
    );
  });

  it("rejects proposals when the conference is not open, and from non-leaders", async () => {
    const world = await seedWorld();
    await scheduleConference(world.db, "UK", world.partySeq, world.leader.actor, 2, NOW());
    await expectApiError(
      proposePlatform(
        world.db,
        "UK",
        world.partySeq,
        world.leader.actor,
        validPledgeIds(),
        2,
        NOW()
      ),
      400
    );
    await seedOpenConference(world, TURN_YEAR1_OPEN);
    await expectApiError(
      proposePlatform(
        world.db,
        "UK",
        world.partySeq,
        world.members[0].actor,
        validPledgeIds(),
        TURN_YEAR1_OPEN,
        NOW()
      ),
      403
    );
    await expectApiError(
      proposePlatform(
        world.db,
        "UK",
        world.partySeq,
        world.outsider,
        validPledgeIds(),
        TURN_YEAR1_OPEN,
        NOW()
      ),
      403
    );
  });
});

describe("voteOnPlatform and the embedded tally update", () => {
  it("emits a dotted-path pipeline update (never a nested proposal overwrite)", () => {
    const update = buildEmbeddedVoteTallyUpdate<"aye" | "nay">({
      voteField: "proposal.votes",
      voteKey: new ObjectId().toString(),
      vote: "aye" as const,
      tallyFieldByVote: { aye: "proposal.votesFor", nay: "proposal.votesAgainst" },
      updatedAt: NOW(),
    });
    expect(Array.isArray(update)).toBe(true);
    const set = (update as Array<{ $set: Record<string, unknown> }>)[0].$set;
    expect(Object.keys(set).sort()).toEqual(
      ["proposal.votes", "proposal.votesAgainst", "proposal.votesFor", "updatedAt"].sort()
    );
  });

  it("records votes in the dotted proposal.votes map with live tallies", async () => {
    const world = await seedWorld();
    await seedOpenConference(world, TURN_YEAR1_OPEN);
    await proposePlatform(
      world.db,
      "UK",
      world.partySeq,
      world.leader.actor,
      validPledgeIds(),
      TURN_YEAR1_OPEN,
      NOW()
    );
    await voteOnPlatform(
      world.db,
      "UK",
      world.partySeq,
      world.members[0].actor,
      "aye",
      TURN_YEAR1_OPEN,
      NOW()
    );
    await voteOnPlatform(
      world.db,
      "UK",
      world.partySeq,
      world.members[1].actor,
      "nay",
      TURN_YEAR1_OPEN,
      NOW()
    );
    const doc = await getConference(world.db, "UK", world.partySeq, 1);
    expect(doc?.proposal?.votesFor).toBe(1);
    expect(doc?.proposal?.votesAgainst).toBe(1);
    expect(doc?.proposal?.votes[world.members[0].id.toString()]).toBe("aye");
    expect(doc?.proposal?.votes[world.members[1].id.toString()]).toBe("nay");
    // The pipeline write must not clobber sibling proposal fields.
    expect(doc?.proposal?.pledgeIds).toEqual(validPledgeIds());
    expect(doc?.proposal?.status).toBe("voting");
  });

  it("changing a vote moves the tally instead of double-counting", async () => {
    const world = await seedWorld();
    await seedOpenConference(world, TURN_YEAR1_OPEN);
    await proposePlatform(
      world.db,
      "UK",
      world.partySeq,
      world.leader.actor,
      validPledgeIds(),
      TURN_YEAR1_OPEN,
      NOW()
    );
    await voteOnPlatform(
      world.db,
      "UK",
      world.partySeq,
      world.members[0].actor,
      "aye",
      TURN_YEAR1_OPEN,
      NOW()
    );
    const repeat = await voteOnPlatform(
      world.db,
      "UK",
      world.partySeq,
      world.members[0].actor,
      "aye",
      TURN_YEAR1_OPEN,
      NOW()
    );
    expect(repeat).toMatchObject({ votesFor: 1, votesAgainst: 0 });
    const changed = await voteOnPlatform(
      world.db,
      "UK",
      world.partySeq,
      world.members[0].actor,
      "nay",
      TURN_YEAR1_OPEN,
      NOW()
    );
    expect(changed).toMatchObject({ votesFor: 0, votesAgainst: 1 });
  });

  it("rejects outsider votes and votes with no open proposal", async () => {
    const world = await seedWorld();
    await seedOpenConference(world, TURN_YEAR1_OPEN);
    await proposePlatform(
      world.db,
      "UK",
      world.partySeq,
      world.leader.actor,
      validPledgeIds(),
      TURN_YEAR1_OPEN,
      NOW()
    );
    await expectApiError(
      voteOnPlatform(world.db, "UK", world.partySeq, world.outsider, "aye", TURN_YEAR1_OPEN, NOW()),
      403
    );
    const empty = await seedWorld({ seq: 5, name: "Liberal Party" });
    await seedOpenConference(empty, TURN_YEAR1_OPEN);
    await expectApiError(
      voteOnPlatform(
        empty.db,
        "UK",
        empty.partySeq,
        empty.members[0].actor,
        "aye",
        TURN_YEAR1_OPEN,
        NOW()
      ),
      400
    );
  });

  it("rejects votes after the window closes", async () => {
    const world = await seedWorld();
    await seedOpenConference(world, TURN_YEAR1_OPEN);
    await proposePlatform(
      world.db,
      "UK",
      world.partySeq,
      world.leader.actor,
      validPledgeIds(),
      TURN_YEAR1_OPEN,
      NOW()
    );
    const doc = await getConference(world.db, "UK", world.partySeq, 1);
    const late = (doc?.votingClosesTurn ?? TURN_YEAR1_OPEN) + 1;
    await expectApiError(
      voteOnPlatform(world.db, "UK", world.partySeq, world.members[0].actor, "aye", late, NOW()),
      400
    );
  });
});

describe("proposeRulesMotion and voteOnMotion", () => {
  it("lets the committee propose a bounded amendment and vote it through", async () => {
    const world = await seedWorld();
    await seedOpenConference(world, TURN_YEAR1_OPEN);
    const { motionId } = await proposeRulesMotion(
      world.db,
      "UK",
      world.partySeq,
      world.committee[0].actor,
      { triggerThresholdPct: 0.2 },
      TURN_YEAR1_OPEN,
      NOW()
    );
    expect(typeof motionId).toBe("string");
    await voteOnMotion(
      world.db,
      "UK",
      world.partySeq,
      motionId,
      world.committee[0].actor,
      "aye",
      TURN_YEAR1_OPEN,
      NOW()
    );
    const changed = await voteOnMotion(
      world.db,
      "UK",
      world.partySeq,
      motionId,
      world.committee[1].actor,
      "aye",
      TURN_YEAR1_OPEN,
      NOW()
    );
    expect(changed).toMatchObject({ votesFor: 2, votesAgainst: 0 });
    const doc = await getConference(world.db, "UK", world.partySeq, 1);
    expect(doc?.motions.find((m) => m.motionId === motionId)?.status).toBe("voting");
  });

  it("rejects out-of-bounds patches and empty patches now (not only at resolve)", async () => {
    const world = await seedWorld();
    await seedOpenConference(world, TURN_YEAR1_OPEN);
    await expectApiError(
      proposeRulesMotion(
        world.db,
        "UK",
        world.partySeq,
        world.committee[0].actor,
        { triggerThresholdPct: 0.9 },
        TURN_YEAR1_OPEN,
        NOW()
      ),
      400
    );
    await expectApiError(
      proposeRulesMotion(
        world.db,
        "UK",
        world.partySeq,
        world.committee[0].actor,
        {},
        TURN_YEAR1_OPEN,
        NOW()
      ),
      400
    );
    await expectApiError(
      proposeRulesMotion(
        world.db,
        "UK",
        world.partySeq,
        world.committee[0].actor,
        { electorate: "senators" as never },
        TURN_YEAR1_OPEN,
        NOW()
      ),
      400
    );
  });

  it("restricts motions to the committee: plain members and outsiders cannot propose or vote", async () => {
    const world = await seedWorld();
    await seedOpenConference(world, TURN_YEAR1_OPEN);
    await expectApiError(
      proposeRulesMotion(
        world.db,
        "UK",
        world.partySeq,
        world.members[0].actor,
        { triggerThresholdPct: 0.2 },
        TURN_YEAR1_OPEN,
        NOW()
      ),
      403
    );
    await expectApiError(
      proposeRulesMotion(
        world.db,
        "UK",
        world.partySeq,
        world.outsider,
        { triggerThresholdPct: 0.2 },
        TURN_YEAR1_OPEN,
        NOW()
      ),
      403
    );
    const { motionId } = await proposeRulesMotion(
      world.db,
      "UK",
      world.partySeq,
      world.committee[0].actor,
      { triggerThresholdPct: 0.2 },
      TURN_YEAR1_OPEN,
      NOW()
    );
    await expectApiError(
      voteOnMotion(
        world.db,
        "UK",
        world.partySeq,
        motionId,
        world.members[0].actor,
        "aye",
        TURN_YEAR1_OPEN,
        NOW()
      ),
      403
    );
    await expectApiError(
      voteOnMotion(
        world.db,
        "UK",
        world.partySeq,
        "no-such-motion",
        world.committee[0].actor,
        "aye",
        TURN_YEAR1_OPEN,
        NOW()
      ),
      400
    );
  });
});

describe("voteOnMotion atomic tally", () => {
  async function seedMotionWorld() {
    const world = await seedWorld();
    await seedOpenConference(world, TURN_YEAR1_OPEN);
    const { motionId } = await proposeRulesMotion(
      world.db,
      "UK",
      world.partySeq,
      world.committee[0].actor,
      { triggerThresholdPct: 0.2 },
      TURN_YEAR1_OPEN,
      NOW()
    );
    return { world, motionId };
  }

  async function readMotion(world: SeedWorld, motionId: string) {
    const doc = await getConference(world.db, "UK", world.partySeq, 1);
    return doc?.motions.find((m) => m.motionId === motionId);
  }

  it("emits a $map pipeline update (never a whole-array literal write)", () => {
    const update = buildMotionVoteTallyUpdate<"aye" | "nay">({
      motionId: "m1",
      voteKey: new ObjectId().toString(),
      vote: "aye",
      tallyFieldByVote: { aye: "votesFor", nay: "votesAgainst" },
      updatedAt: NOW(),
    });
    expect(Array.isArray(update)).toBe(true);
    const set = (update as Array<{ $set: Record<string, unknown> }>)[0].$set;
    expect(Object.keys(set).sort()).toEqual(["motions", "updatedAt"].sort());
    const map = (set.motions as { $map: Record<string, unknown> }).$map;
    expect(map.as).toBe("m");
    expect(map.input).toBe("$motions");
  });

  it("converges concurrent votes from distinct members on the shared parent row", async () => {
    const { world, motionId } = await seedMotionWorld();
    const voters = [world.leader, ...world.committee];
    const votes = ["aye", "aye", "nay", "aye"] as const;
    const results = await Promise.all(
      voters.map((voter, i) =>
        voteOnMotion(
          world.db,
          "UK",
          world.partySeq,
          motionId,
          voter.actor,
          votes[i],
          TURN_YEAR1_OPEN,
          NOW()
        )
      )
    );
    expect(results.every((r) => r.success)).toBe(true);
    // No vote lost, none duplicated: every receipt lands exactly once.
    const motion = await readMotion(world, motionId);
    expect(motion?.votesFor).toBe(3);
    expect(motion?.votesAgainst).toBe(1);
    expect(Object.keys(motion?.votes ?? {}).sort()).toEqual(
      voters.map((voter) => voter.id.toString()).sort()
    );
    expect(motion?.votes[voters[2].id.toString()]).toBe("nay");
  });

  it("applies a vote computed before a concurrent vote without clobbering it", async () => {
    // Two servers read the same parent row, then both write: A computes its
    // write first but the write lands after B's. The deferred write must
    // converge on the stored state, not overwrite it with its stale snapshot.
    const { world, motionId } = await seedMotionWorld();
    const collName = "ukPartyConferences";
    const inner = world.db.collection(collName) as unknown as {
      updateOne: (
        filter: unknown,
        update: unknown,
        opts?: unknown
      ) => Promise<{ matchedCount: number; modifiedCount: number }>;
      findOne: (filter: unknown) => Promise<unknown>;
      findOneAndUpdate: (filter: unknown, update: unknown, opts?: unknown) => Promise<unknown>;
    };
    const recorded: Array<{ filter: unknown; update: unknown }> = [];
    let deferNextWrite = true;
    const racingDb = {
      ...world.db,
      collection: (name: string) => {
        const innerColl = world.db.collection(name);
        if (name !== collName) return innerColl;
        return {
          ...innerColl,
          updateOne: async (filter: unknown, update: unknown, opts?: unknown) => {
            if (deferNextWrite) {
              deferNextWrite = false;
              recorded.push({ filter, update });
              return { matchedCount: 1, modifiedCount: 1 };
            }
            return inner.updateOne(filter, update, opts);
          },
          findOneAndUpdate: async (filter: unknown, update: unknown, opts?: unknown) => {
            if (deferNextWrite) {
              deferNextWrite = false;
              recorded.push({ filter, update });
              return inner.findOne(filter);
            }
            return inner.findOneAndUpdate(filter, update, opts);
          },
        };
      },
    } as unknown as Db;
    const aVote = voteOnMotion(
      racingDb,
      "UK",
      world.partySeq,
      motionId,
      world.committee[0].actor,
      "aye",
      TURN_YEAR1_OPEN,
      NOW()
    );
    const bVote = await voteOnMotion(
      world.db,
      "UK",
      world.partySeq,
      motionId,
      world.committee[1].actor,
      "nay",
      TURN_YEAR1_OPEN,
      NOW()
    );
    expect(bVote).toMatchObject({ votesFor: 0, votesAgainst: 1 });
    const aResult = await aVote;
    expect(aResult.success).toBe(true);
    expect(recorded).toHaveLength(1);
    // A's write lands after B's: replay the deferred write against the row
    // that already holds B's vote.
    await inner.updateOne(recorded[0].filter, recorded[0].update);
    const motion = await readMotion(world, motionId);
    expect(motion).toMatchObject({ votesFor: 1, votesAgainst: 1 });
    expect(motion?.votes[world.committee[0].id.toString()]).toBe("aye");
    expect(motion?.votes[world.committee[1].id.toString()]).toBe("nay");
  });

  it("counts concurrent duplicate votes from the same member exactly once", async () => {
    const { world, motionId } = await seedMotionWorld();
    await Promise.all([
      voteOnMotion(
        world.db,
        "UK",
        world.partySeq,
        motionId,
        world.committee[0].actor,
        "aye",
        TURN_YEAR1_OPEN,
        NOW()
      ),
      voteOnMotion(
        world.db,
        "UK",
        world.partySeq,
        motionId,
        world.committee[0].actor,
        "aye",
        TURN_YEAR1_OPEN,
        NOW()
      ),
      voteOnMotion(
        world.db,
        "UK",
        world.partySeq,
        motionId,
        world.committee[1].actor,
        "aye",
        TURN_YEAR1_OPEN,
        NOW()
      ),
    ]);
    const motion = await readMotion(world, motionId);
    expect(motion?.votesFor).toBe(2);
    expect(motion?.votesAgainst).toBe(0);
    expect(Object.keys(motion?.votes ?? {})).toHaveLength(2);
  });

  it("replays the same vote as a no-op and moves the tally on change", async () => {
    const { world, motionId } = await seedMotionWorld();
    const first = await voteOnMotion(
      world.db,
      "UK",
      world.partySeq,
      motionId,
      world.committee[0].actor,
      "aye",
      TURN_YEAR1_OPEN,
      NOW()
    );
    expect(first).toMatchObject({ votesFor: 1, votesAgainst: 0 });
    const replay = await voteOnMotion(
      world.db,
      "UK",
      world.partySeq,
      motionId,
      world.committee[0].actor,
      "aye",
      TURN_YEAR1_OPEN,
      NOW()
    );
    expect(replay).toMatchObject({ votesFor: 1, votesAgainst: 0 });
    const changed = await voteOnMotion(
      world.db,
      "UK",
      world.partySeq,
      motionId,
      world.committee[0].actor,
      "nay",
      TURN_YEAR1_OPEN,
      NOW()
    );
    expect(changed).toMatchObject({ votesFor: 0, votesAgainst: 1 });
    const motion = await readMotion(world, motionId);
    expect(motion?.votes[world.committee[0].id.toString()]).toBe("nay");
  });

  it("rejects votes from members removed from the committee roll", async () => {
    const { world, motionId } = await seedMotionWorld();
    // Member-roll drift lands between calls: live eligibility is re-read
    // from the party row on every vote, so the next vote honors the new
    // roll, while the frozen roll keeps the write boundary and quorum stable.
    await world.db
      .collection("politicalParties")
      .updateOne(
        { _id: world.party._id },
        { $set: { committeeIds: world.committee.slice(1).map((m) => m.id) } }
      );
    await expectApiError(
      voteOnMotion(
        world.db,
        "UK",
        world.partySeq,
        motionId,
        world.committee[0].actor,
        "aye",
        TURN_YEAR1_OPEN,
        NOW()
      ),
      403
    );
    const ok = await voteOnMotion(
      world.db,
      "UK",
      world.partySeq,
      motionId,
      world.committee[1].actor,
      "aye",
      TURN_YEAR1_OPEN,
      NOW()
    );
    expect(ok).toMatchObject({ votesFor: 1, votesAgainst: 0 });
    const motion = await readMotion(world, motionId);
    expect(motion?.votes[world.committee[0].id.toString()]).toBeUndefined();
  });

  it("leaves sibling motions untouched", async () => {
    const { world, motionId } = await seedMotionWorld();
    const second = await proposeRulesMotion(
      world.db,
      "UK",
      world.partySeq,
      world.committee[1].actor,
      { triggerThresholdPct: 0.25 },
      TURN_YEAR1_OPEN,
      NOW()
    );
    await voteOnMotion(
      world.db,
      "UK",
      world.partySeq,
      motionId,
      world.committee[0].actor,
      "aye",
      TURN_YEAR1_OPEN,
      NOW()
    );
    const voted = await readMotion(world, motionId);
    expect(voted).toMatchObject({ votesFor: 1, votesAgainst: 0 });
    const sibling = await readMotion(world, second.motionId);
    expect(sibling).toMatchObject({ votesFor: 0, votesAgainst: 0, status: "voting" });
    expect(sibling?.votes).toEqual({});
    // The motion write preserves ObjectId-typed fields (proposer receipt).
    expect(voted?.proposedByCharacterId).toBeInstanceOf(ObjectId);
  });

  it("freezes votes at resolution: decided tallies persist and late votes fail", async () => {
    const { world, motionId } = await seedMotionWorld();
    for (const m of world.committee) {
      await voteOnMotion(
        world.db,
        "UK",
        world.partySeq,
        motionId,
        m.actor,
        "aye",
        TURN_YEAR1_OPEN,
        NOW()
      );
    }
    const doc = await getConference(world.db, "UK", world.partySeq, 1);
    const resolution = await resolveConference(
      world.db,
      "UK",
      world.party,
      doc!,
      doc!.votingClosesTurn,
      NOW()
    );
    expect(resolution.motionsPassed).toBe(1);
    const after = await readMotion(world, motionId);
    expect(after?.status).toBe("passed");
    expect(after).toMatchObject({ votesFor: 3, votesAgainst: 0 });
    // The resolution claim flips the row to completed, so the conditional
    // vote write matches zero documents instead of writing into a decided row.
    await expectApiError(
      voteOnMotion(
        world.db,
        "UK",
        world.partySeq,
        motionId,
        world.leader.actor,
        "aye",
        TURN_YEAR1_OPEN,
        NOW()
      ),
      400
    );
    const settled = await readMotion(world, motionId);
    expect(settled).toMatchObject({ votesFor: 3, votesAgainst: 0 });
  });

  it("rejects votes after the window closes without writing", async () => {
    const { world, motionId } = await seedMotionWorld();
    await voteOnMotion(
      world.db,
      "UK",
      world.partySeq,
      motionId,
      world.committee[0].actor,
      "aye",
      TURN_YEAR1_OPEN,
      NOW()
    );
    const doc = await getConference(world.db, "UK", world.partySeq, 1);
    const late = doc!.votingClosesTurn;
    await expectApiError(
      voteOnMotion(
        world.db,
        "UK",
        world.partySeq,
        motionId,
        world.committee[1].actor,
        "aye",
        late,
        NOW()
      ),
      400
    );
    const motion = await readMotion(world, motionId);
    expect(motion).toMatchObject({ votesFor: 1, votesAgainst: 0 });
    expect(motion?.votes[world.committee[1].id.toString()]).toBeUndefined();
  });
});

describe("resolveConference", () => {
  async function seedRatifiable(world: SeedWorld, opts: { ayes?: number; nays?: number } = {}) {
    await seedOpenConference(world, TURN_YEAR1_OPEN);
    await proposePlatform(
      world.db,
      "UK",
      world.partySeq,
      world.leader.actor,
      validPledgeIds(),
      TURN_YEAR1_OPEN,
      NOW()
    );
    const voters = [...world.members, ...world.committee, world.leader];
    const ayes = opts.ayes ?? 5;
    const nays = opts.nays ?? 0;
    for (let i = 0; i < ayes; i++) {
      await voteOnPlatform(
        world.db,
        "UK",
        world.partySeq,
        voters[i].actor,
        "aye",
        TURN_YEAR1_OPEN,
        NOW()
      );
    }
    for (let i = 0; i < nays; i++) {
      await voteOnPlatform(
        world.db,
        "UK",
        world.partySeq,
        voters[ayes + i].actor,
        "nay",
        TURN_YEAR1_OPEN,
        NOW()
      );
    }
    return getConference(world.db, "UK", world.partySeq, 1);
  }

  it("ratifies on majority + quorum, writes the standing platform, never the manifestos", async () => {
    const world = await seedWorld();
    const doc = await seedRatifiable(world);
    expect(doc).not.toBeNull();
    const closeTurn = doc!.votingClosesTurn;
    const resolution = await resolveConference(world.db, "UK", world.party, doc!, closeTurn, NOW());
    expect(resolution).toMatchObject({ completed: true, ratified: true });

    const after = await getConference(world.db, "UK", world.partySeq, 1);
    expect(after?.status).toBe("completed");
    expect(after?.proposal?.status).toBe("ratified");
    expect(after?.ratified).toBe(true);
    expect(after?.outcome).toBe("ratified");
    expect(after?.payoffDue).toBe(true);

    const platform = await getUKPartyPlatformsCollection(world.db).findOne({
      _id: `UK:${world.partySeq}`,
    });
    expect(platform?.pledgeIds).toEqual(validPledgeIds());
    expect(platform?.ratifiedConferenceId).toBe(doc!._id);

    const manifestos = await world.db.collection("manifestos").find({}).toArray();
    expect(manifestos).toHaveLength(0);

    // Re-resolution is a no-op: the open->completed claim fires once.
    const retry = await resolveConference(world.db, "UK", world.party, after!, closeTurn, NOW());
    expect(retry).toMatchObject({ completed: false, ratified: false });
  });

  it("closes without ratification below quorum, with no platform and no payoff", async () => {
    const world = await seedWorld();
    await seedOpenConference(world, TURN_YEAR1_OPEN);
    await proposePlatform(
      world.db,
      "UK",
      world.partySeq,
      world.leader.actor,
      validPledgeIds(),
      TURN_YEAR1_OPEN,
      NOW()
    );
    await voteOnPlatform(
      world.db,
      "UK",
      world.partySeq,
      world.members[0].actor,
      "aye",
      TURN_YEAR1_OPEN,
      NOW()
    );
    const doc = await getConference(world.db, "UK", world.partySeq, 1);
    const resolution = await resolveConference(
      world.db,
      "UK",
      world.party,
      doc!,
      doc!.votingClosesTurn,
      NOW()
    );
    expect(resolution).toMatchObject({ completed: true, ratified: false });
    const after = await getConference(world.db, "UK", world.partySeq, 1);
    expect(after?.outcome).toBe("closedWithoutRatification");
    expect(after?.payoffDue).toBe(false);
    expect(after?.proposal?.status).toBe("rejected");
    expect(
      await getUKPartyPlatformsCollection(world.db).findOne({ _id: `UK:${world.partySeq}` })
    ).toBeNull();
  });

  it("applies a passed motion to the leadership ruleset", async () => {
    const world = await seedWorld();
    await seedRatifiable(world);
    const { motionId } = await proposeRulesMotion(
      world.db,
      "UK",
      world.partySeq,
      world.committee[0].actor,
      { triggerThresholdPct: 0.2 },
      TURN_YEAR1_OPEN,
      NOW()
    );
    for (const m of world.committee) {
      await voteOnMotion(
        world.db,
        "UK",
        world.partySeq,
        motionId,
        m.actor,
        "aye",
        TURN_YEAR1_OPEN,
        NOW()
      );
    }
    const doc = await getConference(world.db, "UK", world.partySeq, 1);
    const resolution = await resolveConference(
      world.db,
      "UK",
      world.party,
      doc!,
      doc!.votingClosesTurn,
      NOW()
    );
    expect(resolution.motionsPassed).toBe(1);
    const leadership = await getUKPartyLeadershipCollection(world.db).findOne({
      _id: `UK:${world.partySeq}`,
    });
    expect(leadership?.ruleset?.triggerThresholdPct).toBe(0.2);
    const after = await getConference(world.db, "UK", world.partySeq, 1);
    expect(after?.motions.find((m) => m.motionId === motionId)?.status).toBe("passed");
  });

  it("voids a passed motion when the #861 amendment cooldown fired", async () => {
    const world = await seedWorld();
    await seedRatifiable(world);
    const { motionId } = await proposeRulesMotion(
      world.db,
      "UK",
      world.partySeq,
      world.committee[0].actor,
      { triggerThresholdPct: 0.2 },
      TURN_YEAR1_OPEN,
      NOW()
    );
    for (const m of world.committee) {
      await voteOnMotion(
        world.db,
        "UK",
        world.partySeq,
        motionId,
        m.actor,
        "aye",
        TURN_YEAR1_OPEN,
        NOW()
      );
    }
    // A direct amendment just before resolve starts the cooldown.
    const { amendLeadershipRules } = await import("../leadership/leadershipCommands");
    await amendLeadershipRules(
      world.db,
      "UK",
      world.partySeq,
      world.committee[0].actor,
      { survivalImmunityTurns: 10 },
      TURN_YEAR1_OPEN,
      NOW()
    );
    const doc = await getConference(world.db, "UK", world.partySeq, 1);
    const resolution = await resolveConference(
      world.db,
      "UK",
      world.party,
      doc!,
      doc!.votingClosesTurn,
      NOW()
    );
    expect(resolution.motionsPassed).toBe(0);
    expect(resolution.motionsVoided).toBe(1);
    const after = await getConference(world.db, "UK", world.partySeq, 1);
    const motion = after?.motions.find((m) => m.motionId === motionId);
    expect(motion?.status).toBe("void");
    expect(motion?.voidReason).toContain("cooldown");
    // The voided patch never applied; the direct amendment stands.
    const leadership = await getUKPartyLeadershipCollection(world.db).findOne({
      _id: `UK:${world.partySeq}`,
    });
    expect(leadership?.ruleset?.triggerThresholdPct).not.toBe(0.2);
    expect(leadership?.ruleset?.survivalImmunityTurns).toBe(10);
  });

  it("marks losing motions failed without touching the ruleset", async () => {
    const world = await seedWorld();
    await seedRatifiable(world);
    const { motionId } = await proposeRulesMotion(
      world.db,
      "UK",
      world.partySeq,
      world.committee[0].actor,
      { triggerThresholdPct: 0.2 },
      TURN_YEAR1_OPEN,
      NOW()
    );
    await voteOnMotion(
      world.db,
      "UK",
      world.partySeq,
      motionId,
      world.committee[0].actor,
      "aye",
      TURN_YEAR1_OPEN,
      NOW()
    );
    await voteOnMotion(
      world.db,
      "UK",
      world.partySeq,
      motionId,
      world.committee[1].actor,
      "nay",
      TURN_YEAR1_OPEN,
      NOW()
    );
    await voteOnMotion(
      world.db,
      "UK",
      world.partySeq,
      motionId,
      world.committee[2].actor,
      "nay",
      TURN_YEAR1_OPEN,
      NOW()
    );
    const doc = await getConference(world.db, "UK", world.partySeq, 1);
    const resolution = await resolveConference(
      world.db,
      "UK",
      world.party,
      doc!,
      doc!.votingClosesTurn,
      NOW()
    );
    expect(resolution.motionsPassed).toBe(0);
    const after = await getConference(world.db, "UK", world.partySeq, 1);
    expect(after?.motions.find((m) => m.motionId === motionId)?.status).toBe("failed");
  });
});

describe("NPP conferences", () => {
  it("tables a deterministic platform for chairless parties and acclaims it", async () => {
    const world = await seedWorld({ seq: 7, name: "AI Party", chairless: true });
    await seedOpenConference(world, TURN_YEAR1_OPEN);
    const before = await getConference(world.db, "UK", world.partySeq, 1);
    const tabled = await ensureNppPlatformProposal(
      world.db,
      "UK",
      world.party,
      before!,
      TURN_YEAR1_OPEN,
      NOW()
    );
    expect(tabled).toBe(true);
    const second = await ensureNppPlatformProposal(
      world.db,
      "UK",
      world.party,
      (await getConference(world.db, "UK", world.partySeq, 1))!,
      TURN_YEAR1_OPEN,
      NOW()
    );
    expect(second).toBe(false);
    const doc = await getConference(world.db, "UK", world.partySeq, 1);
    const resolution = await resolveConference(
      world.db,
      "UK",
      world.party,
      doc!,
      doc!.votingClosesTurn,
      NOW()
    );
    expect(resolution).toMatchObject({ completed: true, ratified: true });
    const platform = await getUKPartyPlatformsCollection(world.db).findOne({
      _id: `UK:${world.partySeq}`,
    });
    expect(platform?.pledgeIds).toHaveLength(3);
  });

  it("matches the election-manifesto NPP selector (platform parity)", async () => {
    const { selectNppPledges } = await import("../manifesto/nppManifesto");
    const world = await seedWorld({ seq: 8, name: "AI Parity", chairless: true });
    await seedOpenConference(world, TURN_YEAR1_OPEN);
    const before = await getConference(world.db, "UK", world.partySeq, 1);
    await ensureNppPlatformProposal(world.db, "UK", world.party, before!, TURN_YEAR1_OPEN, NOW());
    const doc = await getConference(world.db, "UK", world.partySeq, 1);
    const expected = selectNppPledges(
      pledgeCatalogFor("UK"),
      world.party.economicPosition ?? 0,
      world.party.socialPosition ?? 0
    );
    expect(doc?.proposal?.pledgeIds).toEqual(expected);
  });
});

describe("applyConferencePayoff", () => {
  async function seedCompleted(world: SeedWorld) {
    await seedOpenConference(world, TURN_YEAR1_OPEN);
    await proposePlatform(
      world.db,
      "UK",
      world.partySeq,
      world.leader.actor,
      validPledgeIds(),
      TURN_YEAR1_OPEN,
      NOW()
    );
    const voters = [...world.members, ...world.committee];
    for (let i = 0; i < 5; i++) {
      await voteOnPlatform(
        world.db,
        "UK",
        world.partySeq,
        voters[i].actor,
        "aye",
        TURN_YEAR1_OPEN,
        NOW()
      );
    }
    const doc = await getConference(world.db, "UK", world.partySeq, 1);
    await resolveConference(world.db, "UK", world.party, doc!, doc!.votingClosesTurn, NOW());
    return (await getConference(world.db, "UK", world.partySeq, 1))!;
  }

  it("credits cohesion PS once, with no approval rows while the payoff gate is off", async () => {
    const world = await seedWorld();
    const completed = await seedCompleted(world);
    const payoff = await applyConferencePayoff(
      world.db,
      "UK",
      world.party,
      completed,
      TURN_YEAR1_OPEN + 20,
      NOW()
    );
    expect(payoff).toMatchObject({
      applied: true,
      approvalGroups: 0,
      cohesionPs: CONFERENCE_COHESION_PS,
    });
    const party = await world.db.collection("politicalParties").findOne({ _id: world.party._id });
    expect(party?.politicalStrength).toBe(CONFERENCE_COHESION_PS);
    expect(await world.db.collection("partyGroupFavorability").find({}).toArray()).toHaveLength(0);

    // Idempotent: a retry claims nothing and writes nothing new.
    const retry = await applyConferencePayoff(
      world.db,
      "UK",
      world.party,
      (await getConference(world.db, "UK", world.partySeq, 1))!,
      TURN_YEAR1_OPEN + 21,
      NOW()
    );
    expect(retry.applied).toBe(false);
    const partyAgain = await world.db
      .collection("politicalParties")
      .findOne({ _id: world.party._id });
    expect(partyAgain?.politicalStrength).toBe(CONFERENCE_COHESION_PS);
  });

  it("writes bounded approval rows with expiry when the gate is on", async () => {
    process.env.UK_CONFERENCE_PAYOFF = "1";
    try {
      const world = await seedWorld();
      const completed = await seedCompleted(world);
      const turn = TURN_YEAR1_OPEN + 20;
      const payoff = await applyConferencePayoff(
        world.db,
        "UK",
        world.party,
        completed,
        turn,
        NOW()
      );
      expect(payoff.applied).toBe(true);
      expect(payoff.approvalGroups).toBeGreaterThan(0);
      expect(payoff.approvalGroups).toBeLessThanOrEqual(12);
      const rows = await world.db.collection("partyGroupFavorability").find({}).toArray();
      expect(rows).toHaveLength(payoff.approvalGroups);
      for (const row of rows) {
        expect(row.favorabilityDelta).toBe(CONFERENCE_APPROVAL_DELTA);
        expect(row.expiresAtTurn).toBe(turn + CONFERENCE_PAYOFF_DURATION_TURNS);
        expect(row.sourceConferenceId).toBe(completed._id);
      }
    } finally {
      delete process.env.UK_CONFERENCE_PAYOFF;
    }
  });

  it("clamps the cohesion credit at the party cap and never pays unratified rows", async () => {
    const world = await seedWorld();
    await world.db
      .collection("politicalParties")
      .updateOne({ _id: world.party._id }, { $set: { politicalStrength: 10_000 } });
    const completed = await seedCompleted(world);
    // The command reads the cap inputs off the passed party snapshot, mirroring
    // the turn driver's freshly-read row.
    const richParty = { ...world.party, politicalStrength: 10_000 };
    const capped = await applyConferencePayoff(
      world.db,
      "UK",
      richParty,
      completed,
      TURN_YEAR1_OPEN + 20,
      NOW()
    );
    expect(capped).toMatchObject({ applied: true, cohesionPs: 0 });

    const other = await seedWorld({ seq: 9, name: "No Payoff" });
    await seedOpenConference(other, TURN_YEAR1_OPEN);
    const open = await getConference(other.db, "UK", other.partySeq, 1);
    const skipped = await applyConferencePayoff(
      other.db,
      "UK",
      other.party,
      open!,
      TURN_YEAR1_OPEN + 20,
      NOW()
    );
    expect(skipped.applied).toBe(false);
  });

  it("notifies the player chair, and a notification failure still pays exactly once", async () => {
    const { createNotification } = await import("@/lib/notifications");
    const world = await seedWorld();
    const completed = await seedCompleted(world);
    const payoff = await applyConferencePayoff(
      world.db,
      "UK",
      world.party,
      completed,
      TURN_YEAR1_OPEN + 20,
      NOW()
    );
    expect(payoff.applied).toBe(true);
    expect(vi.mocked(createNotification)).toHaveBeenCalledTimes(1);

    vi.mocked(createNotification).mockRejectedValueOnce(new Error("notify down"));
    const other = await seedWorld({ seq: 11, name: "Notify Down" });
    await seedOpenConference(other, TURN_YEAR1_OPEN);
    await proposePlatform(
      other.db,
      "UK",
      other.partySeq,
      other.leader.actor,
      validPledgeIds(),
      TURN_YEAR1_OPEN,
      NOW()
    );
    const voters = [...other.members, ...other.committee];
    for (let i = 0; i < 5; i++) {
      await voteOnPlatform(
        other.db,
        "UK",
        other.partySeq,
        voters[i].actor,
        "aye",
        TURN_YEAR1_OPEN,
        NOW()
      );
    }
    const doc = await getConference(other.db, "UK", other.partySeq, 1);
    await resolveConference(other.db, "UK", other.party, doc!, doc!.votingClosesTurn, NOW());
    const retryDoc = (await getConference(other.db, "UK", other.partySeq, 1))!;
    const paid = await applyConferencePayoff(
      other.db,
      "UK",
      other.party,
      retryDoc,
      TURN_YEAR1_OPEN + 20,
      NOW()
    );
    expect(paid.applied).toBe(true);
    const again = await applyConferencePayoff(
      other.db,
      "UK",
      other.party,
      (await getConference(other.db, "UK", other.partySeq, 1))!,
      TURN_YEAR1_OPEN + 21,
      NOW()
    );
    expect(again.applied).toBe(false);
    const party = await other.db.collection("politicalParties").findOne({ _id: other.party._id });
    expect(party?.politicalStrength).toBe(CONFERENCE_COHESION_PS);
  });
});

describe("getConferenceState", () => {
  it("exposes status, deadlines, quorum math, capabilities, and the standing platform", async () => {
    const world = await seedWorld();
    await seedOpenConference(world, TURN_YEAR1_OPEN);
    await proposePlatform(
      world.db,
      "UK",
      world.partySeq,
      world.leader.actor,
      validPledgeIds(),
      TURN_YEAR1_OPEN,
      NOW()
    );
    const view = await getConferenceState(
      world.db,
      "UK",
      world.partySeq,
      1,
      world.leader.actor,
      TURN_YEAR1_OPEN,
      NOW()
    );
    expect(view.status).toBe("open");
    expect(view.votingClosesTurn).toBe(conferenceVotingClosesTurn(conferenceOpensAtTurn(1)));
    expect(view.turnsUntilClose).toBe(view.votingClosesTurn - TURN_YEAR1_OPEN);
    expect(view.capabilities).toMatchObject({
      isPartyMember: true,
      // The chair sits in the committee electorate, so the leader can propose too.
      isCommitteeMember: true,
      isLeader: true,
      canPropose: true,
      canVote: true,
    });
    expect(view.proposal?.eligibleVoters).toBe(8);
    expect(view.proposal?.quorumNeeded).toBe(3);
    expect(view.platform).toBeNull();
  });

  it("gates capabilities for members, committee, and outsiders", async () => {
    const world = await seedWorld();
    await seedOpenConference(world, TURN_YEAR1_OPEN);
    const memberView = await getConferenceState(
      world.db,
      "UK",
      world.partySeq,
      1,
      world.members[0].actor,
      TURN_YEAR1_OPEN,
      NOW()
    );
    expect(memberView.capabilities).toMatchObject({
      isPartyMember: true,
      isCommitteeMember: false,
      canPropose: false,
      canVote: true,
    });
    const committeeView = await getConferenceState(
      world.db,
      "UK",
      world.partySeq,
      1,
      world.committee[0].actor,
      TURN_YEAR1_OPEN,
      NOW()
    );
    expect(committeeView.capabilities).toMatchObject({ isCommitteeMember: true, canPropose: true });
    const outsiderView = await getConferenceState(
      world.db,
      "UK",
      world.partySeq,
      1,
      world.outsider,
      TURN_YEAR1_OPEN,
      NOW()
    );
    expect(outsiderView.capabilities).toMatchObject({
      isPartyMember: false,
      canPropose: false,
      canVote: false,
    });
    const anonView = await getConferenceState(
      world.db,
      "UK",
      world.partySeq,
      1,
      null,
      TURN_YEAR1_OPEN,
      NOW()
    );
    expect(anonView.capabilities).toMatchObject({ isPartyMember: false, canVote: false });
  });
});

describe("getStandingPlatformsForCountry", () => {
  it("returns one entry per ratified party", async () => {
    const world = await seedWorld();
    await seedOpenConference(world, TURN_YEAR1_OPEN);
    await proposePlatform(
      world.db,
      "UK",
      world.partySeq,
      world.leader.actor,
      validPledgeIds(),
      TURN_YEAR1_OPEN,
      NOW()
    );
    const voters = [...world.members, ...world.committee];
    for (let i = 0; i < 5; i++) {
      await voteOnPlatform(
        world.db,
        "UK",
        world.partySeq,
        voters[i].actor,
        "aye",
        TURN_YEAR1_OPEN,
        NOW()
      );
    }
    const doc = await getConference(world.db, "UK", world.partySeq, 1);
    await resolveConference(world.db, "UK", world.party, doc!, doc!.votingClosesTurn, NOW());
    const map = await getStandingPlatformsForCountry(world.db, "UK");
    expect(map.get(world.partySeq)).toEqual(validPledgeIds());
  });
});

describe("election-call handoff", () => {
  it("locks the leader draft when one exists and seeds a vacuum from the platform", async () => {
    const { finaliseManifestosAtElectionCall } = await import("../manifesto/manifestoLifecycle");
    const { upsertManifestoDraft, getManifesto } = await import("@/lib/db/collections/manifestos");
    const world = await seedWorld();
    const electionId = new ObjectId();

    // Leader draft wins: pre-existing complete draft is locked, never overwritten.
    const leaderIds = altPledgeIds();
    await upsertManifestoDraft(world.db, {
      countryId: "UK",
      electionId,
      party: world.partySeq,
      pledges: leaderIds.map((id) => ({ catalogEntryId: id })),
      authorCharacterId: world.leader.id,
      now: NOW(),
    });
    const result = await finaliseManifestosAtElectionCall(world.db, {
      countryId: "UK",
      electionId,
      parties: [{ party: world.partySeq, isNpp: false }],
      standingPlatformByParty: new Map([[world.partySeq, validPledgeIds()]]),
      now: NOW(),
    });
    expect(result.lockedPlayerParties).toEqual([world.partySeq]);
    const locked = await getManifesto(world.db, "UK", electionId, world.partySeq);
    expect(locked?.pledges.map((p) => p.catalogEntryId)).toEqual(leaderIds);

    // Vacuum: no draft at all is seeded from the ratified platform, then locked.
    const vacuum = await seedWorld({ seq: 12, name: "Vacuum Party" });
    const vacuumResult = await finaliseManifestosAtElectionCall(vacuum.db, {
      countryId: "UK",
      electionId,
      parties: [{ party: vacuum.partySeq, isNpp: false }],
      standingPlatformByParty: new Map([[vacuum.partySeq, validPledgeIds()]]),
      now: NOW(),
    });
    expect(vacuumResult.lockedPlayerParties).toEqual([vacuum.partySeq]);
    const seeded = await getManifesto(vacuum.db, "UK", electionId, vacuum.partySeq);
    expect(seeded?.pledges.map((p) => p.catalogEntryId)).toEqual(validPledgeIds());
    expect(seeded?.lockedAt).not.toBeNull();
  });

  it("leaves incomplete leader drafts alone and prefers platforms for NPPs", async () => {
    const { finaliseManifestosAtElectionCall } = await import("../manifesto/manifestoLifecycle");
    const { upsertManifestoDraft, getManifesto } = await import("@/lib/db/collections/manifestos");
    const world = await seedWorld();
    const electionId = new ObjectId();

    const ids = validPledgeIds();
    await upsertManifestoDraft(world.db, {
      countryId: "UK",
      electionId,
      party: world.partySeq,
      pledges: [{ catalogEntryId: ids[0] }],
      authorCharacterId: world.leader.id,
      now: NOW(),
    });
    const result = await finaliseManifestosAtElectionCall(world.db, {
      countryId: "UK",
      electionId,
      parties: [{ party: world.partySeq, isNpp: false }],
      standingPlatformByParty: new Map([[world.partySeq, validPledgeIds()]]),
      now: NOW(),
    });
    expect(result.lockedPlayerParties).toHaveLength(0);
    expect(result.skipped).toEqual([world.partySeq]);
    const kept = await getManifesto(world.db, "UK", electionId, world.partySeq);
    expect(kept?.pledges).toHaveLength(1);

    const npp = await seedWorld({ seq: 13, name: "NPP Handoff", chairless: true });
    const nppResult = await finaliseManifestosAtElectionCall(npp.db, {
      countryId: "UK",
      electionId,
      parties: [{ party: npp.partySeq, isNpp: true, economic: 2, social: 2 }],
      standingPlatformByParty: new Map([[npp.partySeq, validPledgeIds()]]),
      now: NOW(),
    });
    expect(nppResult.generatedNppParties).toEqual([npp.partySeq]);
    const generated = await getManifesto(npp.db, "UK", electionId, npp.partySeq);
    expect(generated?.pledges.map((p) => p.catalogEntryId)).toEqual(validPledgeIds());
  });
});

describe("postConferenceNews", () => {
  it("posts a ratified vs missed system story", async () => {
    const { createSystemNewsPost } = await import("@/lib/news");
    await postConferenceNews("Conservative Party", 1, true);
    await postConferenceNews("Liberal Party", 1, false);
    expect(vi.mocked(createSystemNewsPost)).toHaveBeenCalledTimes(2);
    expect(vi.mocked(createSystemNewsPost).mock.calls[0][0]).toContain("ratifying");
  });
});

describe("resolveConference crash recovery", () => {
  async function seedVoted(world: SeedWorld, ayes = 5) {
    await seedOpenConference(world, TURN_YEAR1_OPEN);
    await proposePlatform(
      world.db,
      "UK",
      world.partySeq,
      world.leader.actor,
      validPledgeIds(),
      TURN_YEAR1_OPEN,
      NOW()
    );
    const voters = [...world.members, ...world.committee, world.leader];
    for (let i = 0; i < ayes; i++) {
      await voteOnPlatform(
        world.db,
        "UK",
        world.partySeq,
        voters[i].actor,
        "aye",
        TURN_YEAR1_OPEN,
        NOW()
      );
    }
    return (await getConference(world.db, "UK", world.partySeq, 1))!;
  }

  async function seedVotedWithMotion(world: SeedWorld) {
    await seedVoted(world);
    const { motionId } = await proposeRulesMotion(
      world.db,
      "UK",
      world.partySeq,
      world.committee[0].actor,
      { triggerThresholdPct: 0.2 },
      TURN_YEAR1_OPEN,
      NOW()
    );
    for (const member of world.committee) {
      await voteOnMotion(
        world.db,
        "UK",
        world.partySeq,
        motionId,
        member.actor,
        "aye",
        TURN_YEAR1_OPEN,
        NOW()
      );
    }
    return { doc: (await getConference(world.db, "UK", world.partySeq, 1))!, motionId };
  }

  it("resumes a legacy claim-without-fill row to full completion, exactly once", async () => {
    const world = await seedWorld();
    await seedVoted(world);
    // The old claim-then-fill shape: the claim won, the fill never landed.
    await getUKPartyConferencesCollection(world.db).updateOne(
      { _id: conferenceDocId("UK", world.partySeq, 1) },
      { $set: { status: "completed" } }
    );
    const stuck = (await getConference(world.db, "UK", world.partySeq, 1))!;
    expect(stuck).toMatchObject({ status: "completed", outcome: null });
    expect(conferenceResolutionNeedsHeal(stuck)).toBe(false);

    const resolution = await resolveConference(
      world.db,
      "UK",
      world.party,
      stuck,
      stuck.votingClosesTurn,
      NOW()
    );
    expect(resolution).toMatchObject({ completed: true, ratified: true });
    const after = (await getConference(world.db, "UK", world.partySeq, 1))!;
    expect(after.proposal?.status).toBe("ratified");
    expect(after.outcome).toBe("ratified");
    expect(after.payoffDue).toBe(true);
    const platform = await getUKPartyPlatformsCollection(world.db).findOne({
      _id: `UK:${world.partySeq}`,
    });
    expect(platform?.ratifiedConferenceId).toBe(after._id);

    const retry = await resolveConference(
      world.db,
      "UK",
      world.party,
      after,
      after.votingClosesTurn,
      NOW()
    );
    expect(retry).toMatchObject({ completed: false, ratified: false });
    expect(
      await getUKPartyPlatformsCollection(world.db)
        .find({ _id: `UK:${world.partySeq}` })
        .toArray()
    ).toHaveLength(1);
  });

  it("survives an injected crash on the claim, then on the fill", async () => {
    const isFillWrite = (args: unknown[]) => "outcome" in (args[0] as Record<string, unknown>);
    const isClaimWrite = (args: unknown[]) =>
      (args[0] as Record<string, unknown>).status === "open" &&
      !("outcome" in (args[0] as Record<string, unknown>));

    // Crash on the claim: the row stays open, the retry wins it cleanly.
    const claimed = await seedWorld();
    await seedVoted(claimed);
    const claimFaultDb = withCollectionFaults(claimed.db, [
      { collection: "ukPartyConferences", method: "findOneAndUpdate", match: isClaimWrite },
    ]);
    const open = (await getConference(claimed.db, "UK", claimed.partySeq, 1))!;
    await expect(
      resolveConference(claimFaultDb, "UK", claimed.party, open, open.votingClosesTurn, NOW())
    ).rejects.toThrow("injected");
    expect(await getConference(claimed.db, "UK", claimed.partySeq, 1)).toMatchObject({
      status: "open",
    });
    const claimedRetry = await resolveConference(
      claimed.db,
      "UK",
      claimed.party,
      open,
      open.votingClosesTurn,
      NOW()
    );
    expect(claimedRetry).toMatchObject({ completed: true, ratified: true });

    // Crash on the fill: the row sits in the durable recovery state.
    const world = await seedWorld();
    await seedVoted(world);
    const fillFaultDb = withCollectionFaults(world.db, [
      { collection: "ukPartyConferences", method: "findOneAndUpdate", match: isFillWrite },
    ]);
    const voting = (await getConference(world.db, "UK", world.partySeq, 1))!;
    await expect(
      resolveConference(fillFaultDb, "UK", world.party, voting, voting.votingClosesTurn, NOW())
    ).rejects.toThrow("injected");
    const stuck = (await getConference(world.db, "UK", world.partySeq, 1))!;
    expect(stuck).toMatchObject({ status: "completed", outcome: null });
    expect(stuck.proposal?.status).toBe("voting");

    const resolution = await resolveConference(
      world.db,
      "UK",
      world.party,
      stuck,
      stuck.votingClosesTurn,
      NOW()
    );
    expect(resolution).toMatchObject({ completed: true, ratified: true });
    const after = (await getConference(world.db, "UK", world.partySeq, 1))!;
    expect(after.history?.filter((h) => h.kind === "completed")).toHaveLength(1);
    expect(await getUKPartyPlatformsCollection(world.db).find({}).toArray()).toHaveLength(1);
  });

  it("heals a crash during side effects without double-applying the motion", async () => {
    const world = await seedWorld();
    const { doc, motionId } = await seedVotedWithMotion(world);
    // Fault only the conditional leadership apply write ($push receipt);
    // the getOrSeed upsert ($setOnInsert, no $push) passes through.
    const faultDb = withCollectionFaults(world.db, [
      {
        collection: "ukPartyLeadership",
        method: "updateOne",
        match: (args) => "$push" in (args[1] as Record<string, unknown>),
      },
    ]);
    await expect(
      resolveConference(faultDb, "UK", world.party, doc, doc.votingClosesTurn, NOW())
    ).rejects.toThrow("injected");

    // Durable resolution landed; only the motion side effect is missing.
    const mid = (await getConference(world.db, "UK", world.partySeq, 1))!;
    expect(mid.outcome).toBe("ratified");
    expect(mid.motions.find((m) => m.motionId === motionId)?.status).toBe("passed");
    expect(mid.appliedMotionIds ?? []).toHaveLength(0);
    expect(conferenceResolutionNeedsHeal(mid)).toBe(true);
    const leadershipMid = await getUKPartyLeadershipCollection(world.db).findOne({
      _id: `UK:${world.partySeq}`,
    });
    expect(leadershipMid?.ruleset?.triggerThresholdPct).not.toBe(0.2);

    // The retry wins no fill (completed:false) but heals the side effect.
    const retry = await resolveConference(
      world.db,
      "UK",
      world.party,
      mid,
      mid.votingClosesTurn,
      NOW()
    );
    expect(retry).toMatchObject({ completed: false, ratified: false });
    const after = (await getConference(world.db, "UK", world.partySeq, 1))!;
    expect(after.appliedMotionIds).toEqual([motionId]);
    expect(conferenceResolutionNeedsHeal(after)).toBe(false);
    const leadership = await getUKPartyLeadershipCollection(world.db).findOne({
      _id: `UK:${world.partySeq}`,
    });
    expect(leadership?.ruleset?.triggerThresholdPct).toBe(0.2);
    expect(leadership?.appliedConferenceMotionIds).toEqual([motionId]);
    expect(leadership?.history?.filter((h) => h.detail.includes(motionId))).toHaveLength(1);

    // A third pass changes nothing.
    const leadershipBefore = JSON.stringify(leadership);
    await resolveConference(world.db, "UK", world.party, after, after.votingClosesTurn, NOW());
    expect(
      JSON.stringify(
        await getUKPartyLeadershipCollection(world.db).findOne({ _id: `UK:${world.partySeq}` })
      )
    ).toBe(leadershipBefore);
  });

  it("heals a crash on the platform upsert with exactly one platform row", async () => {
    const world = await seedWorld();
    const doc = await seedVoted(world);
    const faultDb = withCollectionFaults(world.db, [
      { collection: "ukPartyPlatforms", method: "updateOne" },
    ]);
    await expect(
      resolveConference(faultDb, "UK", world.party, doc, doc.votingClosesTurn, NOW())
    ).rejects.toThrow("injected");
    const mid = (await getConference(world.db, "UK", world.partySeq, 1))!;
    expect(mid.outcome).toBe("ratified");
    expect(await getUKPartyPlatformsCollection(world.db).find({}).toArray()).toHaveLength(0);

    await resolveConference(world.db, "UK", world.party, mid, mid.votingClosesTurn, NOW());
    const rows = await getUKPartyPlatformsCollection(world.db).find({}).toArray();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.ratifiedConferenceId).toBe(mid._id);
  });

  it("elects a single winner under concurrent resolvers", async () => {
    const world = await seedWorld();
    const { doc, motionId } = await seedVotedWithMotion(world);
    const [first, second] = await Promise.all([
      resolveConference(world.db, "UK", world.party, doc, doc.votingClosesTurn, NOW()),
      resolveConference(world.db, "UK", world.party, doc, doc.votingClosesTurn, NOW()),
    ]);
    expect([first.completed, second.completed].filter(Boolean)).toHaveLength(1);
    const after = (await getConference(world.db, "UK", world.partySeq, 1))!;
    expect(after.outcome).toBe("ratified");
    expect(after.appliedMotionIds).toEqual([motionId]);
    expect(await getUKPartyPlatformsCollection(world.db).find({}).toArray()).toHaveLength(1);
    const leadership = await getUKPartyLeadershipCollection(world.db).findOne({
      _id: `UK:${world.partySeq}`,
    });
    expect(leadership?.appliedConferenceMotionIds).toEqual([motionId]);
    expect(leadership?.history?.filter((h) => h.detail.includes(motionId))).toHaveLength(1);
  });
});

describe("applyConferencePayoff crash recovery", () => {
  async function seedCompleted(world: SeedWorld) {
    await seedOpenConference(world, TURN_YEAR1_OPEN);
    await proposePlatform(
      world.db,
      "UK",
      world.partySeq,
      world.leader.actor,
      validPledgeIds(),
      TURN_YEAR1_OPEN,
      NOW()
    );
    const voters = [...world.members, ...world.committee];
    for (let i = 0; i < 5; i++) {
      await voteOnPlatform(
        world.db,
        "UK",
        world.partySeq,
        voters[i].actor,
        "aye",
        TURN_YEAR1_OPEN,
        NOW()
      );
    }
    const doc = await getConference(world.db, "UK", world.partySeq, 1);
    await resolveConference(world.db, "UK", world.party, doc!, doc!.votingClosesTurn, NOW());
    return (await getConference(world.db, "UK", world.partySeq, 1))!;
  }

  function expectedApprovalGroups(): string[] {
    const catalog = pledgeCatalogFor("UK");
    const salience = new Map(catalog.map((e) => [e.id, Object.keys(e.salienceByGroup ?? {})]));
    return payoffGroupsForPledges(validPledgeIds(), salience);
  }

  async function partyPs(db: Db, party: SeedWorld["party"]): Promise<number> {
    const row = await db.collection("politicalParties").findOne({ _id: party._id });
    return row?.politicalStrength as number;
  }

  it("resumes a legacy claimed-but-unapplied payoff exactly once", async () => {
    const world = await seedWorld();
    const completed = await seedCompleted(world);
    // The old claim shape: applied turn stamped, no intent or receipts.
    await getUKPartyConferencesCollection(world.db).updateOne(
      { _id: completed._id },
      { $set: { payoffAppliedTurn: TURN_YEAR1_OPEN + 20 } }
    );
    const stuck = (await getConference(world.db, "UK", world.partySeq, 1))!;
    expect(conferencePayoffNeedsSettle(stuck)).toBe(true);

    const payoff = await applyConferencePayoff(
      world.db,
      "UK",
      world.party,
      stuck,
      TURN_YEAR1_OPEN + 20,
      NOW()
    );
    expect(payoff).toMatchObject({ applied: true, cohesionPs: CONFERENCE_COHESION_PS });
    expect(await partyPs(world.db, world.party)).toBe(CONFERENCE_COHESION_PS);
    const after = (await getConference(world.db, "UK", world.partySeq, 1))!;
    expect(after.payoffSettledTurn).not.toBeNull();

    const retry = await applyConferencePayoff(
      world.db,
      "UK",
      world.party,
      after,
      TURN_YEAR1_OPEN + 21,
      NOW()
    );
    expect(retry.applied).toBe(false);
    expect(await partyPs(world.db, world.party)).toBe(CONFERENCE_COHESION_PS);
  });

  it("survives a crash mid-approval-rows with no duplicates and one credit", async () => {
    process.env.UK_CONFERENCE_PAYOFF = "1";
    try {
      const expected = expectedApprovalGroups();
      expect(expected.length).toBeGreaterThan(0);
      const world = await seedWorld();
      const completed = await seedCompleted(world);
      const faultDb = withCollectionFaults(world.db, [
        { collection: "partyGroupFavorability", method: "updateOne" },
      ]);
      await expect(
        applyConferencePayoff(faultDb, "UK", world.party, completed, TURN_YEAR1_OPEN + 20, NOW())
      ).rejects.toThrow("injected");

      const mid = (await getConference(world.db, "UK", world.partySeq, 1))!;
      expect(mid.payoffAppliedTurn).not.toBeNull();
      expect(mid.payoffSettledTurn).toBeNull();
      expect(await partyPs(world.db, world.party)).toBe(0);

      const payoff = await applyConferencePayoff(
        world.db,
        "UK",
        world.party,
        mid,
        TURN_YEAR1_OPEN + 20,
        NOW()
      );
      expect(payoff).toMatchObject({ applied: true, approvalGroups: expected.length });
      const rows = await world.db.collection("partyGroupFavorability").find({}).toArray();
      expect(rows.map((r) => r.groupId).sort()).toEqual([...expected].sort());
      expect(await partyPs(world.db, world.party)).toBe(CONFERENCE_COHESION_PS);

      const retry = await applyConferencePayoff(
        world.db,
        "UK",
        world.party,
        (await getConference(world.db, "UK", world.partySeq, 1))!,
        TURN_YEAR1_OPEN + 21,
        NOW()
      );
      expect(retry.applied).toBe(false);
      expect(await world.db.collection("partyGroupFavorability").find({}).toArray()).toHaveLength(
        expected.length
      );
    } finally {
      delete process.env.UK_CONFERENCE_PAYOFF;
    }
  });

  it("credits cohesion exactly once across a crash on the party write", async () => {
    const world = await seedWorld();
    const completed = await seedCompleted(world);
    const faultDb = withCollectionFaults(world.db, [
      {
        collection: "politicalParties",
        method: "updateOne",
        match: (args) => "$inc" in (args[1] as Record<string, unknown>),
      },
    ]);
    await expect(
      applyConferencePayoff(faultDb, "UK", world.party, completed, TURN_YEAR1_OPEN + 20, NOW())
    ).rejects.toThrow("injected");
    expect(await partyPs(world.db, world.party)).toBe(0);

    const payoff = await applyConferencePayoff(
      world.db,
      "UK",
      world.party,
      (await getConference(world.db, "UK", world.partySeq, 1))!,
      TURN_YEAR1_OPEN + 20,
      NOW()
    );
    expect(payoff).toMatchObject({ applied: true, cohesionPs: CONFERENCE_COHESION_PS });
    expect(await partyPs(world.db, world.party)).toBe(CONFERENCE_COHESION_PS);
    const party = await world.db.collection("politicalParties").findOne({ _id: world.party._id });
    expect(party?.lastConferencePayoffId).toBe(completed._id);
  });

  it("settles without re-crediting when the party receipt already exists", async () => {
    const world = await seedWorld();
    const completed = await seedCompleted(world);
    // Crash between the party credit and the settle write: receipt on the
    // party, no settle marker on the conference.
    await getUKPartyConferencesCollection(world.db).updateOne(
      { _id: completed._id },
      {
        $set: {
          payoffAppliedTurn: TURN_YEAR1_OPEN + 20,
          payoffCohesionPs: CONFERENCE_COHESION_PS,
          payoffApprovalGroups: [],
        },
      }
    );
    await world.db.collection("politicalParties").updateOne(
      { _id: world.party._id },
      {
        $inc: { politicalStrength: CONFERENCE_COHESION_PS },
        $set: { lastConferencePayoffId: completed._id },
      }
    );
    const payoff = await applyConferencePayoff(
      world.db,
      "UK",
      world.party,
      (await getConference(world.db, "UK", world.partySeq, 1))!,
      TURN_YEAR1_OPEN + 20,
      NOW()
    );
    expect(payoff).toMatchObject({ applied: true, cohesionPs: CONFERENCE_COHESION_PS });
    expect(await partyPs(world.db, world.party)).toBe(CONFERENCE_COHESION_PS);
  });

  it("survives a crash on the settle write with no duplicate economics", async () => {
    const world = await seedWorld();
    const completed = await seedCompleted(world);
    const faultDb = withCollectionFaults(world.db, [
      {
        collection: "ukPartyConferences",
        method: "findOneAndUpdate",
        match: (args) => "payoffSettledTurn" in (args[0] as Record<string, unknown>),
      },
    ]);
    await expect(
      applyConferencePayoff(faultDb, "UK", world.party, completed, TURN_YEAR1_OPEN + 20, NOW())
    ).rejects.toThrow("injected");
    // Effects landed; only the settle marker is missing.
    expect(await partyPs(world.db, world.party)).toBe(CONFERENCE_COHESION_PS);

    const payoff = await applyConferencePayoff(
      world.db,
      "UK",
      world.party,
      (await getConference(world.db, "UK", world.partySeq, 1))!,
      TURN_YEAR1_OPEN + 20,
      NOW()
    );
    expect(payoff.applied).toBe(true);
    expect(await partyPs(world.db, world.party)).toBe(CONFERENCE_COHESION_PS);
  });

  it("credits once under concurrent payoff callers", async () => {
    const world = await seedWorld();
    const completed = await seedCompleted(world);
    const [first, second] = await Promise.all([
      applyConferencePayoff(world.db, "UK", world.party, completed, TURN_YEAR1_OPEN + 20, NOW()),
      applyConferencePayoff(world.db, "UK", world.party, completed, TURN_YEAR1_OPEN + 20, NOW()),
    ]);
    expect([first.applied, second.applied].filter(Boolean)).toHaveLength(1);
    expect(await partyPs(world.db, world.party)).toBe(CONFERENCE_COHESION_PS);
  });
});

describe("conference eligible-roll freeze", () => {
  async function seedOpenWithProposal(world: SeedWorld) {
    await seedOpenConference(world, TURN_YEAR1_OPEN);
    await proposePlatform(
      world.db,
      "UK",
      world.partySeq,
      world.leader.actor,
      validPledgeIds(),
      TURN_YEAR1_OPEN,
      NOW()
    );
  }

  async function seedOpenWithMotion(world: SeedWorld) {
    await seedOpenConference(world, TURN_YEAR1_OPEN);
    const { motionId } = await proposeRulesMotion(
      world.db,
      "UK",
      world.partySeq,
      world.committee[0].actor,
      { triggerThresholdPct: 0.2 },
      TURN_YEAR1_OPEN,
      NOW()
    );
    return motionId;
  }

  async function addMember(world: SeedWorld, name: string): Promise<SeedMember> {
    const id = new ObjectId();
    await world.db.collection("characters").insertOne({
      _id: id,
      name,
      party: world.partySeq,
      userId: new ObjectId(),
    });
    return { id, name, actor: { _id: id, name, party: world.partySeq } };
  }

  async function readProposal(world: SeedWorld) {
    return (await getConference(world.db, "UK", world.partySeq, 1))?.proposal;
  }

  it("freezes the member and committee rolls on first proposal", async () => {
    const world = await seedWorld();
    await seedOpenConference(world, TURN_YEAR1_OPEN);
    // Reads never freeze: a pure view sees live counts and no roll.
    const before = await getConferenceState(
      world.db,
      "UK",
      world.partySeq,
      1,
      world.members[0].actor,
      TURN_YEAR1_OPEN,
      NOW()
    );
    expect(before.rollFrozen).toBe(false);
    expect(before.proposal).toBeNull();
    expect(before.capabilities.canVote).toBe(true);

    await proposePlatform(
      world.db,
      "UK",
      world.partySeq,
      world.leader.actor,
      validPledgeIds(),
      TURN_YEAR1_OPEN,
      NOW()
    );
    const doc = await getConference(world.db, "UK", world.partySeq, 1);
    // Leader + 3 committee + 4 members on the platform roll; committee +
    // chair on the motion roll.
    expect(doc?.eligibleMemberIds?.sort()).toEqual(
      [world.leader, ...world.committee, ...world.members].map((m) => m.id.toString()).sort()
    );
    expect(doc?.eligibleCommitteeIds?.sort()).toEqual(
      [world.leader, ...world.committee].map((m) => m.id.toString()).sort()
    );
    const after = await getConferenceState(
      world.db,
      "UK",
      world.partySeq,
      1,
      world.members[0].actor,
      TURN_YEAR1_OPEN,
      NOW()
    );
    expect(after.rollFrozen).toBe(true);
    expect(after.proposal?.eligibleVoters).toBe(8);
    expect(after.proposal?.quorumNeeded).toBe(3);
    expect(after.capabilities.canVote).toBe(true);
  });

  it("rejects platform ballots from members who join after the freeze", async () => {
    const world = await seedWorld();
    await seedOpenWithProposal(world);
    const joiner = await addMember(world, "Joiner June");
    await expectApiError(
      voteOnPlatform(world.db, "UK", world.partySeq, joiner.actor, "aye", TURN_YEAR1_OPEN, NOW()),
      403
    );
    // No ballot seated, no tally moved.
    expect(await readProposal(world)).toMatchObject({ votesFor: 0, votesAgainst: 0, votes: {} });
    // The UI contract says the same thing: a member with no roll seat.
    const view = await getConferenceState(
      world.db,
      "UK",
      world.partySeq,
      1,
      joiner.actor,
      TURN_YEAR1_OPEN,
      NOW()
    );
    expect(view.rollFrozen).toBe(true);
    expect(view.proposal?.eligibleVoters).toBe(8);
    expect(view.proposal?.quorumNeeded).toBe(3);
    expect(view.capabilities.isPartyMember).toBe(true);
    expect(view.capabilities.canVote).toBe(false);
  });

  it("lets removals end voting but keeps cast ballots and the frozen quorum", async () => {
    const world = await seedWorld();
    await seedOpenWithProposal(world);
    for (const voter of world.members.slice(0, 3)) {
      await voteOnPlatform(
        world.db,
        "UK",
        world.partySeq,
        voter.actor,
        "aye",
        TURN_YEAR1_OPEN,
        NOW()
      );
    }
    // All three voters leave mid-conference.
    for (const voter of world.members.slice(0, 3)) {
      await world.db
        .collection("characters")
        .updateOne({ _id: voter.id }, { $set: { party: "99" } });
    }
    // No new or changed ballots after leaving ...
    await expectApiError(
      voteOnPlatform(
        world.db,
        "UK",
        world.partySeq,
        world.members[0].actor,
        "nay",
        TURN_YEAR1_OPEN,
        NOW()
      ),
      403
    );
    // ... but the ballots cast while eligible stand.
    expect(await readProposal(world)).toMatchObject({ votesFor: 3, votesAgainst: 0 });
    // Quorum still measures the frozen roll of 8 (bar 3), not the 5 who are
    // left: the 3 standing ayes ratify.
    const doc = await getConference(world.db, "UK", world.partySeq, 1);
    const resolution = await resolveConference(
      world.db,
      "UK",
      world.party,
      doc!,
      doc!.votingClosesTurn,
      NOW()
    );
    expect(resolution).toMatchObject({ completed: true, ratified: true });
  });

  it("rejects motion ballots from committee seated after the freeze", async () => {
    const world = await seedWorld();
    const motionId = await seedOpenWithMotion(world);
    const joiner = await addMember(world, "Joiner June");
    await world.db
      .collection("politicalParties")
      .updateOne(
        { _id: world.party._id },
        { $set: { committeeIds: [...world.committee.map((m) => m.id), joiner.id] } }
      );
    // Live committee check passes, frozen roll check refuses.
    await expectApiError(
      voteOnMotion(
        world.db,
        "UK",
        world.partySeq,
        motionId,
        joiner.actor,
        "aye",
        TURN_YEAR1_OPEN,
        NOW()
      ),
      403
    );
    const doc = await getConference(world.db, "UK", world.partySeq, 1);
    const motion = doc?.motions.find((m) => m.motionId === motionId);
    expect(motion).toMatchObject({ votesFor: 0, votesAgainst: 0, votes: {} });
  });

  it("lands a deferred motion write cast while eligible, then rejects the next vote after removal", async () => {
    const world = await seedWorld();
    const motionId = await seedOpenWithMotion(world);
    const collName = "ukPartyConferences";
    const inner = world.db.collection(collName) as unknown as {
      updateOne: (
        filter: unknown,
        update: unknown,
        opts?: unknown
      ) => Promise<{ matchedCount: number; modifiedCount: number }>;
    };
    const recorded: Array<{ filter: unknown; update: unknown }> = [];
    let deferNextWrite = true;
    const racingDb = {
      ...world.db,
      collection: (name: string) => {
        const innerColl = world.db.collection(name);
        if (name !== collName) return innerColl;
        return {
          ...innerColl,
          updateOne: async (filter: unknown, update: unknown, opts?: unknown) => {
            if (deferNextWrite) {
              deferNextWrite = false;
              recorded.push({ filter, update });
              return { matchedCount: 1, modifiedCount: 1 };
            }
            return inner.updateOne(filter, update, opts);
          },
        };
      },
    } as unknown as Db;
    // A's ballot is cast (pre-checks pass) but its write is deferred. B votes
    // for real in the meantime, then A is removed from the committee.
    const aVote = voteOnMotion(
      racingDb,
      "UK",
      world.partySeq,
      motionId,
      world.committee[0].actor,
      "aye",
      TURN_YEAR1_OPEN,
      NOW()
    );
    const bVote = await voteOnMotion(
      world.db,
      "UK",
      world.partySeq,
      motionId,
      world.committee[1].actor,
      "nay",
      TURN_YEAR1_OPEN,
      NOW()
    );
    expect(bVote).toMatchObject({ votesFor: 0, votesAgainst: 1 });
    await world.db
      .collection("politicalParties")
      .updateOne(
        { _id: world.party._id },
        { $set: { committeeIds: world.committee.slice(1).map((m) => m.id) } }
      );
    expect((await aVote).success).toBe(true);
    expect(recorded).toHaveLength(1);
    // The deferred write lands against the immutable roll: a ballot cast
    // while eligible is not unseated by a later removal.
    await inner.updateOne(recorded[0].filter, recorded[0].update);
    const doc = await getConference(world.db, "UK", world.partySeq, 1);
    const motion = doc?.motions.find((m) => m.motionId === motionId);
    expect(motion).toMatchObject({ votesFor: 1, votesAgainst: 1 });
    // But no NEW ballot after the removal.
    await expectApiError(
      voteOnMotion(
        world.db,
        "UK",
        world.partySeq,
        motionId,
        world.committee[0].actor,
        "nay",
        TURN_YEAR1_OPEN,
        NOW()
      ),
      403
    );
  });

  it("converges deferred platform writes without clobbering", async () => {
    const world = await seedWorld();
    await seedOpenWithProposal(world);
    const collName = "ukPartyConferences";
    const inner = world.db.collection(collName) as unknown as {
      updateOne: (
        filter: unknown,
        update: unknown,
        opts?: unknown
      ) => Promise<{ matchedCount: number; modifiedCount: number }>;
    };
    const recorded: Array<{ filter: unknown; update: unknown }> = [];
    let deferNextWrite = true;
    const racingDb = {
      ...world.db,
      collection: (name: string) => {
        const innerColl = world.db.collection(name);
        if (name !== collName) return innerColl;
        return {
          ...innerColl,
          updateOne: async (filter: unknown, update: unknown, opts?: unknown) => {
            if (deferNextWrite) {
              deferNextWrite = false;
              recorded.push({ filter, update });
              return { matchedCount: 1, modifiedCount: 1 };
            }
            return inner.updateOne(filter, update, opts);
          },
        };
      },
    } as unknown as Db;
    const aVote = voteOnPlatform(
      racingDb,
      "UK",
      world.partySeq,
      world.members[0].actor,
      "aye",
      TURN_YEAR1_OPEN,
      NOW()
    );
    const bVote = await voteOnPlatform(
      world.db,
      "UK",
      world.partySeq,
      world.members[1].actor,
      "nay",
      TURN_YEAR1_OPEN,
      NOW()
    );
    expect(bVote).toMatchObject({ votesFor: 0, votesAgainst: 1 });
    expect((await aVote).success).toBe(true);
    expect(recorded).toHaveLength(1);
    await inner.updateOne(recorded[0].filter, recorded[0].update);
    expect(await readProposal(world)).toMatchObject({ votesFor: 1, votesAgainst: 1 });
  });

  it("decides quorum from the frozen roll when joins inflate live membership", async () => {
    const world = await seedWorld();
    await seedOpenConference(world, TURN_YEAR1_OPEN);
    // Six members leave before the first touch: the roll freezes at 2
    // (leader + one member), so the quorum bar is 2, not 3.
    for (const gone of [...world.committee, ...world.members.slice(1)]) {
      await world.db.collection("characters").deleteOne({ _id: gone.id });
    }
    await proposePlatform(
      world.db,
      "UK",
      world.partySeq,
      world.leader.actor,
      validPledgeIds(),
      TURN_YEAR1_OPEN,
      NOW()
    );
    await voteOnPlatform(
      world.db,
      "UK",
      world.partySeq,
      world.leader.actor,
      "aye",
      TURN_YEAR1_OPEN,
      NOW()
    );
    await voteOnPlatform(
      world.db,
      "UK",
      world.partySeq,
      world.members[0].actor,
      "aye",
      TURN_YEAR1_OPEN,
      NOW()
    );
    // Five members join mid-conference: live membership is 7 (bar 3), but
    // the frozen bar stays 2 and the joiners get no ballot here.
    const joiners: SeedMember[] = [];
    for (let i = 0; i < 5; i++) joiners.push(await addMember(world, `Joiner ${i}`));
    await expectApiError(
      voteOnPlatform(
        world.db,
        "UK",
        world.partySeq,
        joiners[0].actor,
        "aye",
        TURN_YEAR1_OPEN,
        NOW()
      ),
      403
    );
    const joinerView = await getConferenceState(
      world.db,
      "UK",
      world.partySeq,
      1,
      joiners[0].actor,
      TURN_YEAR1_OPEN,
      NOW()
    );
    expect(joinerView.capabilities.canVote).toBe(false);
    const doc = await getConference(world.db, "UK", world.partySeq, 1);
    expect(doc?.eligibleMemberIds).toHaveLength(2);
    const resolution = await resolveConference(
      world.db,
      "UK",
      world.party,
      doc!,
      doc!.votingClosesTurn,
      NOW()
    );
    expect(resolution).toMatchObject({ completed: true, ratified: true });
  });

  it("backfills legacy rows missing any snapshot on vote and on fill", async () => {
    // A pre-freeze row: agenda touches happened, but the roll fields were
    // never stamped (missing, not null).
    const voted = await seedWorld();
    await seedOpenWithProposal(voted);
    await voteOnPlatform(
      voted.db,
      "UK",
      voted.partySeq,
      voted.members[0].actor,
      "aye",
      TURN_YEAR1_OPEN,
      NOW()
    );
    await getUKPartyConferencesCollection(voted.db).updateOne(
      { _id: conferenceDocId("UK", voted.partySeq, 1) },
      { $unset: { eligibleMemberIds: "", eligibleCommitteeIds: "" } }
    );
    const legacy = await getConference(voted.db, "UK", voted.partySeq, 1);
    expect(legacy?.eligibleMemberIds).toBeUndefined();
    expect(legacy?.eligibleCommitteeIds).toBeUndefined();
    // The next vote freezes the roll from live membership, then seats.
    const second = await voteOnPlatform(
      voted.db,
      "UK",
      voted.partySeq,
      voted.members[1].actor,
      "aye",
      TURN_YEAR1_OPEN,
      NOW()
    );
    expect(second).toMatchObject({ votesFor: 2, votesAgainst: 0 });
    expect(
      (await getConference(voted.db, "UK", voted.partySeq, 1))?.eligibleMemberIds
    ).toHaveLength(8);

    // A legacy claimed-but-unfilled row with votes and no roll: the fill
    // freezes before deciding, then resolves exactly like a frozen row.
    const stuck = await seedWorld();
    await seedOpenWithProposal(stuck);
    for (let i = 0; i < 5; i++) {
      await voteOnPlatform(
        stuck.db,
        "UK",
        stuck.partySeq,
        [stuck.leader, ...stuck.committee, ...stuck.members][i].actor,
        "aye",
        TURN_YEAR1_OPEN,
        NOW()
      );
    }
    await getUKPartyConferencesCollection(stuck.db).updateOne(
      { _id: conferenceDocId("UK", stuck.partySeq, 1) },
      {
        $set: { status: "completed" },
        $unset: { eligibleMemberIds: "", eligibleCommitteeIds: "" },
      }
    );
    const frozen = (await getConference(stuck.db, "UK", stuck.partySeq, 1))!;
    expect(frozen).toMatchObject({ status: "completed", outcome: null });
    const resolution = await resolveConference(
      stuck.db,
      "UK",
      stuck.party,
      frozen,
      frozen.votingClosesTurn,
      NOW()
    );
    expect(resolution).toMatchObject({ completed: true, ratified: true });
    expect(
      (await getConference(stuck.db, "UK", stuck.partySeq, 1))?.eligibleMemberIds
    ).toHaveLength(8);
  });

  it("rejects platform votes after the window closes without writing", async () => {
    const world = await seedWorld();
    await seedOpenWithProposal(world);
    await voteOnPlatform(
      world.db,
      "UK",
      world.partySeq,
      world.members[0].actor,
      "aye",
      TURN_YEAR1_OPEN,
      NOW()
    );
    const doc = await getConference(world.db, "UK", world.partySeq, 1);
    await expectApiError(
      voteOnPlatform(
        world.db,
        "UK",
        world.partySeq,
        world.members[1].actor,
        "aye",
        doc!.votingClosesTurn,
        NOW()
      ),
      400
    );
    expect(await readProposal(world)).toMatchObject({ votesFor: 1, votesAgainst: 0 });
    expect((await readProposal(world))?.votes[world.members[1].id.toString()]).toBeUndefined();
  });
});

describe("conference leadership-cooldown serialization", () => {
  const PATCH_A = { triggerThresholdPct: 0.2 };
  const PATCH_B = { removalMajorityPct: 0.6 };

  /** Two committee motions with disjoint patches, both voted to pass. */
  async function seedTwoPassingMotions(world: SeedWorld) {
    await seedOpenConference(world, TURN_YEAR1_OPEN);
    const first = await proposeRulesMotion(
      world.db,
      "UK",
      world.partySeq,
      world.committee[0].actor,
      PATCH_A,
      TURN_YEAR1_OPEN,
      NOW()
    );
    const second = await proposeRulesMotion(
      world.db,
      "UK",
      world.partySeq,
      world.committee[0].actor,
      PATCH_B,
      TURN_YEAR1_OPEN,
      NOW()
    );
    for (const motionId of [first.motionId, second.motionId]) {
      for (const member of world.committee) {
        await voteOnMotion(
          world.db,
          "UK",
          world.partySeq,
          motionId,
          member.actor,
          "aye",
          TURN_YEAR1_OPEN,
          NOW()
        );
      }
    }
    return { motionA: first.motionId, motionB: second.motionId };
  }

  async function readLeadership(world: SeedWorld) {
    return getUKPartyLeadershipCollection(world.db).findOne({ _id: `UK:${world.partySeq}` });
  }

  /**
   * Force the stale-read overlap a naive Promise.all can hide: the first
   * leadership motion-apply write waits until both applies have read, so both
   * decide from the same lastAmendedTurn however the microtasks interleave.
   * Without the cooldown-conditional write both patches land; with it exactly
   * one wins and the loser voids.
   */
  function gateFirstLeadershipApply(db: Db): Db {
    let reads = 0;
    let release: (() => void) | null = null;
    const bothRead = new Promise<void>((resolve) => {
      release = resolve;
    });
    let gated = false;
    const innerCollection = (name: string) =>
      db.collection(name) as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>;
    return {
      ...db,
      collection: (name: string) => {
        const inner = innerCollection(name);
        if (name !== "ukPartyLeadership") return inner;
        return {
          ...inner,
          findOne: async (...args: unknown[]) => {
            try {
              return await (inner.findOne as (...a: unknown[]) => Promise<unknown>)(...args);
            } finally {
              reads += 1;
              if (reads >= 2) release?.();
            }
          },
          updateOne: async (...args: unknown[]) => {
            if (!gated && "$push" in (args[1] as Record<string, unknown>)) {
              gated = true;
              await bothRead;
            }
            return (inner.updateOne as (...a: unknown[]) => Promise<unknown>)(...args);
          },
        };
      },
    } as unknown as Db;
  }

  /**
   * Hold a direct ruleset amendment until a conference motion apply has
   * executed, so the amendment's cooldown read is stale however the
   * microtasks interleave. Exactly one of the two must win.
   */
  function gateAmendUntilMotionWrite(db: Db): Db {
    let motionWrote = false;
    let release: (() => void) | null = null;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const innerCollection = (name: string) =>
      db.collection(name) as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>;
    return {
      ...db,
      collection: (name: string) => {
        const inner = innerCollection(name);
        if (name !== "ukPartyLeadership") return inner;
        return {
          ...inner,
          updateOne: async (...args: unknown[]) => {
            const update = args[1] as Record<string, unknown>;
            if ("$push" in update) {
              const out = await (inner.updateOne as (...a: unknown[]) => Promise<unknown>)(...args);
              motionWrote = true;
              release?.();
              return out;
            }
            if ("ruleset" in ((update.$set ?? {}) as Record<string, unknown>) && !motionWrote) {
              await gate;
            }
            return (inner.updateOne as (...a: unknown[]) => Promise<unknown>)(...args);
          },
        };
      },
    } as unknown as Db;
  }

  /** Exactly one patch won: the ruleset carries one motion's patch, not both. */
  function expectSinglePatchWinner(
    ruleset: { triggerThresholdPct?: number; removalMajorityPct?: number } | undefined,
    winner: string,
    motionA: string
  ) {
    const aWon = winner === motionA;
    expect(ruleset?.triggerThresholdPct).toBe(aWon ? 0.2 : 0.15);
    expect(ruleset?.removalMajorityPct).toBe(aWon ? 0.5 : 0.6);
  }

  it("serializes two concurrent passed motions: one applies, the other voids on cooldown", async () => {
    const world = await seedWorld();
    const { motionA, motionB } = await seedTwoPassingMotions(world);
    const doc = (await getConference(world.db, "UK", world.partySeq, 1))!;
    const resolution = await resolveConference(
      gateFirstLeadershipApply(world.db),
      "UK",
      world.party,
      doc,
      doc.votingClosesTurn,
      NOW()
    );
    expect(resolution).toMatchObject({ completed: true, motionsPassed: 1, motionsVoided: 1 });

    const after = (await getConference(world.db, "UK", world.partySeq, 1))!;
    expect(after.appliedMotionIds).toHaveLength(1);
    const winner = after.appliedMotionIds![0];
    const loser = winner === motionA ? motionB : motionA;
    expect(after.motions.find((m) => m.motionId === winner)?.status).toBe("passed");
    const loserMotion = after.motions.find((m) => m.motionId === loser);
    expect(loserMotion?.status).toBe("void");
    expect(loserMotion?.voidReason).toContain("cooldown");

    const leadership = await readLeadership(world);
    expect(leadership?.appliedConferenceMotionIds).toEqual([winner]);
    expectSinglePatchWinner(leadership?.ruleset, winner, motionA);
  });

  it("converges concurrent resolvers on one winner with agreeing receipts", async () => {
    const world = await seedWorld();
    const { motionA, motionB } = await seedTwoPassingMotions(world);
    const doc = (await getConference(world.db, "UK", world.partySeq, 1))!;
    const [first, second] = await Promise.all([
      resolveConference(world.db, "UK", world.party, doc, doc.votingClosesTurn, NOW()),
      resolveConference(world.db, "UK", world.party, doc, doc.votingClosesTurn, NOW()),
    ]);
    expect([first.completed, second.completed].filter(Boolean)).toHaveLength(1);

    // A heal pass converges the marks instead of flapping them.
    const mid = (await getConference(world.db, "UK", world.partySeq, 1))!;
    const heal = await resolveConference(
      world.db,
      "UK",
      world.party,
      mid,
      mid.votingClosesTurn,
      NOW()
    );
    expect(heal.completed).toBe(false);
    const after = (await getConference(world.db, "UK", world.partySeq, 1))!;
    expect(after.appliedMotionIds).toHaveLength(1);
    const winner = after.appliedMotionIds![0];
    const loser = winner === motionA ? motionB : motionA;
    expect(after.motions.find((m) => m.motionId === winner)?.status).toBe("passed");
    expect(after.motions.find((m) => m.motionId === loser)?.status).toBe("void");

    const leadership = await readLeadership(world);
    expect(leadership?.appliedConferenceMotionIds).toEqual(after.appliedMotionIds);
    expectSinglePatchWinner(leadership?.ruleset, winner, motionA);
  });

  it("replays an applied motion exactly once across heal passes", async () => {
    const world = await seedWorld();
    await seedOpenConference(world, TURN_YEAR1_OPEN);
    const { motionId } = await proposeRulesMotion(
      world.db,
      "UK",
      world.partySeq,
      world.committee[0].actor,
      PATCH_A,
      TURN_YEAR1_OPEN,
      NOW()
    );
    for (const member of world.committee) {
      await voteOnMotion(
        world.db,
        "UK",
        world.partySeq,
        motionId,
        member.actor,
        "aye",
        TURN_YEAR1_OPEN,
        NOW()
      );
    }
    const doc = (await getConference(world.db, "UK", world.partySeq, 1))!;
    const first = await resolveConference(
      world.db,
      "UK",
      world.party,
      doc,
      doc.votingClosesTurn,
      NOW()
    );
    expect(first).toMatchObject({ completed: true, motionsPassed: 1 });
    expect((await getConference(world.db, "UK", world.partySeq, 1))?.appliedMotionIds).toEqual([
      motionId,
    ]);
    const leadershipBefore = JSON.stringify(await readLeadership(world));

    for (let i = 0; i < 2; i++) {
      const retry = await resolveConference(
        world.db,
        "UK",
        world.party,
        (await getConference(world.db, "UK", world.partySeq, 1))!,
        doc.votingClosesTurn,
        NOW()
      );
      expect(retry).toMatchObject({ completed: false, ratified: false });
    }
    const after = (await getConference(world.db, "UK", world.partySeq, 1))!;
    expect(after.appliedMotionIds).toEqual([motionId]);
    expect(JSON.stringify(await readLeadership(world))).toBe(leadershipBefore);
  });

  it("applies at the cooldown boundary: the first motion wins, the second voids", async () => {
    const world = await seedWorld();
    await seedTwoPassingMotions(world);
    const doc = (await getConference(world.db, "UK", world.partySeq, 1))!;
    // Amended exactly COOLDOWN turns ago: the window has lapsed, so the first
    // motion applies; the second then voids on the fresh cooldown.
    await getOrSeedPartyLeadership(world.db, "UK", world.party, NOW(), TURN_YEAR1_OPEN);
    await getUKPartyLeadershipCollection(world.db).updateOne(
      { _id: `UK:${world.partySeq}` },
      { $set: { lastAmendedTurn: doc.votingClosesTurn - LEADERSHIP_AMENDMENT_COOLDOWN_TURNS } }
    );
    const resolution = await resolveConference(
      world.db,
      "UK",
      world.party,
      doc,
      doc.votingClosesTurn,
      NOW()
    );
    expect(resolution).toMatchObject({ motionsPassed: 1, motionsVoided: 1 });
    expect((await readLeadership(world))?.lastAmendedTurn).toBe(doc.votingClosesTurn);
  });

  it("voids a motion amended one turn inside the cooldown window", async () => {
    const world = await seedWorld();
    await seedTwoPassingMotions(world);
    const doc = (await getConference(world.db, "UK", world.partySeq, 1))!;
    await getOrSeedPartyLeadership(world.db, "UK", world.party, NOW(), TURN_YEAR1_OPEN);
    await getUKPartyLeadershipCollection(world.db).updateOne(
      { _id: `UK:${world.partySeq}` },
      { $set: { lastAmendedTurn: doc.votingClosesTurn - LEADERSHIP_AMENDMENT_COOLDOWN_TURNS + 1 } }
    );
    const resolution = await resolveConference(
      world.db,
      "UK",
      world.party,
      doc,
      doc.votingClosesTurn,
      NOW()
    );
    expect(resolution).toMatchObject({ motionsPassed: 0, motionsVoided: 2 });
    const after = (await getConference(world.db, "UK", world.partySeq, 1))!;
    expect(after.appliedMotionIds ?? []).toHaveLength(0);
    expect((await readLeadership(world))?.appliedConferenceMotionIds ?? []).toHaveLength(0);
  });

  it("applies onto a legacy leadership row missing receipts and cooldown fields", async () => {
    const world = await seedWorld();
    await seedTwoPassingMotions(world);
    const doc = (await getConference(world.db, "UK", world.partySeq, 1))!;
    await getOrSeedPartyLeadership(world.db, "UK", world.party, NOW(), TURN_YEAR1_OPEN);
    await getUKPartyLeadershipCollection(world.db).updateOne(
      { _id: `UK:${world.partySeq}` },
      { $unset: { appliedConferenceMotionIds: "", lastAmendedTurn: "" } }
    );
    // Legacy conference marks missing too: the reconcile must still converge.
    await getUKPartyConferencesCollection(world.db).updateOne(
      { _id: doc._id },
      { $unset: { appliedMotionIds: "", platformAppliedTurn: "" } }
    );
    const resolution = await resolveConference(
      world.db,
      "UK",
      world.party,
      (await getConference(world.db, "UK", world.partySeq, 1))!,
      doc.votingClosesTurn,
      NOW()
    );
    expect(resolution).toMatchObject({ motionsPassed: 1, motionsVoided: 1 });
    const after = (await getConference(world.db, "UK", world.partySeq, 1))!;
    expect(after.appliedMotionIds).toHaveLength(1);
    const winner = after.appliedMotionIds![0];
    const leadership = await readLeadership(world);
    expect(leadership?.appliedConferenceMotionIds).toEqual([winner]);
    expect(leadership?.lastAmendedTurn).toBe(doc.votingClosesTurn);
    expect(after.appliedMotionIds).toEqual([winner]);
  });

  it("keeps terminal void and failed motions terminal across retries", async () => {
    const world = await seedWorld();
    await seedOpenConference(world, TURN_YEAR1_OPEN);
    const passing = await proposeRulesMotion(
      world.db,
      "UK",
      world.partySeq,
      world.committee[0].actor,
      PATCH_A,
      TURN_YEAR1_OPEN,
      NOW()
    );
    const failing = await proposeRulesMotion(
      world.db,
      "UK",
      world.partySeq,
      world.committee[0].actor,
      PATCH_B,
      TURN_YEAR1_OPEN,
      NOW()
    );
    for (const member of world.committee) {
      await voteOnMotion(
        world.db,
        "UK",
        world.partySeq,
        passing.motionId,
        member.actor,
        "aye",
        TURN_YEAR1_OPEN,
        NOW()
      );
    }
    await voteOnMotion(
      world.db,
      "UK",
      world.partySeq,
      failing.motionId,
      world.committee[0].actor,
      "aye",
      TURN_YEAR1_OPEN,
      NOW()
    );
    await voteOnMotion(
      world.db,
      "UK",
      world.partySeq,
      failing.motionId,
      world.committee[1].actor,
      "nay",
      TURN_YEAR1_OPEN,
      NOW()
    );
    await voteOnMotion(
      world.db,
      "UK",
      world.partySeq,
      failing.motionId,
      world.committee[2].actor,
      "nay",
      TURN_YEAR1_OPEN,
      NOW()
    );
    // A direct amendment voids the passing motion at resolve; the failing
    // motion fails on its votes.
    const { amendLeadershipRules } = await import("../leadership/leadershipCommands");
    await amendLeadershipRules(
      world.db,
      "UK",
      world.partySeq,
      world.committee[0].actor,
      { survivalImmunityTurns: 10 },
      TURN_YEAR1_OPEN,
      NOW()
    );
    const doc = (await getConference(world.db, "UK", world.partySeq, 1))!;
    const first = await resolveConference(
      world.db,
      "UK",
      world.party,
      doc,
      doc.votingClosesTurn,
      NOW()
    );
    expect(first).toMatchObject({ motionsPassed: 0, motionsVoided: 1 });
    const terminal = (await getConference(world.db, "UK", world.partySeq, 1))!;
    expect(terminal.motions.find((m) => m.motionId === passing.motionId)?.status).toBe("void");
    expect(terminal.motions.find((m) => m.motionId === failing.motionId)?.status).toBe("failed");
    const leadershipBefore = JSON.stringify(await readLeadership(world));

    const retry = await resolveConference(
      world.db,
      "UK",
      world.party,
      terminal,
      terminal.votingClosesTurn,
      NOW()
    );
    expect(retry).toMatchObject({ completed: false, motionsPassed: 0, motionsVoided: 0 });
    const after = (await getConference(world.db, "UK", world.partySeq, 1))!;
    expect(after.motions.find((m) => m.motionId === passing.motionId)?.status).toBe("void");
    expect(after.motions.find((m) => m.motionId === failing.motionId)?.status).toBe("failed");
    expect(JSON.stringify(await readLeadership(world))).toBe(leadershipBefore);
  });

  it("heals a crash on the conference mark write without double-applying", async () => {
    const world = await seedWorld();
    const { motionA } = await seedTwoPassingMotions(world);
    const doc = (await getConference(world.db, "UK", world.partySeq, 1))!;
    const faultDb = withCollectionFaults(world.db, [
      {
        collection: "ukPartyConferences",
        method: "updateOne",
        match: (args) =>
          "appliedMotionIds" in
          ((args[1] as Record<string, unknown>).$set as Record<string, unknown>),
      },
    ]);
    await expect(
      resolveConference(faultDb, "UK", world.party, doc, doc.votingClosesTurn, NOW())
    ).rejects.toThrow("injected");

    // The leadership effect is durable; only the conference marks are missing.
    const mid = (await getConference(world.db, "UK", world.partySeq, 1))!;
    expect(mid.outcome).not.toBeNull();
    expect(mid.appliedMotionIds ?? []).toHaveLength(0);
    const leadershipMid = await readLeadership(world);
    expect(leadershipMid?.appliedConferenceMotionIds).toEqual([motionA]);

    const heal = await resolveConference(
      world.db,
      "UK",
      world.party,
      mid,
      mid.votingClosesTurn,
      NOW()
    );
    expect(heal.completed).toBe(false);
    const after = (await getConference(world.db, "UK", world.partySeq, 1))!;
    expect(after.appliedMotionIds).toEqual([motionA]);
    const leadership = await readLeadership(world);
    expect(leadership?.appliedConferenceMotionIds).toEqual([motionA]);
    expect(leadership?.history?.filter((h) => h.detail.includes(motionA))).toHaveLength(1);
  });

  it("lets exactly one of a racing direct amendment and motion win", async () => {
    const world = await seedWorld();
    await seedOpenConference(world, TURN_YEAR1_OPEN);
    const { motionId } = await proposeRulesMotion(
      world.db,
      "UK",
      world.partySeq,
      world.committee[0].actor,
      PATCH_A,
      TURN_YEAR1_OPEN,
      NOW()
    );
    for (const member of world.committee) {
      await voteOnMotion(
        world.db,
        "UK",
        world.partySeq,
        motionId,
        member.actor,
        "aye",
        TURN_YEAR1_OPEN,
        NOW()
      );
    }
    const doc = (await getConference(world.db, "UK", world.partySeq, 1))!;
    const gated = gateAmendUntilMotionWrite(world.db);
    const { amendLeadershipRules } = await import("../leadership/leadershipCommands");
    const [resolved, amended] = await Promise.all([
      resolveConference(gated, "UK", world.party, doc, doc.votingClosesTurn, NOW()),
      amendLeadershipRules(
        gated,
        "UK",
        world.partySeq,
        world.committee[0].actor,
        { survivalImmunityTurns: 10 },
        doc.votingClosesTurn,
        NOW()
      ).then(
        () => ({ won: true as const }),
        () => ({ won: false as const })
      ),
    ]);
    const motionApplied = resolved.motionsPassed === 1;
    // Exactly one writer owns the cooldown window.
    expect(motionApplied !== amended.won).toBe(true);
    const leadership = await readLeadership(world);
    if (motionApplied) {
      expect(leadership?.ruleset?.triggerThresholdPct).toBe(0.2);
      expect(leadership?.ruleset?.survivalImmunityTurns).toBe(48);
      expect(leadership?.appliedConferenceMotionIds).toEqual([motionId]);
    } else {
      expect(resolved.motionsVoided).toBe(1);
      expect(leadership?.ruleset?.survivalImmunityTurns).toBe(10);
      expect(leadership?.ruleset?.triggerThresholdPct).toBe(0.15);
      expect(leadership?.appliedConferenceMotionIds ?? []).toHaveLength(0);
    }
  });
});

describe("receipt/void crash-concurrency micro-window", () => {
  const RACE_PATCH = { triggerThresholdPct: 0.2 };

  async function seedRatifiedWithMotion(world: SeedWorld) {
    await seedOpenConference(world, TURN_YEAR1_OPEN);
    await proposePlatform(
      world.db,
      "UK",
      world.partySeq,
      world.leader.actor,
      validPledgeIds(),
      TURN_YEAR1_OPEN,
      NOW()
    );
    const voters = [...world.members, ...world.committee, world.leader];
    for (let i = 0; i < 5; i++) {
      await voteOnPlatform(
        world.db,
        "UK",
        world.partySeq,
        voters[i].actor,
        "aye",
        TURN_YEAR1_OPEN,
        NOW()
      );
    }
    const { motionId } = await proposeRulesMotion(
      world.db,
      "UK",
      world.partySeq,
      world.committee[0].actor,
      RACE_PATCH,
      TURN_YEAR1_OPEN,
      NOW()
    );
    for (const member of world.committee) {
      await voteOnMotion(
        world.db,
        "UK",
        world.partySeq,
        motionId,
        member.actor,
        "aye",
        TURN_YEAR1_OPEN,
        NOW()
      );
    }
    return { doc: (await getConference(world.db, "UK", world.partySeq, 1))!, motionId };
  }

  async function readMotionLeadership(world: SeedWorld) {
    return getUKPartyLeadershipCollection(world.db).findOne({ _id: `UK:${world.partySeq}` });
  }

  /**
   * Gate the loser's reconcile pass through the exact micro-window: its
   * first receipt write parks until the first concurrent mover lands, its
   * second receipt write parks until the second mover lands (so both
   * conditional writes miss while every read stays pre-winner), and its
   * conference mark write parks until the winner has crashed. Progress is
   * signaled with promises, never sleeps, so the interleaving is
   * deterministic however microtasks interleave.
   */
  function gateReceiptVoidWindow(db: Db) {
    let pushes = 0;
    let markReleased = false;
    let resolveW0!: () => void;
    let resolveW0Parked!: () => void;
    let resolveW1!: () => void;
    let resolveW1Parked!: () => void;
    let resolveMark!: () => void;
    let resolveMarkParked!: () => void;
    const w0Gate = new Promise<void>((r) => {
      resolveW0 = r;
    });
    const w0Parked = new Promise<void>((r) => {
      resolveW0Parked = r;
    });
    const w1Gate = new Promise<void>((r) => {
      resolveW1 = r;
    });
    const w1Parked = new Promise<void>((r) => {
      resolveW1Parked = r;
    });
    const markGate = new Promise<void>((r) => {
      resolveMark = r;
    });
    const markParked = new Promise<void>((r) => {
      resolveMarkParked = r;
    });
    const innerCollection = (name: string) =>
      db.collection(name) as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>;
    const gated = {
      ...db,
      collection: (name: string) => {
        const inner = innerCollection(name);
        if (name === "ukPartyLeadership") {
          return {
            ...inner,
            updateOne: async (...args: unknown[]) => {
              if ("$push" in (args[1] as Record<string, unknown>)) {
                pushes += 1;
                if (pushes === 1) {
                  resolveW0Parked();
                  await w0Gate;
                } else if (pushes === 2) {
                  resolveW1Parked();
                  await w1Gate;
                }
              }
              return (inner.updateOne as (...a: unknown[]) => Promise<unknown>)(...args);
            },
          };
        }
        if (name === "ukPartyConferences") {
          return {
            ...inner,
            updateOne: async (...args: unknown[]) => {
              const set = ((args[1] as Record<string, unknown>).$set ?? {}) as Record<
                string,
                unknown
              >;
              if ("appliedMotionIds" in set && !markReleased) {
                resolveMarkParked();
                await markGate;
              }
              return (inner.updateOne as (...a: unknown[]) => Promise<unknown>)(...args);
            },
          };
        }
        return inner;
      },
    } as unknown as Db;
    return {
      db: gated,
      parked: { w0: w0Parked, w1: w1Parked, mark: markParked },
      releaseW0: () => {
        resolveW0();
      },
      releaseW1: () => {
        resolveW1();
      },
      releaseMark: () => {
        markReleased = true;
        resolveMark();
      },
    };
  }

  it("never leaves a void label over a completed receipt across a crash", async () => {
    const world = await seedWorld();
    const { doc, motionId } = await seedRatifiedWithMotion(world);
    const closeTurn = doc.votingClosesTurn;
    const moverTurn = closeTurn - LEADERSHIP_AMENDMENT_COOLDOWN_TURNS;

    // Setup: drive claim + fill, crashing only the leadership receipt
    // write, so the row is decided with the motion merely passed.
    const setupFaultDb = withCollectionFaults(world.db, [
      {
        collection: "ukPartyLeadership",
        method: "updateOne",
        match: (args) => "$push" in (args[1] as Record<string, unknown>),
      },
    ]);
    await expect(
      resolveConference(setupFaultDb, "UK", world.party, doc, closeTurn, NOW())
    ).rejects.toThrow("injected");
    const decided = (await getConference(world.db, "UK", world.partySeq, 1))!;
    expect(decided.outcome).not.toBeNull();
    expect(decided.motions.find((m) => m.motionId === motionId)?.status).toBe("passed");

    // Park the cooldown far outside the window; the first mover below then
    // moves it to the boundary without tripping it.
    await getUKPartyLeadershipCollection(world.db).updateOne(
      { _id: `UK:${world.partySeq}` },
      { $set: { lastAmendedTurn: moverTurn - LEADERSHIP_AMENDMENT_COOLDOWN_TURNS - 1 } }
    );

    // The loser starts its reconcile pass and parks at its first receipt
    // write, holding a stale pre-mover snapshot.
    const gate = gateReceiptVoidWindow(world.db);
    const loser = resolveConference(gate.db, "UK", world.party, decided, closeTurn, NOW());
    await gate.parked.w0;

    // First concurrent mover: a real direct amendment to the cooldown
    // boundary. The loser's first write now misses on the moved cooldown.
    const { amendLeadershipRules } = await import("../leadership/leadershipCommands");
    await amendLeadershipRules(
      world.db,
      "UK",
      world.partySeq,
      world.committee[0].actor,
      { survivalImmunityTurns: 10 },
      moverTurn,
      NOW()
    );
    gate.releaseW0();
    // The loser's second attempt re-reads pre-winner (boundary, no
    // cooldown) and parks at its second receipt write.
    await gate.parked.w1;

    // Second concurrent mover: the cooldown moves again (same shape as a
    // racing amendment with a stale read), so the loser's second write
    // misses too and its final confirmation read still sees no receipt.
    await getUKPartyLeadershipCollection(world.db).updateOne(
      { _id: `UK:${world.partySeq}` },
      { $set: { lastAmendedTurn: moverTurn - 1 } }
    );
    gate.releaseW1();
    // The loser now computes its void and parks at the conference mark.
    await gate.parked.mark;

    // The winner applies the same motion for real (cooldown is clear at its
    // stale-but-valid snapshot) and crashes on its conference mark write:
    // the receipt is durable, the row is unmarked.
    const winnerFaultDb = withCollectionFaults(world.db, [
      {
        collection: "ukPartyConferences",
        method: "updateOne",
        match: (args) =>
          "appliedMotionIds" in
          ((args[1] as Record<string, unknown>).$set as Record<string, unknown>),
      },
    ]);
    await expect(
      resolveConference(winnerFaultDb, "UK", world.party, decided, closeTurn, NOW())
    ).rejects.toThrow("injected");
    gate.releaseMark();
    await expect(loser).resolves.toMatchObject({ completed: false });

    // The exact window footprint: a durable void label over a completed
    // receipt, with no applied mark.
    const mislabeled = (await getConference(world.db, "UK", world.partySeq, 1))!;
    const mislabeledMotion = mislabeled.motions.find((m) => m.motionId === motionId)!;
    expect(mislabeledMotion.status).toBe("void");
    expect(mislabeledMotion.voidReason).toBe(CONFERENCE_RACE_VOID_REASON);
    expect(mislabeled.appliedMotionIds ?? []).toEqual([]);
    const leadership = await readMotionLeadership(world);
    expect(leadership?.appliedConferenceMotionIds).toEqual([motionId]);
    expect(leadership?.ruleset?.triggerThresholdPct).toBe(0.2);
    expect(leadership?.history?.filter((h) => h.detail.includes(motionId))).toHaveLength(1);

    // The row stays heal-owed from persisted evidence alone: no explicit
    // resolve call is needed for the driver to revisit it.
    expect(conferenceResolutionNeedsHeal(mislabeled)).toBe(true);

    // The heal adopts the receipt: passed + marked, without re-applying.
    const heal = await resolveConference(world.db, "UK", world.party, mislabeled, closeTurn, NOW());
    expect(heal).toMatchObject({ completed: false });
    const healed = (await getConference(world.db, "UK", world.partySeq, 1))!;
    expect(healed.motions.find((m) => m.motionId === motionId)?.status).toBe("passed");
    expect(healed.motions.find((m) => m.motionId === motionId)?.voidReason).toBeNull();
    expect(healed.appliedMotionIds).toEqual([motionId]);
    expect(conferenceResolutionNeedsHeal(healed)).toBe(false);
    const leadershipAfter = await readMotionLeadership(world);
    expect(leadershipAfter?.ruleset?.triggerThresholdPct).toBe(0.2);
    expect(leadershipAfter?.appliedConferenceMotionIds).toEqual([motionId]);
    expect(leadershipAfter?.history?.filter((h) => h.detail.includes(motionId))).toHaveLength(1);

    // Bounded: a further pass is a quiet no-op.
    const quiet = await resolveConference(world.db, "UK", world.party, healed, closeTurn, NOW());
    expect(quiet).toMatchObject({ completed: false, motionsPassed: 0, motionsVoided: 0 });
    expect((await getConference(world.db, "UK", world.partySeq, 1))?.appliedMotionIds).toEqual([
      motionId,
    ]);
    expect(JSON.stringify(await readMotionLeadership(world))).toBe(JSON.stringify(leadershipAfter));

    // No extra payoff from any heal: still owed, nothing credited, then the
    // payoff settles exactly once through its own receipted path.
    expect(conferencePayoffNeedsSettle(healed)).toBe(true);
    expect(await world.db.collection("partyGroupFavorability").find({}).toArray()).toHaveLength(0);
    // findOne returns a live reference in the fake db, so snapshot the
    // number before the payoff mutates the stored row in place.
    const psBefore = (
      await world.db.collection("politicalParties").findOne({ _id: world.party._id })
    )?.politicalStrength as number;
    const payoff = await applyConferencePayoff(
      world.db,
      "UK",
      world.party,
      healed,
      closeTurn,
      NOW()
    );
    expect(payoff.applied).toBe(true);
    const paidOnce = await world.db
      .collection("politicalParties")
      .findOne({ _id: world.party._id });
    expect(paidOnce?.politicalStrength).toBeGreaterThan(psBefore);
    const payoffAgain = await applyConferencePayoff(
      world.db,
      "UK",
      world.party,
      (await getConference(world.db, "UK", world.partySeq, 1))!,
      closeTurn,
      NOW()
    );
    expect(payoffAgain.applied).toBe(false);
    expect(
      (await world.db.collection("politicalParties").findOne({ _id: world.party._id }))
        ?.politicalStrength
    ).toBe(paidOnce?.politicalStrength);
  });

  it("confirms an unreceipted pending race void terminal on one revisit, then goes quiet", async () => {
    const world = await seedWorld();
    const { doc, motionId } = await seedRatifiedWithMotion(world);
    const closeTurn = doc.votingClosesTurn;
    // A direct amendment voids the motion on the cooldown path first.
    const { amendLeadershipRules } = await import("../leadership/leadershipCommands");
    await amendLeadershipRules(
      world.db,
      "UK",
      world.partySeq,
      world.committee[0].actor,
      { survivalImmunityTurns: 10 },
      closeTurn,
      NOW()
    );
    const first = await resolveConference(world.db, "UK", world.party, doc, closeTurn, NOW());
    expect(first).toMatchObject({ motionsPassed: 0, motionsVoided: 1 });
    // A legacy pending row carries the same race string with no receipt
    // behind it (written before confirmation existed).
    await getUKPartyConferencesCollection(world.db).updateOne(
      { _id: doc._id },
      { $set: { "motions.0.status": "void", "motions.0.voidReason": CONFERENCE_RACE_VOID_REASON } }
    );
    const legacy = (await getConference(world.db, "UK", world.partySeq, 1))!;
    expect(legacy.motions.find((m) => m.motionId === motionId)?.voidReason).toBe(
      CONFERENCE_RACE_VOID_REASON
    );
    expect((await readMotionLeadership(world))?.appliedConferenceMotionIds ?? []).toHaveLength(0);

    // The legacy row recovers through the heal gate: one revisit confirms
    // it terminal, and the row goes quiet afterwards.
    expect(conferenceResolutionNeedsHeal(legacy)).toBe(true);
    const heal = await resolveConference(world.db, "UK", world.party, legacy, closeTurn, NOW());
    expect(heal).toMatchObject({ completed: false });
    const confirmed = (await getConference(world.db, "UK", world.partySeq, 1))!;
    expect(confirmed.motions.find((m) => m.motionId === motionId)?.status).toBe("void");
    expect(confirmed.motions.find((m) => m.motionId === motionId)?.voidReason).toBe(
      CONFERENCE_RACE_VOID_CONFIRMED
    );
    expect(conferenceResolutionNeedsHeal(confirmed)).toBe(false);

    const leadershipBefore = JSON.stringify(await readMotionLeadership(world));
    const quiet = await resolveConference(world.db, "UK", world.party, confirmed, closeTurn, NOW());
    expect(quiet).toMatchObject({ completed: false, motionsPassed: 0, motionsVoided: 0 });
    expect(
      (await getConference(world.db, "UK", world.partySeq, 1))?.motions.find(
        (m) => m.motionId === motionId
      )?.voidReason
    ).toBe(CONFERENCE_RACE_VOID_CONFIRMED);
    expect(JSON.stringify(await readMotionLeadership(world))).toBe(leadershipBefore);
  });
});
