import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({ requireAuthWithCharacter: vi.fn() }));
vi.mock("@/lib/db/partyLookup", () => ({ findPartyBySequentialId: vi.fn() }));
vi.mock("@/lib/api/rateLimit", () => ({
  checkRateLimit: vi.fn(() => ({ ok: true })),
  rateLimitResponse: vi.fn(),
}));
vi.mock("@/lib/partyWhips/playerWhip", () => ({
  getEligibleCharactersForWhip: vi.fn().mockResolvedValue([]),
}));
vi.mock("@/lib/congress/applyPlayerWhip", () => ({
  applyPlayerWhipToBill: vi.fn().mockResolvedValue({ overridden: 0, alreadyAligned: 0 }),
  applyPlayerWhipToLeadership: vi.fn().mockResolvedValue({ overridden: 0, alreadyAligned: 0 }),
  applyPlayerWhipToGovernmentVote: vi.fn().mockResolvedValue({ overridden: 0, alreadyAligned: 0 }),
  applyPlayerWhipToCabinet: vi.fn().mockResolvedValue({ overridden: 0, alreadyAligned: 0 }),
  applyPlayerWhipToVacateMotion: vi.fn().mockResolvedValue({ overridden: 0, alreadyAligned: 0 }),
  applyPlayerWhipToImpeachment: vi.fn().mockResolvedValue({ overridden: 0, alreadyAligned: 0 }),
}));
vi.mock("@/lib/congress/applyWhipVotes", () => ({
  applyWhipVotesToBill: vi.fn().mockResolvedValue({ fellInLine: 0, ignored: 0 }),
  applyWhipVotesToLeadership: vi.fn().mockResolvedValue({ fellInLine: 0, ignored: 0 }),
  applyWhipVotesToGovernmentVote: vi.fn().mockResolvedValue({ fellInLine: 0, ignored: 0 }),
  applyWhipVotesToCabinet: vi.fn().mockResolvedValue({ fellInLine: 0, ignored: 0 }),
  applyWhipVotesToVacateMotion: vi.fn().mockResolvedValue({ fellInLine: 0, ignored: 0 }),
  applyWhipVotesToImpeachment: vi.fn().mockResolvedValue({ fellInLine: 0, ignored: 0 }),
}));
vi.mock("@/lib/parties/antiAbuseGuards", () => ({
  getPartyNppControlStatus: vi.fn().mockResolvedValue({ ok: true }),
}));
vi.mock("@/lib/mail/systemMail", () => ({ sendSystemMail: vi.fn() }));
vi.mock("@/lib/notifications", () => ({ createNotification: vi.fn() }));
vi.mock("@/lib/time/gameTime", () => ({ getGameTime: vi.fn() }));

function makeCursor(docs: unknown[]) {
  return {
    toArray: vi.fn().mockResolvedValue(docs),
    sort: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    skip: vi.fn().mockReturnThis(),
    project: vi.fn().mockReturnThis(),
  };
}

describe("POST /api/country/[code]/parties/[id]/whip — impeachment", () => {
  let db: MockDb;
  let chairId: ObjectId;
  const impeachmentId = new ObjectId();

  const houseStageCase = {
    _id: impeachmentId,
    countryId: "US",
    targetName: "The President",
    targetOffice: "president",
    stage: "house",
    houseVotingEndsOnTurn: 120,
    senateVotingEndsOnTurn: null,
  };

  function request(overrides: Record<string, unknown> = {}) {
    return new Request("http://localhost/api/country/us/parties/1/whip", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        targetType: "impeachmentVote",
        targetId: impeachmentId.toString(),
        chamber: "house",
        direction: "for",
        ...overrides,
      }),
    });
  }

  const params = { params: Promise.resolve({ code: "us", id: "1" }) };

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    chairId = new ObjectId();

    for (const name of [
      "billWhips",
      "impeachments",
      "electedOfficials",
      "npps",
      "characters",
      "congressLeaders",
    ]) {
      db.collection(name);
    }
    db.collectionMocks["billWhips"]!.find.mockReturnValue(makeCursor([]));
    db.collectionMocks["billWhips"]!.insertOne.mockResolvedValue({ insertedId: new ObjectId() });
    db.collectionMocks["congressLeaders"]!.findOne.mockResolvedValue(null);
    db.collectionMocks["electedOfficials"]!.find.mockReturnValue(makeCursor([]));
    db.collectionMocks["npps"]!.find.mockReturnValue(makeCursor([]));
    db.collectionMocks["impeachments"]!.findOne.mockResolvedValue(houseStageCase);

    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);

    const { getGameTime } = await import("@/lib/time/gameTime");
    vi.mocked(getGameTime).mockResolvedValue({
      currentTurn: 100,
      effectiveNow: new Date("2026-09-01T00:00:00Z"),
    } as never);

    const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
    vi.mocked(requireAuthWithCharacter).mockResolvedValue({
      ok: true,
      user: { userId: new ObjectId().toString(), isAdmin: false, character: { _id: chairId } },
    } as never);

    const { findPartyBySequentialId } = await import("@/lib/db/partyLookup");
    vi.mocked(findPartyBySequentialId).mockResolvedValue({
      sequentialId: 1,
      countryId: "US",
      isDefault: true,
      chairId,
      viceChairId: null,
    } as never);
  });

  it("whips the lower chamber while the case is impeaching", async () => {
    const { POST } = await import("./route");
    const res = await POST(request(), params);

    expect(res.status).toBe(200);
    expect(db.collectionMocks["billWhips"]!.insertOne).toHaveBeenCalledWith(
      expect.objectContaining({ targetType: "impeachmentVote", chamber: "house" })
    );
    const { applyWhipVotesToImpeachment } = await import("@/lib/congress/applyWhipVotes");
    expect(applyWhipVotesToImpeachment).toHaveBeenCalled();
  });

  it("rejects the lower chamber once the case has advanced to trial", async () => {
    db.collectionMocks["impeachments"]!.findOne.mockResolvedValue({
      ...houseStageCase,
      stage: "senate",
      senateVotingEndsOnTurn: 130,
    });

    const { POST } = await import("./route");
    const res = await POST(request({ chamber: "house" }), params);

    expect(res.status).toBe(400);
    expect(db.collectionMocks["billWhips"]!.insertOne).not.toHaveBeenCalled();
  });

  it("whips the upper chamber during the trial", async () => {
    db.collectionMocks["impeachments"]!.findOne.mockResolvedValue({
      ...houseStageCase,
      stage: "senate",
      senateVotingEndsOnTurn: 130,
    });

    const { POST } = await import("./route");
    const res = await POST(request({ chamber: "senate" }), params);

    expect(res.status).toBe(200);
    expect(db.collectionMocks["billWhips"]!.insertOne).toHaveBeenCalledWith(
      expect.objectContaining({ chamber: "senate" })
    );
  });

  it("sends a governor case to the state party instead", async () => {
    // A governor is tried by its own state legislature, which is the state
    // party's surface; the national party has no standing there.
    db.collectionMocks["impeachments"]!.findOne.mockResolvedValue({
      ...houseStageCase,
      targetOffice: "governor",
      state: "US_CA",
      stage: "senate",
      senateVotingEndsOnTurn: 130,
    });

    const { POST } = await import("./route");
    const res = await POST(request({ chamber: "senate" }), params);

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      error: expect.stringContaining("state party"),
    });
    expect(db.collectionMocks["billWhips"]!.insertOne).not.toHaveBeenCalled();
  });

  it("rejects a stage whose voting window has closed", async () => {
    const { getGameTime } = await import("@/lib/time/gameTime");
    vi.mocked(getGameTime).mockResolvedValue({
      currentTurn: 200,
      effectiveNow: new Date("2026-09-09T00:00:00Z"),
    } as never);

    const { POST } = await import("./route");
    const res = await POST(request(), params);

    expect(res.status).toBe(404);
    expect(db.collectionMocks["billWhips"]!.insertOne).not.toHaveBeenCalled();
  });

  it("404s when the case is no longer open", async () => {
    db.collectionMocks["impeachments"]!.findOne.mockResolvedValue(null);

    const { POST } = await import("./route");
    const res = await POST(request(), params);

    expect(res.status).toBe(404);
  });
});
