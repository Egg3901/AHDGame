import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import type { Character } from "@/lib/db/types";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/gameState", () => ({
  getGameState: vi.fn().mockResolvedValue({ currentTurn: 1, isActive: true }),
}));
vi.mock("@/lib/notifications", () => ({
  createNotification: vi.fn().mockResolvedValue(undefined),
}));

import { getGameState } from "@/lib/gameState";
import { executeSimpleInfluence, getSimpleInfluenceInfo } from "./simpleInfluence";

function makeActor(overrides: Partial<Character> = {}): Character {
  return {
    _id: new ObjectId(),
    userId: new ObjectId(),
    countryId: "US",
    name: "Actor",
    homeState: "NY",
    politicalInfluence: 50,
    favorability: 50,
    infamy: 0,
    funds: 1_000_000,
    actions: 100,
    donorBaseLevel: 1,
    policies: { economic: 0, social: 0 },
    party: "1",
    currentOffice: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as Character;
}

describe("executeSimpleInfluence — pause gate", () => {
  let db: MockDb;
  let targetId: ObjectId;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    targetId = new ObjectId();
    db.collection("characters");
    db.collection("npps");
    db.collection("actionLogs");
  });

  it("rejects attack (lower) with 409 when the game is paused and does not write", async () => {
    vi.mocked(getGameState).mockResolvedValueOnce({
      currentTurn: 2,
      isActive: false,
    } as Awaited<ReturnType<typeof getGameState>>);

    db.collectionMocks["characters"]!.findOne.mockResolvedValue({
      _id: targetId,
      userId: new ObjectId(),
      countryId: "US",
      name: "Tom Sinclair",
      homeState: "NY",
      politicalInfluence: 50,
      favorability: 50,
      infamy: 0,
    });

    const actor = makeActor();
    const { result, error } = await executeSimpleInfluence(
      db as unknown as Db,
      actor.userId.toString(),
      actor,
      targetId.toString(),
      "character",
      "lower",
      false
    );

    expect(error).toEqual({ message: "The game is currently paused.", status: 409 });
    expect(result).toBeUndefined();
    expect(db.collectionMocks["characters"]!.findOne).not.toHaveBeenCalled();
    expect(db.collectionMocks["characters"]!.updateOne).not.toHaveBeenCalled();
    expect(db.collectionMocks["actionLogs"]!.insertOne).not.toHaveBeenCalled();
  });
});

describe("executeSimpleInfluence — cap guards", () => {
  let db: MockDb;
  let targetId: ObjectId;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    targetId = new ObjectId();
    // Pre-register collections so tests can configure their mocks.
    db.collection("characters");
    db.collection("npps");
    db.collection("actionLogs");
  });

  it("rejects raise when target favorability is already 100 and does not write", async () => {
    db.collectionMocks["characters"]!.findOne.mockResolvedValue({
      _id: targetId,
      userId: new ObjectId(),
      countryId: "US",
      name: "Maxed Target",
      homeState: "NY",
      politicalInfluence: 50,
      favorability: 100,
      infamy: 0,
    });

    const actor = makeActor();
    const { result, error } = await executeSimpleInfluence(
      db as unknown as Db,
      actor.userId.toString(),
      actor,
      targetId.toString(),
      "character",
      "raise",
      false
    );

    expect(error).toBeDefined();
    expect(error?.status).toBe(400);
    expect(error?.message).toMatch(/already.*max/i);
    expect(result).toBeUndefined();
    // No write to characters (favorability) and no actionLog insert
    expect(db.collectionMocks["characters"]!.updateOne).not.toHaveBeenCalled();
    expect(db.collectionMocks["actionLogs"]!.insertOne).not.toHaveBeenCalled();
  });

  it("rejects barnstorm when target politicalInfluence is already 100 and does not write", async () => {
    db.collectionMocks["characters"]!.findOne.mockResolvedValue({
      _id: targetId,
      userId: new ObjectId(),
      countryId: "US",
      name: "Maxed Target",
      homeState: "NY",
      politicalInfluence: 100,
      favorability: 70,
      infamy: 0,
    });

    const actor = makeActor();
    const { result, error } = await executeSimpleInfluence(
      db as unknown as Db,
      actor.userId.toString(),
      actor,
      targetId.toString(),
      "character",
      "barnstorm",
      false
    );

    expect(error).toBeDefined();
    expect(error?.status).toBe(400);
    expect(error?.message).toMatch(/already.*max/i);
    expect(result).toBeUndefined();
    expect(db.collectionMocks["characters"]!.updateOne).not.toHaveBeenCalled();
    expect(db.collectionMocks["actionLogs"]!.insertOne).not.toHaveBeenCalled();
  });

  it("rejects lower when target favorability is already 0 and does not write", async () => {
    db.collectionMocks["characters"]!.findOne.mockResolvedValue({
      _id: targetId,
      userId: new ObjectId(),
      countryId: "US",
      name: "Floor Target",
      homeState: "NY",
      politicalInfluence: 50,
      favorability: 0,
      infamy: 0,
    });

    const actor = makeActor();
    const { result, error } = await executeSimpleInfluence(
      db as unknown as Db,
      actor.userId.toString(),
      actor,
      targetId.toString(),
      "character",
      "lower",
      false
    );

    expect(error).toBeDefined();
    expect(error?.status).toBe(400);
    expect(error?.message).toMatch(/already.*(min|0|floor)/i);
    expect(result).toBeUndefined();
    expect(db.collectionMocks["characters"]!.updateOne).not.toHaveBeenCalled();
    expect(db.collectionMocks["actionLogs"]!.insertOne).not.toHaveBeenCalled();
  });

  it("still allows raise when favorability is 99 (room to grow)", async () => {
    db.collectionMocks["characters"]!.findOne.mockResolvedValueOnce({
      _id: targetId,
      userId: new ObjectId(),
      countryId: "US",
      name: "Almost Maxed",
      homeState: "NY",
      politicalInfluence: 50,
      favorability: 99,
      infamy: 0,
    }).mockResolvedValue(makeActor());
    db.collectionMocks["characters"]!.updateOne.mockResolvedValue({
      acknowledged: true,
      matchedCount: 1,
      modifiedCount: 1,
    });

    const actor = makeActor();
    const { result, error } = await executeSimpleInfluence(
      db as unknown as Db,
      actor.userId.toString(),
      actor,
      targetId.toString(),
      "character",
      "raise",
      false
    );

    expect(error).toBeUndefined();
    expect(result?.success).toBe(true);
    expect(result?.newTargetFavorability).toBe(100);
  });
});

describe("getSimpleInfluenceInfo — targetMediaSustainedAtCap detection", () => {
  let db: MockDb;
  let targetId: ObjectId;
  let electionId: ObjectId;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    targetId = new ObjectId();
    electionId = new ObjectId();
    db.collection("characters");
    db.collection("npps");
    db.collection("campaigns");
    db.collection("elections");
  });

  it("flags media-sustained when target is at fav 100 in active presidential race with mediaLevel 5", async () => {
    db.collectionMocks["characters"]!.findOne.mockResolvedValue({
      _id: targetId,
      userId: new ObjectId(),
      countryId: "US",
      name: "Pres Candidate",
      homeState: "NY",
      politicalInfluence: 50,
      favorability: 100,
      infamy: 0,
    });
    db.collectionMocks["campaigns"]!.find.mockReturnValue({
      project: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue([{ electionId, mediaSpendingLevel: 5 }]),
    });
    db.collectionMocks["elections"]!.findOne.mockResolvedValue({
      _id: electionId,
      status: "active",
      electionType: "president",
    });

    const actor = makeActor();
    const { info } = await getSimpleInfluenceInfo(
      db as unknown as Db,
      actor,
      targetId.toString(),
      "character",
      false
    );

    expect(info?.targetFavorability).toBe(100);
    expect(info?.targetMediaSustainedAtCap).toBe(true);
  });

  it("does NOT flag media-sustained when fav is below cap, even with media level 5", async () => {
    db.collectionMocks["characters"]!.findOne.mockResolvedValue({
      _id: targetId,
      userId: new ObjectId(),
      countryId: "US",
      name: "Pres Candidate",
      homeState: "NY",
      politicalInfluence: 50,
      favorability: 95,
      infamy: 0,
    });

    const actor = makeActor();
    const { info } = await getSimpleInfluenceInfo(
      db as unknown as Db,
      actor,
      targetId.toString(),
      "character",
      false
    );

    expect(info?.targetMediaSustainedAtCap).toBe(false);
    // No campaigns lookup needed when below cap — short-circuits.
    expect(db.collectionMocks["campaigns"]!.find).not.toHaveBeenCalled();
  });

  it("does NOT flag media-sustained when target is at cap but no qualifying presidential campaign", async () => {
    db.collectionMocks["characters"]!.findOne.mockResolvedValue({
      _id: targetId,
      userId: new ObjectId(),
      countryId: "US",
      name: "Maxed",
      homeState: "NY",
      politicalInfluence: 50,
      favorability: 100,
      infamy: 0,
    });
    // Campaign exists but media level is 3 — below sustain threshold of 4.
    db.collectionMocks["campaigns"]!.find.mockReturnValue({
      project: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue([]),
    });

    const actor = makeActor();
    const { info } = await getSimpleInfluenceInfo(
      db as unknown as Db,
      actor,
      targetId.toString(),
      "character",
      false
    );

    expect(info?.targetMediaSustainedAtCap).toBe(false);
    // We did query for media-sustaining campaigns, but found none.
    expect(db.collectionMocks["campaigns"]!.find).toHaveBeenCalled();
    // Election lookup must be skipped since no campaign matched.
    expect(db.collectionMocks["elections"]!.findOne).not.toHaveBeenCalled();
  });

  it("does NOT flag media-sustained when the matching presidential election is not currently active", async () => {
    db.collectionMocks["characters"]!.findOne.mockResolvedValue({
      _id: targetId,
      userId: new ObjectId(),
      countryId: "US",
      name: "Maxed Pres Candidate",
      homeState: "NY",
      politicalInfluence: 50,
      favorability: 100,
      infamy: 0,
    });
    db.collectionMocks["campaigns"]!.find.mockReturnValue({
      project: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue([{ electionId, mediaSpendingLevel: 5 }]),
    });
    // Election exists and is presidential, but status is "completed" — completed
    // elections don't drive favorability passives, so the flag must stay false.
    db.collectionMocks["elections"]!.findOne.mockResolvedValue(null);

    const actor = makeActor();
    const { info } = await getSimpleInfluenceInfo(
      db as unknown as Db,
      actor,
      targetId.toString(),
      "character",
      false
    );

    expect(info?.targetMediaSustainedAtCap).toBe(false);
    // Confirm we filtered on status="active" and electionType="president"
    const findOneCall = db.collectionMocks["elections"]!.findOne.mock.calls[0]?.[0] as
      Record<string, unknown> | undefined;
    expect(findOneCall?.status).toBe("active");
    expect(findOneCall?.electionType).toBe("president");
  });

  it("does NOT flag media-sustained when the only matching campaign is not a presidential race", async () => {
    db.collectionMocks["characters"]!.findOne.mockResolvedValue({
      _id: targetId,
      userId: new ObjectId(),
      countryId: "US",
      name: "Maxed Senate Candidate",
      homeState: "NY",
      politicalInfluence: 50,
      favorability: 100,
      infamy: 0,
    });
    db.collectionMocks["campaigns"]!.find.mockReturnValue({
      project: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue([{ electionId, mediaSpendingLevel: 5 }]),
    });
    // No presidential election matches — campaignTurn doesn't apply media boosts to non-presidential.
    db.collectionMocks["elections"]!.findOne.mockResolvedValue(null);

    const actor = makeActor();
    const { info } = await getSimpleInfluenceInfo(
      db as unknown as Db,
      actor,
      targetId.toString(),
      "character",
      false
    );

    expect(info?.targetMediaSustainedAtCap).toBe(false);
  });
});
