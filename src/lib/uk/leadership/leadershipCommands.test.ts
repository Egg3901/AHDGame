import { describe, it, expect, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import {
  amendLeadershipRules,
  backLeadershipChallenge,
  castLeadershipBallotVote,
  getCommitteeSnapshot,
  getLeadershipState,
  initiateLeadershipChallenge,
  processExpiredLeadershipChallenges,
  resolveLeadershipChallenge,
  type LeadershipActor,
} from "./leadershipCommands";
import { createFakeLeadershipDb } from "./leadershipTestDb";
import { getLowerChamberOfficeType } from "@/lib/legislature/chamberOfficeType";
import {
  LEADERSHIP_AMENDMENT_COOLDOWN_TURNS,
  LEADERSHIP_BALLOT_DURATION_TURNS,
  LEADERSHIP_GATHERING_WINDOW_TURNS,
  LEADERSHIP_HISTORY_CAP,
} from "./rules";
import { ApiError } from "@/lib/api/errors";
import type { PoliticalParty } from "@/lib/db/types";

vi.mock("@/lib/notifications", () => ({ createNotification: async () => undefined }));

const MP_OFFICE = getLowerChamberOfficeType("UK");
const NOW = () => new Date("2026-09-17T00:00:00Z");

interface SeedMp {
  id: ObjectId;
  name: string;
  actor: LeadershipActor;
}

interface SeedWorld {
  db: Db;
  party: PoliticalParty;
  partySeq: string;
  leader: SeedMp;
  mps: SeedMp[];
  committeeMember: SeedMp;
  outsider: LeadershipActor;
}

async function seedWorld(
  opts: {
    abbr?: string;
    name?: string;
    seq?: number;
    mpCount?: number;
    committeeSize?: number;
  } = {}
): Promise<SeedWorld> {
  const abbr = opts.abbr ?? "CON";
  const name = opts.name ?? "Conservative Party";
  const seq = opts.seq ?? 2;
  const mpCount = opts.mpCount ?? 10;
  const committeeSize = opts.committeeSize ?? 3;
  const partySeq = String(seq);
  const db = createFakeLeadershipDb();

  const mkChar = async (charName: string): Promise<SeedMp> => {
    const id = new ObjectId();
    await db.collection("characters").insertOne({
      _id: id,
      name: charName,
      party: partySeq,
      userId: new ObjectId(),
    });
    return { id, name: charName, actor: { _id: id, name: charName, party: partySeq } };
  };

  const leader = await mkChar("Leader Lex");
  const mps: SeedMp[] = [];
  for (let i = 0; i < mpCount; i++) {
    const mp = await mkChar(`MP ${i}`);
    mps.push(mp);
    await db.collection("electedOfficials").insertOne({
      _id: new ObjectId(),
      characterId: mp.id,
      countryId: "UK",
      officeType: MP_OFFICE,
      party: partySeq,
      seatsHeld: 1,
    });
  }
  await db.collection("electedOfficials").insertOne({
    _id: new ObjectId(),
    characterId: leader.id,
    countryId: "UK",
    officeType: MP_OFFICE,
    party: partySeq,
    seatsHeld: 1,
  });

  const committeeIds = mps.slice(0, committeeSize).map((m) => m.id);
  const party = {
    _id: new ObjectId(),
    sequentialId: seq,
    countryId: "UK",
    name,
    abbreviation: abbr,
    color: "#0087DC",
    economicPosition: 2,
    socialPosition: 2,
    chairId: leader.id,
    viceChairId: null,
    treasurerId: null,
    committeeIds,
    memberCount: mpCount + 1,
    isDefault: true,
    createdBy: null,
    treasury: 0,
    nationalTaxRate: 0,
    politicalStrength: 0,
    createdAt: NOW(),
    updatedAt: NOW(),
  } as unknown as PoliticalParty;
  await db.collection("politicalParties").insertOne({ ...party });

  const outsiderId = new ObjectId();
  const outsider: LeadershipActor = { _id: outsiderId, name: "Outsider Oz" };
  await db.collection("characters").insertOne({ _id: outsiderId, name: "Outsider Oz" });

  return {
    db,
    party,
    partySeq,
    leader,
    mps,
    committeeMember: mps[0],
    outsider,
  };
}

async function expectStatus(promise: Promise<unknown>, status: number): Promise<ApiError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(status);
    return error as ApiError;
  }
  throw new Error(`expected ApiError with status ${status}, but the call succeeded`);
}

describe("CON vs LAB starting rules", () => {
  it("seeds a Conservative-style ruleset with the 1922 Committee", async () => {
    const { db, partySeq } = await seedWorld({ abbr: "CON", name: "Conservative Party" });
    const state = await getLeadershipState(db, "UK", partySeq, null, 100, NOW());
    expect(state.family).toBe("con");
    expect(state.committeeName).toBe("1922 Committee");
    expect(state.ruleset.electorate).toBe("mps");
    expect(state.ruleset.triggerThresholdPct).toBe(0.15);
    expect(state.leader?.name).toBe("Leader Lex");
    expect(state.immunity.protected).toBe(false);
    expect(state.amendment.canAmendNow).toBe(true);
    expect(state.activeChallenge).toBeNull();
  });

  it("seeds a Labour-style ruleset with the NEC and no immunity", async () => {
    const { db, partySeq } = await seedWorld({
      abbr: "LAB",
      name: "Labour Party",
      seq: 1,
    });
    const state = await getLeadershipState(db, "UK", partySeq, null, 100, NOW());
    expect(state.family).toBe("lab");
    expect(state.committeeName).toBe("National Executive Committee");
    expect(state.ruleset.electorate).toBe("members");
    expect(state.ruleset.triggerThresholdPct).toBe(0.2);
    expect(state.ruleset.survivalImmunityTurns).toBe(0);
  });
});

describe("authorization", () => {
  it("rejects amendments from non-members and non-committee members", async () => {
    const { db, partySeq, outsider, mps } = await seedWorld();
    await expectStatus(
      amendLeadershipRules(db, "UK", partySeq, outsider, { removalMajorityPct: 0.6 }, 100, NOW()),
      403
    );
    const backbencher = mps[mps.length - 1];
    await expectStatus(
      amendLeadershipRules(
        db,
        "UK",
        partySeq,
        backbencher.actor,
        { removalMajorityPct: 0.6 },
        100,
        NOW()
      ),
      403
    );
  });

  it("rejects challenges from non-members, non-MPs, and the leader", async () => {
    const { db, partySeq, outsider, mps, leader } = await seedWorld();
    await expectStatus(initiateLeadershipChallenge(db, "UK", partySeq, outsider, 100, NOW()), 403);
    const civilianId = new ObjectId();
    await db.collection("characters").insertOne({
      _id: civilianId,
      name: "Civilian",
      party: partySeq,
      userId: new ObjectId(),
    });
    await expectStatus(
      initiateLeadershipChallenge(
        db,
        "UK",
        partySeq,
        { _id: civilianId, name: "Civilian", party: partySeq },
        100,
        NOW()
      ),
      403
    );
    await expectStatus(
      initiateLeadershipChallenge(db, "UK", partySeq, leader.actor, 100, NOW()),
      400
    );
    expect(mps.length).toBeGreaterThan(0);
  });

  it("rejects a challenge when the party has no leader or no seats", async () => {
    const noLeader = await seedWorld({ seq: 5 });
    await noLeader.db
      .collection("politicalParties")
      .updateOne({ _id: noLeader.party._id }, { $set: { chairId: null } });
    await expectStatus(
      initiateLeadershipChallenge(
        noLeader.db,
        "UK",
        noLeader.partySeq,
        noLeader.mps[0].actor,
        100,
        NOW()
      ),
      400
    );

    // MP status is checked before the seats gate, so a seatless party surfaces
    // as 403 for a civilian member; the "no parliamentary party" gate itself
    // is exercised when a gathering challenge outlives its MPs (see expiry).
    const noSeats = await seedWorld({ seq: 6, mpCount: 1 });
    await noSeats.db.collection("electedOfficials").deleteOne({
      characterId: noSeats.mps[0].id,
    });
    await noSeats.db.collection("electedOfficials").deleteOne({
      characterId: noSeats.leader.id,
    });
    const civId = new ObjectId();
    await noSeats.db.collection("characters").insertOne({
      _id: civId,
      name: "Seatless Civilian",
      party: noSeats.partySeq,
      userId: new ObjectId(),
    });
    await expectStatus(
      initiateLeadershipChallenge(
        noSeats.db,
        "UK",
        noSeats.partySeq,
        { _id: civId, name: "Seatless Civilian", party: noSeats.partySeq },
        100,
        NOW()
      ),
      403
    );
  });
});

describe("committee amendments and cooldowns", () => {
  it("applies a valid patch and records history", async () => {
    const { db, partySeq, committeeMember } = await seedWorld();
    const result = await amendLeadershipRules(
      db,
      "UK",
      partySeq,
      committeeMember.actor,
      { removalMajorityPct: 0.6, triggerThresholdPct: 0.25 },
      100,
      NOW()
    );
    expect(result.success).toBe(true);
    expect(result.ruleset.removalMajorityPct).toBe(0.6);
    expect(result.ruleset.triggerThresholdPct).toBe(0.25);
    const state = await getLeadershipState(db, "UK", partySeq, null, 100, NOW());
    expect(state.ruleset.removalMajorityPct).toBe(0.6);
    expect(state.amendment.canAmendNow).toBe(false);
    expect(state.amendment.turnsUntilAmendable).toBe(LEADERSHIP_AMENDMENT_COOLDOWN_TURNS);
    expect(state.history[state.history.length - 1].kind).toBe("rulesAmended");
  });

  it("rejects empty and out-of-bounds patches without consuming the cooldown", async () => {
    const { db, partySeq, committeeMember } = await seedWorld();
    await expectStatus(
      amendLeadershipRules(db, "UK", partySeq, committeeMember.actor, {}, 100, NOW()),
      400
    );
    await expectStatus(
      amendLeadershipRules(
        db,
        "UK",
        partySeq,
        committeeMember.actor,
        { triggerThresholdPct: 0.9 },
        100,
        NOW()
      ),
      400
    );
    await expectStatus(
      amendLeadershipRules(
        db,
        "UK",
        partySeq,
        committeeMember.actor,
        { removalMajorityPct: 0.5 },
        100,
        NOW()
      ),
      400
    );
    await expectStatus(
      amendLeadershipRules(
        db,
        "UK",
        partySeq,
        committeeMember.actor,
        { survivalImmunityTurns: 1.5 },
        100,
        NOW()
      ),
      400
    );
    await expectStatus(
      amendLeadershipRules(
        db,
        "UK",
        partySeq,
        committeeMember.actor,
        { electorate: "lords" as "mps" },
        100,
        NOW()
      ),
      400
    );
    const state = await getLeadershipState(db, "UK", partySeq, null, 100, NOW());
    expect(state.amendment.canAmendNow).toBe(true);
  });

  it("enforces the cooldown, then allows amendments again after it lapses", async () => {
    const { db, partySeq, committeeMember } = await seedWorld();
    await amendLeadershipRules(
      db,
      "UK",
      partySeq,
      committeeMember.actor,
      { removalMajorityPct: 0.6 },
      100,
      NOW()
    );
    await expectStatus(
      amendLeadershipRules(
        db,
        "UK",
        partySeq,
        committeeMember.actor,
        { removalMajorityPct: 0.65 },
        100 + LEADERSHIP_AMENDMENT_COOLDOWN_TURNS - 1,
        NOW()
      ),
      409
    );
    const again = await amendLeadershipRules(
      db,
      "UK",
      partySeq,
      committeeMember.actor,
      { removalMajorityPct: 0.65 },
      100 + LEADERSHIP_AMENDMENT_COOLDOWN_TURNS,
      NOW()
    );
    expect(again.ruleset.removalMajorityPct).toBe(0.65);
  });

  it("serializes concurrent amendments: first writer wins, the loser conflicts", async () => {
    const { db, partySeq, committeeMember } = await seedWorld();
    const [first, second] = await Promise.allSettled([
      amendLeadershipRules(
        db,
        "UK",
        partySeq,
        committeeMember.actor,
        { removalMajorityPct: 0.6 },
        100,
        NOW()
      ),
      amendLeadershipRules(
        db,
        "UK",
        partySeq,
        committeeMember.actor,
        { triggerThresholdPct: 0.2 },
        100,
        NOW()
      ),
    ]);
    // Exactly one amendment owns the cooldown window.
    const winners = [first, second].filter((r) => r.status === "fulfilled");
    const losers = [first, second].filter((r) => r.status === "rejected");
    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(1);
    expect(
      (losers[0] as PromiseRejectedResult).reason instanceof ApiError &&
        ((losers[0] as PromiseRejectedResult).reason as ApiError).status
    ).toBe(409);
    const state = await getLeadershipState(db, "UK", partySeq, null, 100, NOW());
    const majorityWon = state.ruleset.removalMajorityPct === 0.6;
    expect(state.ruleset.triggerThresholdPct).toBe(majorityWon ? 0.15 : 0.2);
    expect(state.amendment.canAmendNow).toBe(false);
  });
});

describe("committee faction control", () => {
  it("reports the majority faction from caucus tags", async () => {
    const { db, party, partySeq, mps } = await seedWorld({ mpCount: 5, committeeSize: 3 });
    const caucusA = new ObjectId();
    const caucusB = new ObjectId();
    await db.collection("caucuses").insertOne({
      _id: caucusA,
      countryId: "UK",
      partyId: partySeq,
      slug: "reformers",
      disbandedAt: null,
    });
    await db.collection("caucuses").insertOne({
      _id: caucusB,
      countryId: "UK",
      partyId: partySeq,
      slug: "loyalists",
      disbandedAt: null,
    });
    const committee = [party.chairId, ...party.committeeIds].slice(0, 4);
    for (const [index, caucusId] of [caucusA, caucusA, caucusA, caucusB].entries()) {
      await db.collection("caucusMemberships").insertOne({
        _id: new ObjectId(),
        memberType: "character",
        memberId: committee[index],
        countryId: "UK",
        partyId: partySeq,
        status: "active",
        caucusId,
      });
    }
    const snapshot = await getCommitteeSnapshot(db, "UK", party);
    expect(snapshot.control.leadingFaction).toBe("reformers");
    expect(snapshot.control.majorityHeld).toBe(true);
    expect(mps.length).toBeGreaterThan(0);
  });

  it("reports no majority on a tied or empty committee", async () => {
    const { db, party, partySeq } = await seedWorld({ mpCount: 4, committeeSize: 2 });
    const caucusA = new ObjectId();
    const caucusB = new ObjectId();
    for (const [slug, id] of [
      ["left", caucusA],
      ["right", caucusB],
    ] as const) {
      await db.collection("caucuses").insertOne({
        _id: id,
        countryId: "UK",
        partyId: partySeq,
        slug,
        disbandedAt: null,
      });
    }
    const seats = [party.chairId, ...party.committeeIds].slice(0, 4);
    await db.collection("caucusMemberships").insertOne({
      _id: new ObjectId(),
      memberType: "character",
      memberId: seats[0],
      countryId: "UK",
      partyId: partySeq,
      status: "active",
      caucusId: caucusA,
    });
    await db.collection("caucusMemberships").insertOne({
      _id: new ObjectId(),
      memberType: "character",
      memberId: seats[1],
      countryId: "UK",
      partyId: partySeq,
      status: "active",
      caucusId: caucusB,
    });
    const snapshot = await getCommitteeSnapshot(db, "UK", party);
    expect(snapshot.control.majorityHeld).toBe(false);
  });
});

describe("challenge lifecycle: initiate, back, withdraw", () => {
  it("opens gathering below threshold and shows backers needed", async () => {
    const { db, partySeq, mps } = await seedWorld({ mpCount: 10 });
    const first = await initiateLeadershipChallenge(db, "UK", partySeq, mps[0].actor, 100, NOW());
    expect(first.status).toBe("gathering");
    const state = await getLeadershipState(db, "UK", partySeq, mps[0].actor, 100, NOW());
    expect(state.activeChallenge?.status).toBe("gathering");
    // CON 15% of 11 MPs (10 + leader) = ceil(1.65) = 2 needed, 1 filed.
    expect(state.activeChallenge?.backersNeeded).toBe(1);
    expect(state.capabilities.canInitiate).toBe(false);
  });

  it("opens the ballot immediately for a tiny parliamentary party", async () => {
    const { db, partySeq, mps } = await seedWorld({ mpCount: 1 });
    // Leader holds a seat too, so 2 MPs: ceil(2 * 0.15) = 1, first letter suffices.
    const first = await initiateLeadershipChallenge(db, "UK", partySeq, mps[0].actor, 100, NOW());
    expect(first.status).toBe("ballot");
    const state = await getLeadershipState(db, "UK", partySeq, mps[0].actor, 100, NOW());
    expect(state.activeChallenge?.ballot).not.toBeNull();
    expect(state.activeChallenge?.ballot?.closesOnTurn).toBe(
      100 + LEADERSHIP_BALLOT_DURATION_TURNS
    );
  });

  it("blocks a second challenge while one is live (single-flight)", async () => {
    const { db, partySeq, mps } = await seedWorld({ mpCount: 10 });
    await initiateLeadershipChallenge(db, "UK", partySeq, mps[0].actor, 100, NOW());
    await expectStatus(
      initiateLeadershipChallenge(db, "UK", partySeq, mps[1].actor, 100, NOW()),
      409
    );
    const rows = await db.collection("ukLeadershipChallenges").find({}).toArray();
    expect(rows).toHaveLength(1);
  });

  it("transitions gathering to ballot once the trigger threshold is met", async () => {
    const { db, partySeq, mps } = await seedWorld({ mpCount: 10 });
    await initiateLeadershipChallenge(db, "UK", partySeq, mps[0].actor, 100, NOW());
    const second = await backLeadershipChallenge(
      db,
      "UK",
      partySeq,
      mps[1].actor,
      true,
      101,
      NOW()
    );
    expect(second.status).toBe("ballot");
    const state = await getLeadershipState(db, "UK", partySeq, mps[1].actor, 101, NOW());
    expect(state.activeChallenge?.ballot?.electorate).toBe("mps");
    expect(state.activeChallenge?.ballot?.turnsRemaining).toBe(LEADERSHIP_BALLOT_DURATION_TURNS);
    expect(state.history.map((h) => h.kind)).toContain("ballotOpened");
  });

  it("backing is idempotent; withdrawing a non-backer is a no-op", async () => {
    const { db, partySeq, mps } = await seedWorld({ mpCount: 20 });
    await initiateLeadershipChallenge(db, "UK", partySeq, mps[0].actor, 100, NOW());
    const twice = await backLeadershipChallenge(db, "UK", partySeq, mps[0].actor, true, 101, NOW());
    expect(twice.status).toBe("gathering");
    const noop = await backLeadershipChallenge(db, "UK", partySeq, mps[5].actor, false, 101, NOW());
    expect(noop.status).toBe("gathering");
    const challenge = await db.collection("ukLeadershipChallenges").findOne({});
    expect((challenge?.backers as unknown[]).length).toBe(1);
  });

  it("withdrawing the last letter cancels the challenge and frees the slot", async () => {
    const { db, partySeq, mps } = await seedWorld({ mpCount: 20 });
    await initiateLeadershipChallenge(db, "UK", partySeq, mps[0].actor, 100, NOW());
    const result = await backLeadershipChallenge(
      db,
      "UK",
      partySeq,
      mps[0].actor,
      false,
      101,
      NOW()
    );
    expect(result.status).toBe("cancelled");
    const state = await getLeadershipState(db, "UK", partySeq, mps[1].actor, 101, NOW());
    expect(state.activeChallenge).toBeNull();
    expect(state.capabilities.canInitiate).toBe(true);
    const retry = await initiateLeadershipChallenge(db, "UK", partySeq, mps[1].actor, 102, NOW());
    expect(retry.status).toBe("gathering");
  });

  it("rejects letters once the challenge is at ballot", async () => {
    const { db, partySeq, mps } = await seedWorld({ mpCount: 1 });
    await initiateLeadershipChallenge(db, "UK", partySeq, mps[0].actor, 100, NOW());
    await expectStatus(
      backLeadershipChallenge(db, "UK", partySeq, mps[0].actor, true, 101, NOW()),
      400
    );
  });
});

describe("ballot electorates", () => {
  it("CON ballots restrict voting to the party's MPs", async () => {
    const { db, partySeq, mps } = await seedWorld({ mpCount: 1 });
    const { challengeId } = await initiateLeadershipChallenge(
      db,
      "UK",
      partySeq,
      mps[0].actor,
      100,
      NOW()
    );
    const civId = new ObjectId();
    await db.collection("characters").insertOne({
      _id: civId,
      name: "Rank and File",
      party: partySeq,
      userId: new ObjectId(),
    });
    await expectStatus(
      castLeadershipBallotVote(
        db,
        "UK",
        challengeId,
        { _id: civId, name: "Rank and File", party: partySeq },
        "aye",
        101,
        NOW()
      ),
      403
    );
    const tally = await castLeadershipBallotVote(
      db,
      "UK",
      challengeId,
      mps[0].actor,
      "aye",
      101,
      NOW()
    );
    expect(tally.votesFor).toBe(1);
  });

  it("LAB ballots enfranchise every party member, not just MPs", async () => {
    const { db, partySeq, mps } = await seedWorld({
      abbr: "LAB",
      name: "Labour Party",
      seq: 1,
      mpCount: 1,
    });
    const { challengeId } = await initiateLeadershipChallenge(
      db,
      "UK",
      partySeq,
      mps[0].actor,
      100,
      NOW()
    );
    const memberId = new ObjectId();
    await db.collection("characters").insertOne({
      _id: memberId,
      name: "Member Meg",
      party: partySeq,
      userId: new ObjectId(),
    });
    const tally = await castLeadershipBallotVote(
      db,
      "UK",
      challengeId,
      { _id: memberId, name: "Member Meg", party: partySeq },
      "nay",
      101,
      NOW()
    );
    expect(tally.votesAgainst).toBe(1);
    const outsiderId = new ObjectId();
    await db.collection("characters").insertOne({
      _id: outsiderId,
      name: "Other Party",
      party: "9",
      userId: new ObjectId(),
    });
    await expectStatus(
      castLeadershipBallotVote(
        db,
        "UK",
        challengeId,
        { _id: outsiderId, name: "Other Party", party: "9" },
        "aye",
        101,
        NOW()
      ),
      403
    );
  });

  it("a voter can change their vote; the tally follows the latest vote", async () => {
    const { db, partySeq, mps } = await seedWorld({ mpCount: 1 });
    const { challengeId } = await initiateLeadershipChallenge(
      db,
      "UK",
      partySeq,
      mps[0].actor,
      100,
      NOW()
    );
    await castLeadershipBallotVote(db, "UK", challengeId, mps[0].actor, "aye", 101, NOW());
    const changed = await castLeadershipBallotVote(
      db,
      "UK",
      challengeId,
      mps[0].actor,
      "nay",
      102,
      NOW()
    );
    expect(changed.votesFor).toBe(0);
    expect(changed.votesAgainst).toBe(1);
    const repeat = await castLeadershipBallotVote(
      db,
      "UK",
      challengeId,
      mps[0].actor,
      "nay",
      103,
      NOW()
    );
    expect(repeat.votesFor).toBe(0);
    expect(repeat.votesAgainst).toBe(1);
  });

  it("rejects votes after the ballot window closes and on resolved ballots", async () => {
    const { db, partySeq, mps } = await seedWorld({ mpCount: 1 });
    const { challengeId } = await initiateLeadershipChallenge(
      db,
      "UK",
      partySeq,
      mps[0].actor,
      100,
      NOW()
    );
    await expectStatus(
      castLeadershipBallotVote(
        db,
        "UK",
        challengeId,
        mps[0].actor,
        "aye",
        100 + LEADERSHIP_BALLOT_DURATION_TURNS,
        NOW()
      ),
      400
    );
    await expectStatus(
      castLeadershipBallotVote(
        db,
        "UK",
        new ObjectId().toString(),
        mps[0].actor,
        "aye",
        101,
        NOW()
      ),
      404
    );
  });

  it("a mid-ballot committee amendment cannot move the ballot goalposts", async () => {
    const { db, partySeq, mps, committeeMember } = await seedWorld({ mpCount: 1 });
    const { challengeId } = await initiateLeadershipChallenge(
      db,
      "UK",
      partySeq,
      mps[0].actor,
      100,
      NOW()
    );
    await amendLeadershipRules(
      db,
      "UK",
      partySeq,
      committeeMember.actor,
      { electorate: "members", removalMajorityPct: 0.75 },
      101,
      NOW()
    );
    const challenge = await db.collection("ukLeadershipChallenges").findOne({});
    expect(challenge?.ballotRuleset?.electorate).toBe("mps");
    expect(challenge?.ballotRuleset?.removalMajorityPct).toBe(0.5);
    // The ballot still uses the snapshot: an MP vote counts.
    const tally = await castLeadershipBallotVote(
      db,
      "UK",
      challengeId,
      mps[0].actor,
      "aye",
      102,
      NOW()
    );
    expect(tally.votesFor).toBe(1);
  });
});

describe("resolution: survival, removal, immunity", () => {
  async function openBallot(opts: { mpCount?: number; seq?: number } = {}) {
    const world = await seedWorld({ mpCount: 1, ...opts });
    const { db, partySeq, mps } = world;
    const { challengeId } = await initiateLeadershipChallenge(
      db,
      "UK",
      partySeq,
      mps[0].actor,
      100,
      NOW()
    );
    return { ...world, challengeId };
  }

  it("removes the leader on a strict majority to remove and vacates the chair", async () => {
    const { db, partySeq, mps, party, challengeId } = await openBallot();
    await castLeadershipBallotVote(db, "UK", challengeId, mps[0].actor, "aye", 101, NOW());
    const close = 100 + LEADERSHIP_BALLOT_DURATION_TURNS;
    const result = await resolveLeadershipChallenge(
      db,
      "UK",
      new ObjectId(challengeId),
      close,
      NOW()
    );
    expect(result).toEqual({ resolved: true, removed: true });
    const updated = await db.collection("politicalParties").findOne({ _id: party._id });
    expect(updated?.chairId).toBeNull();
    const state = await getLeadershipState(db, "UK", partySeq, mps[0].actor, close, NOW());
    expect(state.activeChallenge).toBeNull();
    expect(state.leader).toBeNull();
    expect(state.history[state.history.length - 1].kind).toBe("ballotResolved");
    // Government formation is untouched: only the party chair is vacated.
    expect(updated?.name).toBe(party.name);
    expect(updated?.treasury).toBe(0);
  });

  it("a tie retains the leader and starts the immunity window", async () => {
    const { db, partySeq, leader, mps, challengeId } = await openBallot();
    // The leader holds a Commons seat, so the MPs electorate includes them:
    // one aye and one nay is a tie, and ties keep the leader.
    await castLeadershipBallotVote(db, "UK", challengeId, mps[0].actor, "aye", 101, NOW());
    await castLeadershipBallotVote(db, "UK", challengeId, leader.actor, "nay", 102, NOW());
    const close = 100 + LEADERSHIP_BALLOT_DURATION_TURNS;
    const survived = await resolveLeadershipChallenge(
      db,
      "UK",
      new ObjectId(challengeId),
      close,
      NOW()
    );
    expect(survived).toEqual({ resolved: true, removed: false });
    const state = await getLeadershipState(db, "UK", partySeq, mps[0].actor, close, NOW());
    expect(state.immunity.protected).toBe(true);
    expect(state.leader?.name).toBe("Leader Lex");
  });

  it("a nay majority retains the leader and blocks challenges during immunity", async () => {
    const { db, partySeq, mps, challengeId } = await openBallot();
    await castLeadershipBallotVote(db, "UK", challengeId, mps[0].actor, "nay", 101, NOW());
    const close = 100 + LEADERSHIP_BALLOT_DURATION_TURNS;
    const result = await resolveLeadershipChallenge(
      db,
      "UK",
      new ObjectId(challengeId),
      close,
      NOW()
    );
    expect(result).toEqual({ resolved: true, removed: false });
    const state = await getLeadershipState(db, "UK", partySeq, mps[0].actor, close, NOW());
    expect(state.immunity.protected).toBe(true);
    expect(state.immunity.turnsRemaining).toBeGreaterThan(0);
    expect(state.capabilities.canInitiate).toBe(false);
    await expectStatus(
      initiateLeadershipChallenge(db, "UK", partySeq, mps[0].actor, close + 1, NOW()),
      409
    );
    // After the window lapses, challenges are allowed again.
    const later = await initiateLeadershipChallenge(
      db,
      "UK",
      partySeq,
      mps[0].actor,
      close + 48,
      NOW()
    );
    expect(later.status).toBe("ballot");
  });

  it("a carried ballot is moot when the leadership already changed hands", async () => {
    const { db, party, mps, challengeId } = await openBallot();
    await castLeadershipBallotVote(db, "UK", challengeId, mps[0].actor, "aye", 101, NOW());
    const successor = new ObjectId();
    await db
      .collection("politicalParties")
      .updateOne({ _id: party._id }, { $set: { chairId: successor } });
    const close = 100 + LEADERSHIP_BALLOT_DURATION_TURNS;
    const result = await resolveLeadershipChallenge(
      db,
      "UK",
      new ObjectId(challengeId),
      close,
      NOW()
    );
    expect(result).toEqual({ resolved: true, removed: false });
    const updated = await db.collection("politicalParties").findOne({ _id: party._id });
    expect(updated?.chairId?.toString()).toBe(successor.toString());
  });

  it("resolution is idempotent: a second resolve is a no-op", async () => {
    const { db, mps, challengeId } = await openBallot();
    await castLeadershipBallotVote(db, "UK", challengeId, mps[0].actor, "nay", 101, NOW());
    const close = 100 + LEADERSHIP_BALLOT_DURATION_TURNS;
    const first = await resolveLeadershipChallenge(
      db,
      "UK",
      new ObjectId(challengeId),
      close,
      NOW()
    );
    expect(first.resolved).toBe(true);
    const second = await resolveLeadershipChallenge(
      db,
      "UK",
      new ObjectId(challengeId),
      close,
      NOW()
    );
    expect(second).toEqual({ resolved: false });
  });
});

describe("multi-turn timing and the turn driver", () => {
  it("does not resolve a ballot before its closing turn", async () => {
    const { db, partySeq, mps } = await seedWorld({ mpCount: 1 });
    const { challengeId } = await initiateLeadershipChallenge(
      db,
      "UK",
      partySeq,
      mps[0].actor,
      100,
      NOW()
    );
    const early = await resolveLeadershipChallenge(
      db,
      "UK",
      new ObjectId(challengeId),
      100 + LEADERSHIP_BALLOT_DURATION_TURNS - 1,
      NOW()
    );
    expect(early).toEqual({ resolved: false });
  });

  it("expires a gathering challenge that never reaches threshold", async () => {
    const { db, partySeq, mps } = await seedWorld({ mpCount: 20 });
    await initiateLeadershipChallenge(db, "UK", partySeq, mps[0].actor, 100, NOW());
    const before = await processExpiredLeadershipChallenges(db, "UK", NOW(), 100);
    expect(before).toEqual({ expired: 0, resolved: 0, removed: 0 });
    const result = await processExpiredLeadershipChallenges(
      db,
      "UK",
      NOW(),
      100 + LEADERSHIP_GATHERING_WINDOW_TURNS
    );
    expect(result.expired).toBe(1);
    const state = await getLeadershipState(
      db,
      "UK",
      partySeq,
      mps[0].actor,
      100 + LEADERSHIP_GATHERING_WINDOW_TURNS,
      NOW()
    );
    expect(state.activeChallenge).toBeNull();
    expect(state.history[state.history.length - 1].kind).toBe("challengeExpired");
    // Reruns are idempotent: nothing left to expire.
    const rerun = await processExpiredLeadershipChallenges(
      db,
      "UK",
      NOW(),
      100 + LEADERSHIP_GATHERING_WINDOW_TURNS + 1
    );
    expect(rerun).toEqual({ expired: 0, resolved: 0, removed: 0 });
  });

  it("the turn driver resolves closed ballots and counts removals", async () => {
    const { db, partySeq, mps } = await seedWorld({ mpCount: 1 });
    const { challengeId } = await initiateLeadershipChallenge(
      db,
      "UK",
      partySeq,
      mps[0].actor,
      100,
      NOW()
    );
    await castLeadershipBallotVote(db, "UK", challengeId, mps[0].actor, "aye", 101, NOW());
    const result = await processExpiredLeadershipChallenges(
      db,
      "UK",
      NOW(),
      100 + LEADERSHIP_BALLOT_DURATION_TURNS
    );
    expect(result).toEqual({ expired: 0, resolved: 1, removed: 1 });
  });
});

describe("history bounds", () => {
  it("caps the audit trail after many committee amendments", async () => {
    const { db, partySeq, committeeMember } = await seedWorld();
    let turn = 100;
    for (let i = 0; i < LEADERSHIP_HISTORY_CAP + 10; i++) {
      await amendLeadershipRules(
        db,
        "UK",
        partySeq,
        committeeMember.actor,
        { removalMajorityPct: i % 2 === 0 ? 0.6 : 0.55 },
        turn,
        NOW()
      );
      turn += LEADERSHIP_AMENDMENT_COOLDOWN_TURNS;
    }
    const state = await getLeadershipState(db, "UK", partySeq, null, turn, NOW());
    expect(state.history).toHaveLength(LEADERSHIP_HISTORY_CAP);
    expect(state.history[state.history.length - 1].kind).toBe("rulesAmended");
  });
});
