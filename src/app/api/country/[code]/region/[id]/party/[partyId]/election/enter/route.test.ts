import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/validate", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/validate")>();
  return { ...actual, parseJsonBody: vi.fn() };
});
vi.mock("@/lib/api/rateLimit", () => ({
  checkRateLimit: vi.fn(() => ({ ok: true })),
  rateLimitResponse: vi.fn(),
  ELECTION_LIMITS: { maxRequests: 20, windowMs: 60_000 },
}));
vi.mock("@/lib/api/requestLog", () => ({ logRequest: vi.fn() }));
vi.mock("@/lib/utils/statePartyElectionValidation", () => ({
  validateStatePartyElectionAccess: vi.fn(),
}));
vi.mock("@/lib/statePartyElections", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/statePartyElections")>();
  return { ...actual, notifyCandidacyDeclared: vi.fn() };
});
vi.mock("@/lib/time/gameTime", () => ({
  getGameTime: vi.fn(() =>
    Promise.resolve({ currentTurn: 30, effectiveNow: new Date("2026-05-04T12:00:00Z") })
  ),
}));

describe("state party election enter route — tenure gate", () => {
  let db: MockDb;
  let characterId: ObjectId;

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    characterId = new ObjectId();
    db.collection("users");
    db.collection("statePartyCandidates");
    db.collection("statePartyElections");

    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);

    const { parseJsonBody } = await import("@/lib/api/validate");
    vi.mocked(parseJsonBody).mockResolvedValue({
      success: true,
      data: { position: "chair", withdraw: false },
    } as never);

    db.collectionMocks["users"]!.findOne.mockResolvedValue({
      _id: new ObjectId(),
      createdAt: new Date("2025-01-01T00:00:00Z"),
    });
    db.collectionMocks["statePartyCandidates"]!.findOne.mockResolvedValue(null);
  });

  async function mockAccess(partyJoinedTurn: number) {
    const { validateStatePartyElectionAccess } =
      await import("@/lib/utils/statePartyElectionValidation");
    vi.mocked(validateStatePartyElectionAccess).mockResolvedValue({
      success: true,
      character: {
        _id: characterId,
        userId: new ObjectId(),
        name: "Candidate",
        party: "7",
        countryId: "US",
        createdAt: new Date("2026-01-01T00:00:00Z"),
        partyJoinedAt: new Date("2026-01-02T00:00:00Z"),
        partyJoinedTurn,
      },
      election: {
        _id: new ObjectId(),
        partyId: "7",
        stateId: "CA",
        countryId: "US",
        position: "chair",
        status: "voting",
        endTurn: 50,
        endTime: new Date("2026-05-10T00:00:00Z"),
      },
      stateId: "CA",
      partyId: "7",
    } as never);
  }

  it("blocks running for state leadership when party tenure < 24 turns", async () => {
    await mockAccess(20); // 30 - 20 = 10 served, 14 short
    const { POST } = await import("./route");
    const response = await POST(new Request("http://localhost/api"), {
      params: Promise.resolve({ code: "us", id: "CA", partyId: "7" }),
    });

    expect(response.status).toBe(403);
    const payload = await response.json();
    expect(payload.error).toMatch(/member of this party for \d+ more turn/i);
    expect(payload.turnsRemaining).toBe(14);
  });

  it("lets a sufficiently-tenured member past the state tenure gate (>= 24 turns)", async () => {
    await mockAccess(6); // 30 - 6 = 24 served -> eligible
    const { POST } = await import("./route");
    const response = await POST(new Request("http://localhost/api"), {
      params: Promise.resolve({ code: "us", id: "CA", partyId: "7" }),
    });

    expect(response.status).not.toBe(403);
  });

  it("waives the tenure gate for founding (pre-iteration) state elections", async () => {
    const { validateStatePartyElectionAccess } =
      await import("@/lib/utils/statePartyElectionValidation");
    vi.mocked(validateStatePartyElectionAccess).mockResolvedValue({
      success: true,
      character: {
        _id: characterId,
        userId: new ObjectId(),
        name: "Fresh Join",
        party: "7",
        countryId: "US",
        createdAt: new Date("2026-05-04T11:00:00Z"),
        partyJoinedAt: new Date("2026-05-04T11:00:00Z"),
        partyJoinedTurn: 30, // joined this turn — would fail tenure without founding
      },
      election: {
        _id: new ObjectId(),
        partyId: "7",
        stateId: "CA",
        countryId: "US",
        position: "chair",
        status: "voting",
        founding: true,
        endTurn: 42,
        endTime: new Date("2026-05-05T00:00:00Z"),
      },
      stateId: "CA",
      partyId: "7",
    } as never);

    const { POST } = await import("./route");
    const response = await POST(new Request("http://localhost/api"), {
      params: Promise.resolve({ code: "us", id: "CA", partyId: "7" }),
    });

    expect(response.status).not.toBe(403);
  });
});
