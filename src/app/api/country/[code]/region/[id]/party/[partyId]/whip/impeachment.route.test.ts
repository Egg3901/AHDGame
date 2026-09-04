import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({ requireAuthWithCharacter: vi.fn() }));
vi.mock("@/lib/db/partyLookup", () => ({
  findPartyBySequentialId: vi.fn(),
  getPartyIdString: vi.fn(() => "1"),
  getStatePartyOrgDocumentId: vi.fn(() => "US_CA_1"),
}));
vi.mock("@/lib/api/rateLimit", () => ({
  checkRateLimit: vi.fn(() => ({ ok: true })),
  rateLimitResponse: vi.fn(),
}));
vi.mock("@/lib/congress/applyWhipVotes", () => ({
  applyWhipVotesToBill: vi.fn().mockResolvedValue({ fellInLine: 0, ignored: 0 }),
  applyWhipVotesToStateBill: vi.fn().mockResolvedValue({ fellInLine: 0, ignored: 0 }),
  applyWhipVotesToCabinet: vi.fn().mockResolvedValue({ fellInLine: 0, ignored: 0 }),
  applyWhipVotesToImpeachment: vi.fn().mockResolvedValue({ fellInLine: 0, ignored: 0 }),
}));
vi.mock("@/lib/parties/antiAbuseGuards", () => ({
  getPartyNppControlStatus: vi.fn().mockResolvedValue({ ok: true }),
}));
vi.mock("@/lib/gameState", () => ({ getGameState: vi.fn() }));

function makeCursor(docs: unknown[]) {
  return {
    toArray: vi.fn().mockResolvedValue(docs),
    sort: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    skip: vi.fn().mockReturnThis(),
    project: vi.fn().mockReturnThis(),
  };
}

describe("POST region whip — governor impeachment", () => {
  let db: MockDb;
  let chairId: ObjectId;
  const impeachmentId = new ObjectId();

  const governorCase = {
    _id: impeachmentId,
    countryId: "US",
    targetName: "Governor Vance",
    targetOffice: "governor",
    state: "US_CA",
    stage: "senate",
    houseVotingEndsOnTurn: 100,
    senateVotingEndsOnTurn: 130,
  };

  function request(overrides: Record<string, unknown> = {}) {
    return new Request("http://localhost/api/country/us/region/US_CA/party/1/whip", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        targetType: "impeachmentVote",
        targetId: impeachmentId.toString(),
        chamber: "stateSenate",
        direction: "for",
        ...overrides,
      }),
    });
  }

  const params = { params: Promise.resolve({ code: "us", id: "US_CA", partyId: "1" }) };

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    chairId = new ObjectId();

    for (const name of ["billWhips", "impeachments", "electedOfficials", "npps", "statePartyOrg"]) {
      db.collection(name);
    }
    db.collectionMocks["billWhips"]!.find.mockReturnValue(makeCursor([]));
    db.collectionMocks["billWhips"]!.insertOne.mockResolvedValue({ insertedId: new ObjectId() });
    db.collectionMocks["electedOfficials"]!.find.mockReturnValue(makeCursor([]));
    db.collectionMocks["npps"]!.find.mockReturnValue(makeCursor([]));
    db.collectionMocks["impeachments"]!.findOne.mockResolvedValue(governorCase);
    db.collectionMocks["statePartyOrg"]!.findOne.mockResolvedValue({
      _id: "US_CA_1",
      chairId,
      viceChairId: null,
    });

    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);

    const { getGameState } = await import("@/lib/gameState");
    vi.mocked(getGameState).mockResolvedValue({ currentTurn: 100 } as never);

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
    } as never);
  });

  it("whips this state's governor trial in the state legislature", async () => {
    const { POST } = await import("./route");
    const res = await POST(request(), params);

    expect(res.status).toBe(200);
    expect(db.collectionMocks["billWhips"]!.insertOne).toHaveBeenCalledWith(
      expect.objectContaining({
        targetType: "impeachmentVote",
        chamber: "stateSenate",
        stateId: "US_CA",
      })
    );
    const { applyWhipVotesToImpeachment } = await import("@/lib/congress/applyWhipVotes");
    expect(applyWhipVotesToImpeachment).toHaveBeenCalled();
  });

  it("refuses a presidential case, which belongs to the national party", async () => {
    db.collectionMocks["impeachments"]!.findOne.mockResolvedValue({
      ...governorCase,
      targetOffice: "president",
      state: undefined,
    });

    const { POST } = await import("./route");
    const res = await POST(request(), params);

    expect(res.status).toBe(400);
    expect(db.collectionMocks["billWhips"]!.insertOne).not.toHaveBeenCalled();
  });

  it("refuses another state's governor", async () => {
    // The state party has no standing in a trial held by a different state.
    db.collectionMocks["impeachments"]!.findOne.mockResolvedValue({
      ...governorCase,
      state: "US_TX",
    });

    const { POST } = await import("./route");
    const res = await POST(request(), params);

    expect(res.status).toBe(400);
    expect(db.collectionMocks["billWhips"]!.insertOne).not.toHaveBeenCalled();
  });

  it("rejects a chamber other than the state legislature", async () => {
    const { POST } = await import("./route");
    const res = await POST(request({ chamber: "senate" }), params);

    expect(res.status).toBe(400);
    expect(db.collectionMocks["billWhips"]!.insertOne).not.toHaveBeenCalled();
  });

  it("rejects a trial whose window has closed", async () => {
    const { getGameState } = await import("@/lib/gameState");
    vi.mocked(getGameState).mockResolvedValue({ currentTurn: 200 } as never);

    const { POST } = await import("./route");
    const res = await POST(request(), params);

    expect(res.status).toBe(404);
    expect(db.collectionMocks["billWhips"]!.insertOne).not.toHaveBeenCalled();
  });
});
