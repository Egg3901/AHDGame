import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import {
  applyConferencePayoff,
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
} from "./rules";
import { createFakeLeadershipDb } from "../leadership/leadershipTestDb";
import { buildEmbeddedVoteTallyUpdate } from "@/lib/votes/embeddedVoteTally";
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
