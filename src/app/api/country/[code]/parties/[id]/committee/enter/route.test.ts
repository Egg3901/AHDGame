import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({
  requireAuthWithCharacter: vi.fn(),
}));
vi.mock("@/lib/api/validate", () => ({
  parseJsonBody: vi.fn(),
}));
vi.mock("@/lib/api/rateLimit", () => ({
  checkRateLimit: vi.fn(() => ({ ok: true })),
  rateLimitResponse: vi.fn(),
}));
vi.mock("@/lib/db/partyLookup", () => ({ findPartyBySequentialId: vi.fn() }));
vi.mock("@/lib/time/gameTime", () => ({
  getGameTime: vi.fn(() =>
    Promise.resolve({ currentTurn: 5, effectiveNow: new Date("2026-05-04T12:00:00Z") })
  ),
}));

describe("national committee enter route", () => {
  let db: MockDb;
  let characterId: ObjectId;

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    characterId = new ObjectId();

    db.collection("users");
    db.collection("nationalCommitteeElections");
    db.collection("nationalCommitteeCandidates");
    db.collection("nationalPartyElections");
    db.collection("nationalPartyCandidates");

    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);

    const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
    vi.mocked(requireAuthWithCharacter).mockResolvedValue({
      ok: true,
      user: {
        userId: new ObjectId().toString(),
        isBanned: false,
        character: {
          _id: characterId,
          name: "Committee Candidate",
          party: "7",
          countryId: "US",
          createdAt: new Date("2026-01-01T00:00:00Z"),
          partyJoinedAt: new Date("2026-01-02T00:00:00Z"),
        },
      },
    } as never);

    const { parseJsonBody } = await import("@/lib/api/validate");
    vi.mocked(parseJsonBody).mockResolvedValue({
      success: true,
      data: { withdraw: false },
    } as never);

    const { findPartyBySequentialId } = await import("@/lib/db/partyLookup");
    vi.mocked(findPartyBySequentialId).mockResolvedValue({
      _id: new ObjectId(),
      sequentialId: 7,
      countryId: "US",
    } as never);

    db.collectionMocks["users"]!.findOne.mockResolvedValue({
      _id: new ObjectId(),
      createdAt: new Date("2025-01-01T00:00:00Z"),
    });
    db.collectionMocks["nationalCommitteeElections"]!.findOne.mockResolvedValue({
      _id: new ObjectId(),
      partyId: "7",
      countryId: "US",
      status: "voting",
      endTurn: 50,
      endTime: new Date("2026-05-10T00:00:00Z"),
    });
    db.collectionMocks["nationalCommitteeCandidates"]!.findOne.mockResolvedValue(null);
    db.collectionMocks["nationalPartyElections"]!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        {
          _id: new ObjectId(),
          partyId: "7",
          countryId: "US",
          position: "viceChair",
          status: "voting",
          endTurn: 50,
          endTime: new Date("2026-05-10T00:00:00Z"),
        },
      ]),
    });
    db.collectionMocks["nationalPartyCandidates"]!.findOne.mockResolvedValue({
      _id: new ObjectId(),
      characterId,
      electionId: new ObjectId(),
      position: "viceChair",
      status: "active",
    });
  });

  it("blocks entering national committee while already running for national leadership", async () => {
    const { POST } = await import("./route");
    const response = await POST(new Request("http://localhost/api"), {
      params: Promise.resolve({ code: "us", id: "7" }),
    });

    expect(response.status).toBe(400);
    const payload = await response.json();
    expect(payload.error).toContain("already running for National Vice Chair");
  });
});
