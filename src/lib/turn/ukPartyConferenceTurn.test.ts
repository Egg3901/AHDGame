import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { processUkPartyConferenceTurn } from "./ukPartyConferenceTurn";
import { createFakeLeadershipDb } from "@/lib/uk/leadership/leadershipTestDb";
import { getOrSeedConference } from "@/lib/uk/conference/conferenceStore";
import {
  getUKPartyConferencesCollection,
  getUKPartyPlatformsCollection,
} from "@/lib/db/collections/ukPartyConferences";
import {
  conferenceOpensAtTurn,
  conferenceVotingClosesTurn,
  conferenceYearStartTurn,
} from "@/lib/uk/conference/rules";
import { pledgeCatalogFor } from "@/lib/uk/manifesto/pledgeCatalog";
import type { PoliticalParty } from "@/lib/db/types";

vi.mock("@/lib/notifications", () => ({ createNotification: vi.fn(async () => undefined) }));
vi.mock("@/lib/news", () => ({ createSystemNewsPost: vi.fn(async () => undefined) }));

const NOW = () => new Date("2026-09-17T00:00:00Z");
const YEAR1_START = conferenceYearStartTurn(1);
const YEAR1_OPEN = conferenceOpensAtTurn(1);
const YEAR1_CLOSE = conferenceVotingClosesTurn(YEAR1_OPEN);
const YEAR2_START = conferenceYearStartTurn(2);

interface DriverWorld {
  db: Db;
  party: PoliticalParty;
  partySeq: string;
  leaderId: ObjectId;
  memberIds: ObjectId[];
}

async function seedParty(
  db: Db,
  opts: { seq: number; name: string; chairless?: boolean; country?: string; members?: number }
): Promise<DriverWorld> {
  const partySeq = String(opts.seq);
  const country = opts.country ?? "UK";
  const leaderId = new ObjectId();
  const memberIds: ObjectId[] = [];
  const memberCount = opts.members ?? 4;

  await db.collection("characters").insertOne({
    _id: leaderId,
    name: "Leader Lex",
    party: partySeq,
    userId: new ObjectId(),
  });
  for (let i = 0; i < memberCount; i++) {
    const id = new ObjectId();
    memberIds.push(id);
    await db.collection("characters").insertOne({
      _id: id,
      name: `Member ${i}`,
      party: partySeq,
      userId: new ObjectId(),
    });
  }

  const party = {
    _id: new ObjectId(),
    sequentialId: opts.seq,
    countryId: country,
    name: opts.name,
    abbreviation: opts.name.slice(0, 3).toUpperCase(),
    economicPosition: 2,
    socialPosition: 2,
    chairId: opts.chairless ? null : leaderId,
    viceChairId: null,
    treasurerId: null,
    committeeIds: [],
    isDefault: true,
    politicalStrength: 0,
    createdAt: NOW(),
    updatedAt: NOW(),
  } as unknown as PoliticalParty;
  await db.collection("politicalParties").insertOne({ ...party });
  return { db, party, partySeq, leaderId, memberIds };
}

async function castAyes(db: Db, partySeq: string, voterIds: ObjectId[], turn: number) {
  const { proposePlatform, voteOnPlatform } =
    await import("@/lib/uk/conference/conferenceCommands");
  const party = (await db
    .collection("politicalParties")
    .findOne({ countryId: "UK", sequentialId: Number(partySeq) })) as PoliticalParty;
  const leader = await db
    .collection("characters")
    .findOne({ _id: (party.chairId ?? voterIds[0]) as ObjectId });
  const ids = pledgeCatalogFor("UK")
    .slice(0, 3)
    .map((e) => e.id);
  const proposer = {
    _id: leader!._id as ObjectId,
    name: leader!.name as string,
    party: partySeq,
  };
  // A bare-member electorate cannot propose; run the motion through the
  // committee path by seating the first voter as chair-adjacent leadership.
  await db
    .collection("politicalParties")
    .updateOne({ _id: party._id }, { $set: { chairId: proposer._id } });
  await proposePlatform(db, "UK", partySeq, proposer, ids, turn, NOW());
  for (const voterId of voterIds) {
    const voter = (await db.collection("characters").findOne({ _id: voterId }))!;
    await voteOnPlatform(
      db,
      "UK",
      partySeq,
      { _id: voter._id as ObjectId, name: voter.name as string, party: partySeq },
      "aye",
      turn,
      NOW()
    );
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.UK_CONFERENCE_PAYOFF;
});

describe("processUkPartyConferenceTurn", () => {
  it("schedules at the year's first turn and opens at the opening turn", async () => {
    const db = createFakeLeadershipDb();
    await seedParty(db, { seq: 2, name: "Conservative Party" });

    const seeded = await processUkPartyConferenceTurn(db, YEAR1_START, NOW());
    expect(seeded).toMatchObject({ scheduled: 1, opened: 0 });

    const before = await processUkPartyConferenceTurn(db, YEAR1_OPEN - 1, NOW());
    expect(before.opened).toBe(0);

    const opened = await processUkPartyConferenceTurn(db, YEAR1_OPEN, NOW());
    expect(opened).toMatchObject({ opened: 1 });
    const doc = await getUKPartyConferencesCollection(db).findOne({ _id: "UK:2:1" });
    expect(doc?.status).toBe("open");
  });

  it("is idempotent: a same-turn retry schedules and opens nothing new", async () => {
    const db = createFakeLeadershipDb();
    await seedParty(db, { seq: 2, name: "Conservative Party" });
    await processUkPartyConferenceTurn(db, YEAR1_START, NOW());
    const retry = await processUkPartyConferenceTurn(db, YEAR1_START, NOW());
    expect(retry).toMatchObject({ scheduled: 0, opened: 0 });
  });

  it("runs parties simultaneously and independently", async () => {
    const db = createFakeLeadershipDb();
    await seedParty(db, { seq: 2, name: "Conservative Party" });
    await seedParty(db, { seq: 3, name: "Labour Party" });
    const result = await processUkPartyConferenceTurn(db, YEAR1_START, NOW());
    expect(result.scheduled).toBe(2);
    const opened = await processUkPartyConferenceTurn(db, YEAR1_OPEN, NOW());
    expect(opened.opened).toBe(2);
  });

  it("leaves non-UK parties alone: no rows, zero telemetry", async () => {
    const db = createFakeLeadershipDb();
    await seedParty(db, { seq: 2, name: "American Party", country: "US" });
    const result = await processUkPartyConferenceTurn(db, YEAR1_OPEN, NOW());
    expect(result).toMatchObject({ scheduled: 0, opened: 0, completed: 0, payoffs: 0 });
    expect(await getUKPartyConferencesCollection(db).find({}).toArray()).toHaveLength(0);
  });

  it("completes a voted conference at close, ratifies, and pays off exactly once", async () => {
    const db = createFakeLeadershipDb();
    const world = await seedParty(db, { seq: 2, name: "Conservative Party", members: 5 });
    await processUkPartyConferenceTurn(db, YEAR1_START, NOW());
    await processUkPartyConferenceTurn(db, YEAR1_OPEN, NOW());
    await castAyes(db, world.partySeq, world.memberIds.slice(0, 4), YEAR1_OPEN);

    const closed = await processUkPartyConferenceTurn(db, YEAR1_CLOSE, NOW());
    expect(closed).toMatchObject({ completed: 1, ratified: 1, payoffs: 1 });
    const { createSystemNewsPost } = await import("@/lib/news");
    expect(vi.mocked(createSystemNewsPost)).toHaveBeenCalledTimes(1);

    const party = await db.collection("politicalParties").findOne({ _id: world.party._id });
    expect(party?.politicalStrength).toBe(30);

    // Retry after completion: no duplicate resolution, no duplicate payoff.
    const retry = await processUkPartyConferenceTurn(db, YEAR1_CLOSE, NOW());
    expect(retry).toMatchObject({ completed: 0, payoffs: 0 });
    const partyAgain = await db.collection("politicalParties").findOne({ _id: world.party._id });
    expect(partyAgain?.politicalStrength).toBe(30);
  });

  it("completes an unvoted conference without ratification or payoff", async () => {
    const db = createFakeLeadershipDb();
    await seedParty(db, { seq: 2, name: "Conservative Party" });
    await processUkPartyConferenceTurn(db, YEAR1_START, NOW());
    await processUkPartyConferenceTurn(db, YEAR1_OPEN, NOW());
    const closed = await processUkPartyConferenceTurn(db, YEAR1_CLOSE, NOW());
    expect(closed).toMatchObject({ completed: 1, ratified: 0, payoffs: 0 });
    const doc = await getUKPartyConferencesCollection(db).findOne({ _id: "UK:2:1" });
    expect(doc?.outcome).toBe("closedWithoutRatification");
    expect(doc?.payoffDue).toBe(false);
  });

  it("expires conferences a past year left behind, with no payoff", async () => {
    const db = createFakeLeadershipDb();
    await seedParty(db, { seq: 2, name: "Conservative Party" });
    await processUkPartyConferenceTurn(db, YEAR1_START, NOW());
    // Never opened or resolved in year 1; the year-2 driver expires it.
    const rolled = await processUkPartyConferenceTurn(db, YEAR2_START, NOW());
    expect(rolled.expired).toBe(1);
    const stale = await getUKPartyConferencesCollection(db).findOne({ _id: "UK:2:1" });
    expect(stale?.status).toBe("expired");
    expect(stale?.outcome).toBe("missed");
    // And the new year's row is seeded independently.
    expect(await getUKPartyConferencesCollection(db).findOne({ _id: "UK:2:2" })).not.toBeNull();
  });

  it("acclaims NPP platforms with no player votes", async () => {
    const db = createFakeLeadershipDb();
    await seedParty(db, { seq: 7, name: "AI Party", chairless: true, members: 0 });
    await processUkPartyConferenceTurn(db, YEAR1_START, NOW());
    await processUkPartyConferenceTurn(db, YEAR1_OPEN, NOW());
    const closed = await processUkPartyConferenceTurn(db, YEAR1_CLOSE, NOW());
    expect(closed).toMatchObject({ completed: 1, ratified: 1, payoffs: 1 });
    const platform = await getUKPartyPlatformsCollection(db).findOne({ _id: "UK:7" });
    expect(platform?.pledgeIds).toHaveLength(3);
  });

  it("does not expire a past-year conference whose voting window is still open", async () => {
    const db = createFakeLeadershipDb();
    const world = await seedParty(db, { seq: 2, name: "Conservative Party" });
    // Legacy spilled row (pre-dates the schedule guard): opened late in
    // year 1 with a window closing on turn 59, flipped open like the driver
    // would once its opening turn passes.
    await getOrSeedConference(db, "UK", world.party, 1, 41, 59, NOW(), 40);
    await getUKPartyConferencesCollection(db).updateOne(
      { _id: "UK:2:1" },
      { $set: { status: "open", openedAtTurn: 41 } }
    );
    const rolled = await processUkPartyConferenceTurn(db, YEAR2_START, NOW());
    expect(rolled.expired).toBe(0);
    expect(await getUKPartyConferencesCollection(db).findOne({ _id: "UK:2:1" })).toMatchObject({
      status: "open",
    });
    // Once the window itself passes, the leftover row expires as missed.
    const late = await processUkPartyConferenceTurn(db, 60, NOW());
    expect(late.expired).toBe(1);
    expect(await getUKPartyConferencesCollection(db).findOne({ _id: "UK:2:1" })).toMatchObject({
      status: "expired",
      outcome: "missed",
    });
  });

  it("recovers a claimed-but-unfilled row on the next tick", async () => {
    const db = createFakeLeadershipDb();
    const world = await seedParty(db, { seq: 2, name: "Conservative Party", members: 5 });
    await processUkPartyConferenceTurn(db, YEAR1_START, NOW());
    await processUkPartyConferenceTurn(db, YEAR1_OPEN, NOW());
    await castAyes(db, world.partySeq, world.memberIds.slice(0, 4), YEAR1_OPEN);
    // Previous tick won the open->completed claim, then crashed pre-fill.
    await getUKPartyConferencesCollection(db).updateOne(
      { _id: "UK:2:1" },
      { $set: { status: "completed" } }
    );

    const closed = await processUkPartyConferenceTurn(db, YEAR1_CLOSE, NOW());
    expect(closed).toMatchObject({ completed: 1, ratified: 1, payoffs: 1 });
    const party = await db.collection("politicalParties").findOne({ _id: world.party._id });
    expect(party?.politicalStrength).toBe(30);

    const retry = await processUkPartyConferenceTurn(db, YEAR1_CLOSE, NOW());
    expect(retry).toMatchObject({ completed: 0, payoffs: 0 });
  });

  it("resumes an unsettled payoff on the next tick without re-resolving", async () => {
    const db = createFakeLeadershipDb();
    const world = await seedParty(db, { seq: 2, name: "Conservative Party", members: 5 });
    await processUkPartyConferenceTurn(db, YEAR1_START, NOW());
    await processUkPartyConferenceTurn(db, YEAR1_OPEN, NOW());
    await castAyes(db, world.partySeq, world.memberIds.slice(0, 4), YEAR1_OPEN);
    // Resolve outside the driver (fills + reconciles, leaves payoff owed).
    const { resolveConference } = await import("@/lib/uk/conference/conferenceCommands");
    const open = await getUKPartyConferencesCollection(db).findOne({ _id: "UK:2:1" });
    const party = (await db
      .collection("politicalParties")
      .findOne({ _id: world.party._id })) as PoliticalParty;
    const resolution = await resolveConference(db, "UK", party, open!, YEAR1_CLOSE, NOW());
    expect(resolution).toMatchObject({ completed: true, ratified: true });

    const closed = await processUkPartyConferenceTurn(db, YEAR1_CLOSE + 1, NOW());
    expect(closed).toMatchObject({ completed: 0, payoffs: 1 });
    const paid = await db.collection("politicalParties").findOne({ _id: world.party._id });
    expect(paid?.politicalStrength).toBe(30);
  });

  it("survives a news-post failure without duplicating resolution or payoff", async () => {
    const db = createFakeLeadershipDb();
    const world = await seedParty(db, { seq: 2, name: "Conservative Party", members: 5 });
    await processUkPartyConferenceTurn(db, YEAR1_START, NOW());
    await processUkPartyConferenceTurn(db, YEAR1_OPEN, NOW());
    await castAyes(db, world.partySeq, world.memberIds.slice(0, 4), YEAR1_OPEN);

    const { createSystemNewsPost } = await import("@/lib/news");
    vi.mocked(createSystemNewsPost).mockRejectedValueOnce(new Error("news down"));
    const closed = await processUkPartyConferenceTurn(db, YEAR1_CLOSE, NOW());
    expect(closed).toMatchObject({ completed: 1, ratified: 1, payoffs: 1 });
    const retry = await processUkPartyConferenceTurn(db, YEAR1_CLOSE, NOW());
    expect(retry).toMatchObject({ completed: 0, payoffs: 0 });
  });

  it("heals a receipt-covered race void on the next tick with no explicit resolve", async () => {
    const db = createFakeLeadershipDb();
    const world = await seedParty(db, { seq: 2, name: "Conservative Party", members: 5 });
    await processUkPartyConferenceTurn(db, YEAR1_START, NOW());
    await processUkPartyConferenceTurn(db, YEAR1_OPEN, NOW());

    // Seat the committee before the first agenda touch freezes the roll.
    const committeeIds: ObjectId[] = [];
    for (let i = 0; i < 3; i++) {
      const id = new ObjectId();
      committeeIds.push(id);
      await db.collection("characters").insertOne({
        _id: id,
        name: `Committee ${i}`,
        party: world.partySeq,
        userId: new ObjectId(),
      });
    }
    await db
      .collection("politicalParties")
      .updateOne({ _id: world.party._id }, { $set: { committeeIds } });
    await castAyes(db, world.partySeq, world.memberIds.slice(0, 4), YEAR1_OPEN);

    // Committee business: table a motion, carry it.
    const { proposeRulesMotion, voteOnMotion, CONFERENCE_RACE_VOID_REASON } =
      await import("@/lib/uk/conference/conferenceCommands");
    const { getUKPartyLeadershipCollection } =
      await import("@/lib/db/collections/ukPartyLeadership");
    const committeeActor = (id: ObjectId) => ({
      _id: id,
      name: "Committee",
      party: world.partySeq,
    });
    const { motionId } = await proposeRulesMotion(
      db,
      "UK",
      world.partySeq,
      committeeActor(committeeIds[0]!),
      { triggerThresholdPct: 0.2 },
      YEAR1_OPEN,
      NOW()
    );
    for (const id of committeeIds) {
      await voteOnMotion(
        db,
        "UK",
        world.partySeq,
        motionId,
        committeeActor(id),
        "aye",
        YEAR1_OPEN,
        NOW()
      );
    }

    // Close cleanly through the driver: motion applied + receipted, payoff settled.
    const closed = await processUkPartyConferenceTurn(db, YEAR1_CLOSE, NOW());
    expect(closed).toMatchObject({ completed: 1, ratified: 1, payoffs: 1 });

    // The micro-window's durable footprint, as if a racing reconciler voided
    // the motion after the winner's receipt landed and the winner crashed
    // before marking: void label + live receipt, no applied mark.
    const decided = (await getUKPartyConferencesCollection(db).findOne({ _id: "UK:2:1" }))!;
    const voidedMotions = decided.motions.map((motion) =>
      motion.motionId === motionId
        ? { ...motion, status: "void" as const, voidReason: CONFERENCE_RACE_VOID_REASON }
        : motion
    );
    await getUKPartyConferencesCollection(db).updateOne(
      { _id: "UK:2:1" },
      { $set: { motions: voidedMotions, appliedMotionIds: [] } }
    );

    // The next driver tick heals from persisted evidence alone: the motion
    // is passed and marked, the receipt is not double-applied, and the
    // already-settled payoff is untouched.
    const healedTick = await processUkPartyConferenceTurn(db, YEAR1_CLOSE, NOW());
    expect(healedTick).toMatchObject({ completed: 0, payoffs: 0 });
    const healed = await getUKPartyConferencesCollection(db).findOne({ _id: "UK:2:1" });
    expect(healed?.motions.find((m) => m.motionId === motionId)?.status).toBe("passed");
    expect(healed?.appliedMotionIds).toEqual([motionId]);
    const leadership = await getUKPartyLeadershipCollection(db).findOne({ _id: "UK:2" });
    expect(leadership?.appliedConferenceMotionIds).toEqual([motionId]);
    expect(
      leadership?.history?.filter((h) => (h.detail as string).includes(motionId))
    ).toHaveLength(1);
    const party = await db.collection("politicalParties").findOne({ _id: world.party._id });
    expect(party?.politicalStrength).toBe(30);

    const quiet = await processUkPartyConferenceTurn(db, YEAR1_CLOSE, NOW());
    expect(quiet).toMatchObject({ completed: 0, payoffs: 0 });
  });
});
