import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({
  requireAuthWithCharacter: vi.fn(),
}));
vi.mock("@/lib/api/validate", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/validate")>();
  return {
    ...actual,
    parseJsonBody: vi.fn(),
  };
});
vi.mock("@/lib/api/rateLimit", () => ({
  checkRateLimit: vi.fn(() => ({ ok: true })),
  rateLimitResponse: vi.fn(),
  ELECTION_LIMITS: { maxRequests: 20, windowMs: 60_000 },
}));
vi.mock("@/lib/api/requestLog", () => ({ logRequest: vi.fn() }));
vi.mock("@/lib/db/partyLookup", () => ({ findPartyBySequentialId: vi.fn() }));
vi.mock("@/lib/time/gameTime", () => ({
  getGameTime: vi.fn(() =>
    Promise.resolve({ currentTurn: 5, effectiveNow: new Date("2026-05-04T12:00:00Z") })
  ),
}));

describe("national party election enter route", () => {
  let db: MockDb;
  let characterId: ObjectId;

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    characterId = new ObjectId();

    db.collection("users");
    db.collection("nationalPartyElections");
    db.collection("nationalPartyCandidates");
    db.collection("nationalCommitteeElections");
    db.collection("nationalCommitteeCandidates");

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
          name: "Candidate",
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
      data: { position: "chair", withdraw: false },
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
    db.collectionMocks["nationalPartyElections"]!.findOne.mockResolvedValueOnce({
      _id: new ObjectId(),
      partyId: "7",
      countryId: "US",
      position: "chair",
      status: "voting",
      endTurn: 50,
      endTime: new Date("2026-05-10T00:00:00Z"),
    }).mockResolvedValueOnce(null);
    db.collectionMocks["nationalCommitteeElections"]!.findOne.mockResolvedValue({
      _id: new ObjectId(),
      partyId: "7",
      countryId: "US",
      status: "voting",
      endTurn: 50,
      endTime: new Date("2026-05-10T00:00:00Z"),
    });
    db.collectionMocks["nationalCommitteeCandidates"]!.findOne.mockResolvedValue({
      _id: new ObjectId(),
      characterId,
      status: "active",
    });
  });

  it("blocks entering national leadership while already running for national committee", async () => {
    const { POST } = await import("./route");
    const response = await POST(new Request("http://localhost/api"), {
      params: Promise.resolve({ code: "us", id: "7" }),
    });

    expect(response.status).toBe(400);
    const payload = await response.json();
    expect(payload.error).toContain("already running for National Committee");
  });

  async function authWithTenure(partyJoinedTurn: number) {
    const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
    vi.mocked(requireAuthWithCharacter).mockResolvedValue({
      ok: true,
      user: {
        userId: new ObjectId().toString(),
        isBanned: false,
        character: {
          _id: characterId,
          name: "Candidate",
          party: "7",
          countryId: "US",
          createdAt: new Date("2026-01-01T00:00:00Z"),
          partyJoinedAt: new Date("2026-01-02T00:00:00Z"),
          partyJoinedTurn,
        },
      },
    } as never);
    const { getGameTime } = await import("@/lib/time/gameTime");
    vi.mocked(getGameTime).mockResolvedValue({
      currentTurn: 30,
      effectiveNow: new Date("2026-05-04T12:00:00Z"),
    } as never);
  }

  it("blocks running for national leadership when party tenure < 24 turns", async () => {
    await authWithTenure(20); // 30 - 20 = 10 turns served, 14 short of 24
    const { POST } = await import("./route");
    const response = await POST(new Request("http://localhost/api"), {
      params: Promise.resolve({ code: "us", id: "7" }),
    });

    expect(response.status).toBe(403);
    const payload = await response.json();
    expect(payload.error).toMatch(/member of this party for \d+ more turn/i);
    expect(payload.turnsRemaining).toBe(14);
  });

  it("lets a sufficiently-tenured member past the tenure gate (>= 24 turns)", async () => {
    await authWithTenure(6); // 30 - 6 = 24 turns served -> eligible
    const { POST } = await import("./route");
    const response = await POST(new Request("http://localhost/api"), {
      params: Promise.resolve({ code: "us", id: "7" }),
    });

    // Tenure passed: it falls through to the seeded committee-candidacy block,
    // proving the gate did not block an eligible member.
    expect(response.status).not.toBe(403);
    const payload = await response.json();
    expect(payload.error).toContain("National Committee");
  });
});
