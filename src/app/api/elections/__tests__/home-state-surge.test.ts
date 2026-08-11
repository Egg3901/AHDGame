import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";

vi.mock("@/lib/mongodb", () => ({
  getDb: vi.fn(),
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn(),
}));

vi.mock("jose", () => ({
  jwtVerify: vi.fn(),
}));

vi.mock("@/lib/api/rateLimit", () => ({
  checkRateLimit: vi.fn().mockReturnValue({ ok: true }),
  ELECTION_LIMITS: { maxRequests: 10, windowMs: 60000 },
}));

vi.mock("@/lib/api/requireAuth", () => ({
  requireAuthWithCharacter: vi.fn(),
}));

vi.mock("@/lib/time/gameTime", async (importActual) => ({
  // Keep real exports (hasGameTimePassed is used by isPrimaryEnded's fallback).
  ...(await importActual<typeof import("@/lib/time/gameTime")>()),
  getGameTime: vi.fn().mockResolvedValue({
    currentTurn: 1,
    effectiveNow: new Date("2026-04-01"),
    lastTurnProcessed: new Date("2026-04-01"),
    isActive: true,
    pausedAt: null,
  }),
}));

vi.mock("@/lib/currency/characterFunds", async () => {
  const actual = await vi.importActual("@/lib/currency/characterFunds");
  return {
    ...actual,
    loadCharacterFxRate: vi.fn().mockResolvedValue({ rate: 1 }),
    getHomeCurrency: vi.fn().mockReturnValue("USD"),
  };
});

vi.mock("@/lib/currency/featureFlag", () => ({
  isForexEnabled: vi.fn().mockResolvedValue(false),
}));

vi.mock("@/lib/db/runWithOptionalTransaction", () => ({
  runWithOptionalTransaction: vi.fn().mockImplementation(async (tx) => {
    const mockSession = {} as any;
    await tx(mockSession);
  }),
}));

describe("Home State Surge", () => {
  const mockUserId = new ObjectId().toString();
  const mockCharacterId = new ObjectId();
  const mockElectionId = new ObjectId();
  const mockCandidateId = new ObjectId();

  const mockElection = {
    _id: mockElectionId,
    electionType: "president",
    state: "US",
    countryId: "US",
    status: "active",
    primaryEndTime: new Date("2026-06-01"),
  };

  const baseCharacter = {
    _id: mockCharacterId,
    userId: new ObjectId(mockUserId),
    name: "Test Candidate",
    party: "democrat",
    homeState: "california",
    countryId: "US",
    actions: 10,
    funds: 50_000,
  };

  const mockCandidate = {
    _id: mockCandidateId,
    electionId: mockElectionId,
    characterId: mockCharacterId,
    status: "active",
    primarySurgeUsed: false,
  };

  beforeEach(async () => {
    vi.clearAllMocks();

    const { cookies } = await import("next/headers");
    vi.mocked(cookies).mockResolvedValue({
      get: vi.fn().mockReturnValue({ value: "mock-token" }),
    } as any);

    const { jwtVerify } = await import("jose");
    vi.mocked(jwtVerify).mockResolvedValue({
      payload: { userId: mockUserId },
    } as any);

    const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
    vi.mocked(requireAuthWithCharacter).mockResolvedValue({
      ok: true,
      user: {
        userId: mockUserId,
        username: "testuser",
        email: "a@b.c",
        role: "user",
        isAdmin: false,
        hasCharacter: true,
        character: { ...baseCharacter },
      },
    } as never);
  });

  async function mockDbWithCharacter(characterOverrides: Record<string, unknown> = {}) {
    const { getDb } = await import("@/lib/mongodb");
    const char = { ...baseCharacter, ...characterOverrides };
    const collections: Record<string, any> = {
      elections: {
        findOne: vi.fn().mockResolvedValue(mockElection),
      },
      electionCandidates: {
        findOne: vi.fn().mockResolvedValue(mockCandidate),
        updateOne: vi.fn().mockResolvedValue({ modifiedCount: 1 }),
      },
      characters: {
        findOne: vi.fn().mockResolvedValue(char),
        updateOne: vi.fn().mockResolvedValue({ modifiedCount: 1 }),
      },
    };
    const mockDb = {
      collection: vi.fn().mockImplementation((name: string) => {
        return (
          collections[name] ?? {
            findOne: vi.fn().mockResolvedValue(null),
            updateOne: vi.fn().mockResolvedValue({ modifiedCount: 0 }),
          }
        );
      }),
    };
    vi.mocked(getDb).mockResolvedValue(mockDb as any);
    return { mockDb, collections };
  }

  it("succeeds with sufficient legacy funds (pre-forex)", async () => {
    const { collections } = await mockDbWithCharacter();
    const { isForexEnabled } = await import("@/lib/currency/featureFlag");
    vi.mocked(isForexEnabled).mockResolvedValue(false);

    const { POST } = await import("../[id]/home-state-surge/route");
    const req = new Request(`http://localhost/api/elections/${mockElectionId}/home-state-surge`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });

    const res = await POST(req, { params: Promise.resolve({ id: mockElectionId.toString() }) });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);

    const updateCall = collections.characters.updateOne.mock.calls[0];
    expect(updateCall[0]).toMatchObject({
      _id: mockCharacterId,
      actions: { $gte: 3 },
      funds: { $gte: 25_000 },
    });
    expect(updateCall[1].$inc).toMatchObject({
      actions: -3,
      funds: -25_000,
    });
  });

  it("fails with insufficient legacy funds (pre-forex)", async () => {
    await mockDbWithCharacter({ funds: 10_000 });
    const { isForexEnabled } = await import("@/lib/currency/featureFlag");
    vi.mocked(isForexEnabled).mockResolvedValue(false);

    const { POST } = await import("../[id]/home-state-surge/route");
    const req = new Request(`http://localhost/api/elections/${mockElectionId}/home-state-surge`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });

    const res = await POST(req, { params: Promise.resolve({ id: mockElectionId.toString() }) });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("Not enough personal funds");
  });

  it("uses forex-aware balance and debit when forex enabled", async () => {
    const { collections } = await mockDbWithCharacter({
      funds: 0,
      currencyBalances: { campaign: 50_000, personal: { USD: 100 } },
    });
    const { isForexEnabled } = await import("@/lib/currency/featureFlag");
    vi.mocked(isForexEnabled).mockResolvedValue(true);

    const { loadCharacterFxRate } = await import("@/lib/currency/characterFunds");
    vi.mocked(loadCharacterFxRate).mockResolvedValue({ rate: 1.0, ok: true });

    const { POST } = await import("../[id]/home-state-surge/route");
    const req = new Request(`http://localhost/api/elections/${mockElectionId}/home-state-surge`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });

    const res = await POST(req, { params: Promise.resolve({ id: mockElectionId.toString() }) });
    expect(res.status).toBe(200);

    const updateCall = collections.characters.updateOne.mock.calls[0];
    expect(updateCall[0]).toMatchObject({
      _id: mockCharacterId,
      actions: { $gte: 3 },
      "currencyBalances.campaign": { $gte: 25_000 },
    });
    // Post cf-inconsistency-fix: $inc writes only the local-currency field, no
    // legacy `funds` anchor-mirror write.
    expect(updateCall[1].$inc).toEqual({
      actions: -3,
      "currencyBalances.campaign": -25_000,
    });
    expect(updateCall[1].$inc).not.toHaveProperty("funds");
  });

  it("blocks surge when already used", async () => {
    await mockDbWithCharacter();
    const { isForexEnabled } = await import("@/lib/currency/featureFlag");
    vi.mocked(isForexEnabled).mockResolvedValue(false);

    const { getDb } = await import("@/lib/mongodb");
    const mockDb = {
      collection: vi.fn().mockImplementation((name: string) => {
        if (name === "elections") return { findOne: vi.fn().mockResolvedValue(mockElection) };
        if (name === "electionCandidates") {
          return {
            findOne: vi.fn().mockResolvedValue({ ...mockCandidate, primarySurgeUsed: true }),
          };
        }
        if (name === "characters") {
          return {
            findOne: vi.fn().mockResolvedValue(baseCharacter),
          };
        }
        return { findOne: vi.fn().mockResolvedValue(null) };
      }),
    };
    vi.mocked(getDb).mockResolvedValue(mockDb as any);

    const { POST } = await import("../[id]/home-state-surge/route");
    const req = new Request(`http://localhost/api/elections/${mockElectionId}/home-state-surge`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });

    const res = await POST(req, { params: Promise.resolve({ id: mockElectionId.toString() }) });
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error).toContain("already used");
  });
});
