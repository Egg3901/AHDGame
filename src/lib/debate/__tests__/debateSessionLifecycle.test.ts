import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import {
  buildCharacterParticipant,
  createDebateChallenge,
  resolveDebateSessionDoc,
  submitDebateStrategies,
  sweepExpiredDebates,
  voidDebateSessionsForElection,
} from "../debateSessionLifecycle";
import type { DebateParticipant, DebateSession } from "@/lib/db/types/debateSession";
import { STAT_KEYS, NEUTRAL_STAT, type CharacterStats } from "@/lib/stats/statsConstants";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));

const rngMid = () => 0.5;

function stats(overrides: Partial<CharacterStats> = {}): CharacterStats {
  const base = STAT_KEYS.reduce((a, k) => {
    a[k] = NEUTRAL_STAT;
    return a;
  }, {} as CharacterStats);
  return { ...base, ...overrides };
}

function charParticipant(
  id: ObjectId,
  mode: "pvp" | "ai",
  strategies: DebateParticipant["strategies"]
): DebateParticipant {
  return {
    kind: "character",
    characterId: id,
    name: "Player",
    stats: stats({ debate: 8 }),
    record: { officesHeld: 1, billsPassed: 0 },
    mode,
    strategies,
  };
}

describe("buildCharacterParticipant", () => {
  // A human candidate must always get the interactive side: the 12h strategy
  // deadline is what lets them respond. Pre-resolving them as AI (the old
  // online-snapshot gate) locked offline-at-turn players out of selecting.
  it("always yields a submittable human side (mode pvp, no strategies)", () => {
    const participant = buildCharacterParticipant({
      _id: new ObjectId(),
      name: "Player",
      stats: stats({ debate: 8 }),
      careerHistory: [],
      currentOffice: null,
    });

    expect(participant.kind).toBe("character");
    expect(participant.mode).toBe("pvp");
    expect(participant.strategies).toBeNull();
  });
});

describe("debate session lifecycle", () => {
  let db: MockDb;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
  });

  it("supersedes both players' pending PREE events and inserts a session", async () => {
    const a = new ObjectId();
    const b = new ObjectId();
    db.collection("eventInstances");
    db.collection("debateSessions");

    await createDebateChallenge(db as unknown as Db, {
      electionId: new ObjectId(),
      countryId: "US",
      challenger: charParticipant(a, "pvp", null),
      opponent: charParticipant(b, "ai", ["attack"]),
      currentTurn: 10,
      now: new Date("2026-06-18T00:00:00Z"),
    });

    const updateMany = db.collectionMocks.eventInstances!.updateMany;
    expect(updateMany).toHaveBeenCalledTimes(1);
    const [filter, update] = updateMany.mock.calls[0]!;
    expect(filter).toMatchObject({ scope: "character", status: "pending" });
    expect(update.$set.status).toBe("expired");
    expect(db.collectionMocks.debateSessions!.insertOne).toHaveBeenCalledTimes(1);
  });

  it("resolves immediately when the challenger submits against an AI opponent", async () => {
    const challengerId = new ObjectId();
    const session: DebateSession = {
      _id: new ObjectId(),
      electionId: new ObjectId(),
      countryId: "US",
      status: "awaitingStrategies",
      challenger: charParticipant(challengerId, "pvp", null),
      opponent: {
        kind: "npp",
        nppId: new ObjectId(),
        name: "NPP Rival",
        stats: stats({ charisma: 1 }),
        record: { officesHeld: 1, billsPassed: 0 },
        mode: "ai",
        strategies: ["aboveFray"],
      },
      createdTurn: 10,
      createdAt: new Date(),
      deadlineRealtimeMs: Date.now() + 1_000_000,
      updatedAt: new Date(),
    };

    db.collection("debateSessions");
    db.collectionMocks.debateSessions!.findOne.mockResolvedValue(session);
    db.collection("characters");
    db.collection("npps");

    const result = await submitDebateStrategies(
      db as unknown as Db,
      session._id,
      challengerId,
      ["attack"],
      new Date(),
      rngMid
    );

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.resolved).toBe(true);
    // Session marked resolved + favorability applied to the strong challenger.
    const sessionUpdate = db.collectionMocks.debateSessions!.updateOne.mock.calls.find(
      (c) => (c[1] as { $set?: { status?: string } }).$set?.status === "resolved"
    );
    expect(sessionUpdate).toBeDefined();
    expect(db.collectionMocks.characters!.updateOne).toHaveBeenCalled();
  });

  it("rejects a non-participant submission", async () => {
    const session: DebateSession = {
      _id: new ObjectId(),
      electionId: new ObjectId(),
      countryId: "US",
      status: "awaitingStrategies",
      challenger: charParticipant(new ObjectId(), "pvp", null),
      opponent: charParticipant(new ObjectId(), "ai", ["attack"]),
      createdTurn: 1,
      createdAt: new Date(),
      deadlineRealtimeMs: Date.now() + 1_000_000,
      updatedAt: new Date(),
    };
    db.collection("debateSessions");
    db.collectionMocks.debateSessions!.findOne.mockResolvedValue(session);

    const result = await submitDebateStrategies(
      db as unknown as Db,
      session._id,
      new ObjectId(), // not a participant
      ["attack"],
      new Date(),
      rngMid
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(403);
  });

  it("sweeps and resolves sessions past their deadline", async () => {
    const session: DebateSession = {
      _id: new ObjectId(),
      electionId: new ObjectId(),
      countryId: "US",
      status: "awaitingStrategies",
      challenger: charParticipant(new ObjectId(), "pvp", null),
      opponent: charParticipant(new ObjectId(), "ai", ["attack"]),
      createdTurn: 1,
      createdAt: new Date(),
      deadlineRealtimeMs: 1000,
      updatedAt: new Date(),
    };
    db.collection("debateSessions");
    db.collectionMocks.debateSessions!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([session]),
    });
    db.collection("characters");

    const count = await sweepExpiredDebates(db as unknown as Db, new Date(), rngMid);
    expect(count).toBe(1);
    const resolvedUpdate = db.collectionMocks.debateSessions!.updateOne.mock.calls.find(
      (c) => (c[1] as { $set?: { status?: string } }).$set?.status === "resolved"
    );
    expect(resolvedUpdate).toBeDefined();
  });

  it("applies effects only once when two resolvers race (atomic claim)", async () => {
    const session: DebateSession = {
      _id: new ObjectId(),
      electionId: new ObjectId(),
      countryId: "US",
      status: "awaitingStrategies",
      challenger: charParticipant(new ObjectId(), "pvp", ["attack"]),
      opponent: charParticipant(new ObjectId(), "ai", ["aboveFray"]),
      createdTurn: 1,
      createdAt: new Date(),
      deadlineRealtimeMs: 1000,
      updatedAt: new Date(),
    };
    db.collection("debateSessions");
    db.collection("characters");

    // First claim wins (matchedCount 1); the second loses (matchedCount 0).
    db.collectionMocks
      .debateSessions!.updateOne.mockResolvedValueOnce({ matchedCount: 1, modifiedCount: 1 })
      .mockResolvedValueOnce({ matchedCount: 0, modifiedCount: 0 });
    db.collectionMocks.debateSessions!.findOne.mockResolvedValue({
      ...session,
      status: "resolved",
    });

    await resolveDebateSessionDoc(db as unknown as Db, session, "deadline", new Date(), rngMid);
    const afterWinningClaim = db.collectionMocks.characters!.updateOne.mock.calls.length;
    expect(afterWinningClaim).toBeGreaterThan(0); // the winner applied effects

    await resolveDebateSessionDoc(db as unknown as Db, session, "deadline", new Date(), rngMid);
    // The losing claim (matchedCount 0) must not touch favorability/XP again.
    expect(db.collectionMocks.characters!.updateOne).toHaveBeenCalledTimes(afterWinningClaim);
  });
});

// Ticket #826 item 11: a debate session must not outlive the election it's
// tied to. `voidDebateSessionsForElection` is what election/primary
// resolution calls to clear a still-pending challenge the moment the race
// ends, instead of letting it live on for up to its own 12h real-time
// deadline.
describe("voidDebateSessionsForElection", () => {
  let db: MockDb;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
  });

  it("flips only awaitingStrategies sessions for the given election to expired, with no favorability effects", async () => {
    const electionId = new ObjectId();
    const now = new Date("2026-06-30T00:00:00Z");
    db.collection("debateSessions");
    db.collectionMocks.debateSessions!.updateMany.mockResolvedValue({ modifiedCount: 1 });

    const modified = await voidDebateSessionsForElection(db as unknown as Db, electionId, now);

    expect(modified).toBe(1);
    expect(db.collectionMocks.debateSessions!.updateMany).toHaveBeenCalledTimes(1);
    const [filter, update] = db.collectionMocks.debateSessions!.updateMany.mock.calls[0]!;
    expect(filter).toEqual({ electionId, status: "awaitingStrategies" });
    expect(update.$set).toMatchObject({
      status: "expired",
      resolveReason: "election_ended",
      resolvedAt: now,
      updatedAt: now,
    });

    // No favorability or Debate-practice side effects — the debate no longer
    // corresponds to a live race.
    expect(db.collectionMocks.characters).toBeUndefined();
    expect(db.collectionMocks.npps).toBeUndefined();
  });

  it("returns 0 when there is no pending session for the election", async () => {
    const electionId = new ObjectId();
    db.collection("debateSessions");
    db.collectionMocks.debateSessions!.updateMany.mockResolvedValue({ modifiedCount: 0 });

    const modified = await voidDebateSessionsForElection(
      db as unknown as Db,
      electionId,
      new Date()
    );

    expect(modified).toBe(0);
  });
});
