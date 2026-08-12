import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getAuthUser: vi.fn(), getAuthUserWithCharacter: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({
  requireBasicAuth: vi.fn(),
  requireAuthWithCharacter: vi.fn(),
}));
vi.mock("@/lib/api/rateLimit", () => ({
  checkRateLimit: vi.fn(),
  rateLimitResponse: vi.fn(
    (retryAfter?: number) =>
      new Response(JSON.stringify({ error: "Too many requests" }), {
        status: 429,
        headers: { "Retry-After": String(retryAfter ?? 60) },
      })
  ),
}));
vi.mock("@/lib/api/corporations/resolveQuery", () => ({
  resolveCorporation: vi.fn(),
}));
vi.mock("@/lib/notifications", () => ({
  createNotification: vi.fn(),
}));
vi.mock("@/lib/db/characterLookup", () => ({
  bulkFetchCharacterNames: vi.fn(),
}));
vi.mock("@/lib/bonds/ceoBondConflict", () => ({
  holdsAnyBondsInCorp: vi.fn().mockResolvedValue({ holds: false, units: 0 }),
}));

function duplicateKeyError(message: string, keyPattern: Record<string, number>) {
  return Object.assign(new Error(message), { code: 11000, keyPattern });
}

let db: MockDb;

beforeEach(() => {
  db = createMockDb();
  vi.clearAllMocks();
  // Pre-initialize collections
  db.collection("characters");
  db.collection("corporations");
  db.collection("corporationCeoVotes");
});

async function setup() {
  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue(db as any);
}

function makeCharacterAuth(userId: string, charId: ObjectId) {
  return {
    ok: true,
    user: { userId, hasCharacter: true, character: { _id: charId, userId: new ObjectId(userId) } },
  };
}

describe("POST /api/corporations/[id]/ceo/vote", () => {
  it("returns 401 when not authenticated", async () => {
    await setup();
    const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
    vi.mocked(requireAuthWithCharacter).mockResolvedValue({
      ok: false,
      response: new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 }),
    } as never);

    const { POST } = await import("./route");
    const req = new Request("http://localhost/api/corporations/abc/ceo/vote", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ candidateCharacterId: new ObjectId().toString() }),
    });
    const res = await POST(req, { params: Promise.resolve({ id: "abc" }) });
    expect(res.status).toBe(401);
  });

  it("returns 429 when rate limited", async () => {
    await setup();
    const charId = new ObjectId();
    const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
    vi.mocked(requireAuthWithCharacter).mockResolvedValue(
      makeCharacterAuth(new ObjectId().toString(), charId) as never
    );

    const { checkRateLimit } = await import("@/lib/api/rateLimit");
    vi.mocked(checkRateLimit).mockReturnValue({
      ok: false,
      retryAfter: 45,
      limit: 100,
      remaining: 0,
      resetAt: Date.now() + 45_000,
    });

    const { POST } = await import("./route");
    const req = new Request("http://localhost/api/corporations/abc/ceo/vote", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ candidateCharacterId: new ObjectId().toString() }),
    });
    const res = await POST(req, { params: Promise.resolve({ id: "abc" }) });
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("45");
  });

  it("returns 401 when user has no character", async () => {
    await setup();
    const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
    vi.mocked(requireAuthWithCharacter).mockResolvedValue({
      ok: false,
      response: new Response(JSON.stringify({ error: "Authentication with character required" }), {
        status: 401,
      }),
    } as never);

    const { POST } = await import("./route");
    const req = new Request("http://localhost/api/corporations/abc/ceo/vote", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ candidateCharacterId: new ObjectId().toString() }),
    });
    const res = await POST(req, { params: Promise.resolve({ id: "abc" }) });
    expect(res.status).toBe(401);
  });

  it("returns 403 when user is not a shareholder", async () => {
    await setup();
    const userId = new ObjectId().toString();
    const corpId = new ObjectId();
    const charId = new ObjectId();

    const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
    vi.mocked(requireAuthWithCharacter).mockResolvedValue(
      makeCharacterAuth(userId, charId) as never
    );

    const { checkRateLimit } = await import("@/lib/api/rateLimit");
    vi.mocked(checkRateLimit).mockReturnValue({
      ok: true,
      limit: 100,
      remaining: 99,
      resetAt: Date.now() + 60_000,
    });

    const { resolveCorporation } = await import("@/lib/api/corporations/resolveQuery");
    vi.mocked(resolveCorporation).mockResolvedValue({
      ok: true,
      corporation: {
        _id: corpId,
        shareholders: [{ characterId: new ObjectId(), shares: 100 }], // Different character
      },
    } as any);

    const { POST } = await import("./route");
    const req = new Request("http://localhost/api/corporations/abc/ceo/vote", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ candidateCharacterId: new ObjectId().toString() }),
    });
    const res = await POST(req, { params: Promise.resolve({ id: "abc" }) });
    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data.error).toContain("Only shareholders");
  });

  it("returns 404 when candidate character not found", async () => {
    await setup();
    const userId = new ObjectId().toString();
    const corpId = new ObjectId();
    const charId = new ObjectId();

    const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
    vi.mocked(requireAuthWithCharacter).mockResolvedValue(
      makeCharacterAuth(userId, charId) as never
    );

    const { checkRateLimit } = await import("@/lib/api/rateLimit");
    vi.mocked(checkRateLimit).mockReturnValue({
      ok: true,
      limit: 100,
      remaining: 99,
      resetAt: Date.now() + 60_000,
    });

    const { resolveCorporation } = await import("@/lib/api/corporations/resolveQuery");
    vi.mocked(resolveCorporation).mockResolvedValue({
      ok: true,
      corporation: {
        _id: corpId,
        headquartersState: "US_CA",
        shareholders: [{ characterId: charId, shares: 100 }],
      },
    } as any);

    db.collectionMocks.characters.findOne.mockResolvedValueOnce(null); // Candidate not found

    const { POST } = await import("./route");
    const req = new Request("http://localhost/api/corporations/abc/ceo/vote", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ candidateCharacterId: new ObjectId().toString() }),
    });
    const res = await POST(req, { params: Promise.resolve({ id: "abc" }) });
    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.error).toContain("Candidate character not found");
  });

  it("returns 403 when candidate is not in HQ state", async () => {
    await setup();
    const userId = new ObjectId().toString();
    const corpId = new ObjectId();
    const charId = new ObjectId();
    const candidateId = new ObjectId();

    const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
    vi.mocked(requireAuthWithCharacter).mockResolvedValue(
      makeCharacterAuth(userId, charId) as never
    );

    const { checkRateLimit } = await import("@/lib/api/rateLimit");
    vi.mocked(checkRateLimit).mockReturnValue({
      ok: true,
      limit: 100,
      remaining: 99,
      resetAt: Date.now() + 60_000,
    });

    const { resolveCorporation } = await import("@/lib/api/corporations/resolveQuery");
    vi.mocked(resolveCorporation).mockResolvedValue({
      ok: true,
      corporation: {
        _id: corpId,
        headquartersState: "US_CA",
        shareholders: [{ characterId: charId, shares: 100 }],
      },
    } as any);

    db.collectionMocks.characters.findOne.mockResolvedValueOnce({
      _id: candidateId,
      homeState: "US_TX",
    }); // Candidate in wrong state

    const { POST } = await import("./route");
    const req = new Request("http://localhost/api/corporations/abc/ceo/vote", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ candidateCharacterId: candidateId.toString() }),
    });
    const res = await POST(req, { params: Promise.resolve({ id: "abc" }) });
    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data.error).toContain("HQ state");
  });

  it("returns 403 when candidate home state matches HQ string but country differs", async () => {
    await setup();
    const userId = new ObjectId().toString();
    const corpId = new ObjectId();
    const charId = new ObjectId();
    const candidateId = new ObjectId();

    const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
    vi.mocked(requireAuthWithCharacter).mockResolvedValue(
      makeCharacterAuth(userId, charId) as never
    );

    const { checkRateLimit } = await import("@/lib/api/rateLimit");
    vi.mocked(checkRateLimit).mockReturnValue({
      ok: true,
      limit: 100,
      remaining: 99,
      resetAt: Date.now() + 60_000,
    });

    const { resolveCorporation } = await import("@/lib/api/corporations/resolveQuery");
    vi.mocked(resolveCorporation).mockResolvedValue({
      ok: true,
      corporation: {
        _id: corpId,
        countryId: "US",
        headquartersState: "US_CA",
        shareholders: [{ characterId: charId, shares: 100 }],
      },
    } as any);

    db.collectionMocks.characters.findOne.mockResolvedValueOnce({
      _id: candidateId,
      homeState: "US_CA",
      countryId: "UK",
    });

    const { POST } = await import("./route");
    const req = new Request("http://localhost/api/corporations/abc/ceo/vote", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ candidateCharacterId: candidateId.toString() }),
    });
    const res = await POST(req, { params: Promise.resolve({ id: "abc" }) });
    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data.error).toContain("home country");
  });

  it("successfully casts vote and tallies", async () => {
    await setup();
    const userId = new ObjectId().toString();
    const corpId = new ObjectId();
    const charId = new ObjectId();
    const candidateId = new ObjectId();

    const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
    vi.mocked(requireAuthWithCharacter).mockResolvedValue(
      makeCharacterAuth(userId, charId) as never
    );

    const { checkRateLimit } = await import("@/lib/api/rateLimit");
    vi.mocked(checkRateLimit).mockReturnValue({
      ok: true,
      limit: 100,
      remaining: 99,
      resetAt: Date.now() + 60_000,
    });

    const { resolveCorporation } = await import("@/lib/api/corporations/resolveQuery");
    vi.mocked(resolveCorporation).mockResolvedValue({
      ok: true,
      corporation: {
        _id: corpId,
        name: "Test Corp",
        countryId: "US",
        headquartersState: "US_CA",
        shareholders: [{ characterId: charId, shares: 100 }],
        pendingCeoCharacterId: null,
      },
    } as any);

    db.collectionMocks.characters.findOne
      .mockResolvedValueOnce({
        _id: candidateId,
        homeState: "US_CA",
        countryId: "US",
        userId: new ObjectId(),
        name: "Candidate",
      }) // Candidate
      .mockResolvedValueOnce({ _id: candidateId, userId: new ObjectId(), name: "Candidate" }); // Leader lookup for notification

    db.collectionMocks.corporationCeoVotes.updateOne.mockResolvedValue({
      modifiedCount: 1,
      upsertedCount: 1,
    });
    db.collectionMocks.corporationCeoVotes.find.mockReturnValue({
      toArray: async () => [
        {
          _id: new ObjectId(),
          corporationId: corpId,
          voterCharacterId: charId,
          candidateCharacterId: candidateId,
        },
      ],
    });

    db.collectionMocks.corporations.updateOne.mockResolvedValue({ modifiedCount: 1 });

    const { createNotification: _createNotification } = await import("@/lib/notifications");

    const { POST } = await import("./route");
    const req = new Request("http://localhost/api/corporations/abc/ceo/vote", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ candidateCharacterId: candidateId.toString() }),
    });
    const res = await POST(req, { params: Promise.resolve({ id: "abc" }) });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.totalVotes).toBe(1);
    expect(db.collectionMocks.corporationCeoVotes.updateOne).toHaveBeenCalled();
  });

  it("does not nominate a leading candidate who holds the corp's bonds", async () => {
    await setup();
    const userId = new ObjectId().toString();
    const corpId = new ObjectId();
    const charId = new ObjectId();
    const candidateId = new ObjectId();

    const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
    vi.mocked(requireAuthWithCharacter).mockResolvedValue(
      makeCharacterAuth(userId, charId) as never
    );

    const { checkRateLimit } = await import("@/lib/api/rateLimit");
    vi.mocked(checkRateLimit).mockReturnValue({
      ok: true,
      limit: 100,
      remaining: 99,
      resetAt: Date.now() + 60_000,
    });

    const { resolveCorporation } = await import("@/lib/api/corporations/resolveQuery");
    vi.mocked(resolveCorporation).mockResolvedValue({
      ok: true,
      corporation: {
        _id: corpId,
        name: "Test Corp",
        countryId: "US",
        headquartersState: "US_CA",
        shareholders: [{ characterId: charId, shares: 100 }],
        pendingCeoCharacterId: null,
      },
    } as any);

    db.collectionMocks.characters.findOne.mockResolvedValueOnce({
      _id: candidateId,
      homeState: "US_CA",
      countryId: "US",
      userId: new ObjectId(),
      name: "Candidate",
    });

    db.collectionMocks.corporationCeoVotes.updateOne.mockResolvedValue({
      modifiedCount: 1,
      upsertedCount: 1,
    });
    db.collectionMocks.corporationCeoVotes.find.mockReturnValue({
      toArray: async () => [
        {
          _id: new ObjectId(),
          corporationId: corpId,
          voterCharacterId: charId,
          candidateCharacterId: candidateId,
        },
      ],
    });
    db.collectionMocks.corporations.updateOne.mockResolvedValue({ modifiedCount: 1 });

    // The leading candidate holds the corp's bonds.
    const { holdsAnyBondsInCorp } = await import("@/lib/bonds/ceoBondConflict");
    vi.mocked(holdsAnyBondsInCorp).mockResolvedValue({ holds: true, units: 500 });

    const { POST } = await import("./route");
    const req = new Request("http://localhost/api/corporations/abc/ceo/vote", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ candidateCharacterId: candidateId.toString() }),
    });
    const res = await POST(req, { params: Promise.resolve({ id: "abc" }) });

    expect(res.status).toBe(200);
    // The vote is recorded, but no CEO offer (pendingCeoCharacterId) is created.
    const setPending = db.collectionMocks.corporations.updateOne.mock.calls.some(
      ([, update]: unknown[]) => JSON.stringify(update ?? {}).includes(candidateId.toString())
    );
    expect(setPending).toBe(false);
    const { createNotification } = await import("@/lib/notifications");
    expect(vi.mocked(createNotification)).not.toHaveBeenCalled();
  });

  it("does not send notification if candidate is already CEO", async () => {
    await setup();
    const userId = new ObjectId().toString();
    const corpId = new ObjectId();
    const charId = new ObjectId();
    const candidateId = new ObjectId();

    const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
    vi.mocked(requireAuthWithCharacter).mockResolvedValue(
      makeCharacterAuth(userId, charId) as never
    );

    const { checkRateLimit } = await import("@/lib/api/rateLimit");
    vi.mocked(checkRateLimit).mockReturnValue({
      ok: true,
      limit: 100,
      remaining: 99,
      resetAt: Date.now() + 60_000,
    });

    const { resolveCorporation } = await import("@/lib/api/corporations/resolveQuery");
    vi.mocked(resolveCorporation).mockResolvedValue({
      ok: true,
      corporation: {
        _id: corpId,
        name: "Test Corp",
        countryId: "US",
        headquartersState: "US_CA",
        shareholders: [{ characterId: charId, shares: 100 }],
        ceoId: candidateId,
        ceoVacant: false,
        pendingCeoCharacterId: null,
      },
    } as any);

    db.collectionMocks.characters.findOne
      .mockResolvedValueOnce({
        _id: candidateId,
        homeState: "US_CA",
        countryId: "US",
        userId: new ObjectId(),
      })
      .mockResolvedValueOnce({ _id: candidateId, userId: new ObjectId() });

    db.collectionMocks.corporationCeoVotes.updateOne.mockResolvedValue({ modifiedCount: 1 });
    db.collectionMocks.corporationCeoVotes.find.mockReturnValue({
      toArray: async () => [
        {
          _id: new ObjectId(),
          corporationId: corpId,
          voterCharacterId: charId,
          candidateCharacterId: candidateId,
        },
      ],
    });

    db.collectionMocks.corporations.updateOne.mockResolvedValue({ modifiedCount: 1 });

    const { createNotification } = await import("@/lib/notifications");

    const { POST } = await import("./route");
    const req = new Request("http://localhost/api/corporations/abc/ceo/vote", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ candidateCharacterId: candidateId.toString() }),
    });
    const res = await POST(req, { params: Promise.resolve({ id: "abc" }) });

    expect(res.status).toBe(200);
    expect(createNotification).not.toHaveBeenCalled();
  });

  it("retries CEO vote writes after a duplicate shareholder-row race", async () => {
    await setup();
    const userId = new ObjectId().toString();
    const corpId = new ObjectId();
    const charId = new ObjectId();
    const candidateId = new ObjectId();

    const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
    vi.mocked(requireAuthWithCharacter).mockResolvedValue(
      makeCharacterAuth(userId, charId) as never
    );

    const { checkRateLimit } = await import("@/lib/api/rateLimit");
    vi.mocked(checkRateLimit).mockReturnValue({
      ok: true,
      limit: 100,
      remaining: 99,
      resetAt: Date.now() + 60_000,
    });

    const { resolveCorporation } = await import("@/lib/api/corporations/resolveQuery");
    vi.mocked(resolveCorporation).mockResolvedValue({
      ok: true,
      corporation: {
        _id: corpId,
        name: "Test Corp",
        countryId: "US",
        headquartersState: "US_CA",
        shareholders: [{ characterId: charId, shares: 100 }],
        pendingCeoCharacterId: null,
      },
    } as any);

    db.collectionMocks.characters.findOne
      .mockResolvedValueOnce({
        _id: candidateId,
        homeState: "US_CA",
        countryId: "US",
        userId: new ObjectId(),
        name: "Candidate",
      })
      .mockResolvedValueOnce({ _id: candidateId, userId: new ObjectId(), name: "Candidate" });

    db.collectionMocks.corporationCeoVotes.updateOne
      .mockRejectedValueOnce(
        duplicateKeyError(
          "E11000 duplicate key error collection: corporationCeoVotes index: unique_corporation_ceo_vote_per_shareholder dup key",
          { corporationId: 1, voterCharacterId: 1 }
        )
      )
      .mockResolvedValueOnce({ matchedCount: 1, modifiedCount: 1 });
    db.collectionMocks.corporationCeoVotes.find.mockReturnValue({
      toArray: async () => [
        {
          _id: new ObjectId(),
          corporationId: corpId,
          voterCharacterId: charId,
          candidateCharacterId: candidateId,
          createdAt: new Date("2026-04-29T20:00:00Z"),
          updatedAt: new Date("2026-04-29T21:00:00Z"),
        },
      ],
    });

    db.collectionMocks.corporations.updateOne.mockResolvedValue({ modifiedCount: 1 });

    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://localhost/api/corporations/abc/ceo/vote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ candidateCharacterId: candidateId.toString() }),
      }),
      { params: Promise.resolve({ id: "abc" }) }
    );

    expect(res.status).toBe(200);
    expect(db.collectionMocks.corporationCeoVotes.updateOne).toHaveBeenCalledTimes(2);
    expect(db.collectionMocks.corporationCeoVotes.updateOne.mock.calls[1]?.[2]).toBeUndefined();
  });
});

describe("GET /api/corporations/[id]/ceo/vote", () => {
  it("returns vote tallies and my vote", async () => {
    await setup();
    const userId = new ObjectId().toString();
    const corpId = new ObjectId();
    const charId = new ObjectId();
    const candidateId = new ObjectId();

    const { getAuthUserWithCharacter } = await import("@/lib/auth");
    vi.mocked(getAuthUserWithCharacter).mockResolvedValue({
      userId,
      hasCharacter: true,
      character: { _id: charId },
    } as any);

    const { resolveCorporation } = await import("@/lib/api/corporations/resolveQuery");
    vi.mocked(resolveCorporation).mockResolvedValue({
      ok: true,
      corporation: {
        _id: corpId,
        headquartersState: "US_CA",
        pendingCeoCharacterId: candidateId,
        shareholders: [{ characterId: charId, shares: 100 }],
      },
    } as any);

    db.collectionMocks.corporationCeoVotes.find.mockReturnValue({
      toArray: async () => [
        {
          _id: new ObjectId(),
          corporationId: corpId,
          voterCharacterId: charId,
          candidateCharacterId: candidateId,
        },
      ],
    });

    db.collectionMocks.characters.findOne.mockResolvedValue({ _id: charId });

    const { bulkFetchCharacterNames } = await import("@/lib/db/characterLookup");
    vi.mocked(bulkFetchCharacterNames).mockResolvedValue(
      new Map([
        [
          candidateId.toString(),
          { name: "Candidate Name", sequentialId: 5, avatarUrl: "avatar.png" },
        ],
      ])
    );

    const { GET } = await import("./route");
    const req = new Request("http://localhost/api/corporations/abc/ceo/vote");
    const res = await GET(req, { params: Promise.resolve({ id: "abc" }) });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.tallies).toHaveLength(1);
    expect(data.tallies[0]).toMatchObject({
      characterId: candidateId.toString(),
      name: "Candidate Name",
      votes: 100,
    });
    expect(data.myVote).toBe(candidateId.toString());
    expect(data.totalSharesVoted).toBe(100);
    expect(data.headquartersState).toBe("US_CA");
    expect(data.pendingCeoCharacterId).toBe(candidateId.toString());
  });

  it("returns empty tallies when no votes", async () => {
    await setup();
    const corpId = new ObjectId();

    const { getAuthUser } = await import("@/lib/auth");
    vi.mocked(getAuthUser).mockResolvedValue(null);

    const { resolveCorporation } = await import("@/lib/api/corporations/resolveQuery");
    vi.mocked(resolveCorporation).mockResolvedValue({
      ok: true,
      corporation: {
        _id: corpId,
        headquartersState: "US_TX",
        pendingCeoCharacterId: null,
        shareholders: [],
      },
    } as any);

    db.collectionMocks.corporationCeoVotes.find.mockReturnValue({
      toArray: async () => [],
    });

    const { bulkFetchCharacterNames } = await import("@/lib/db/characterLookup");
    vi.mocked(bulkFetchCharacterNames).mockResolvedValue(new Map());

    const { GET } = await import("./route");
    const req = new Request("http://localhost/api/corporations/abc/ceo/vote");
    const res = await GET(req, { params: Promise.resolve({ id: "abc" }) });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.tallies).toEqual([]);
    expect(data.myVote).toBeNull();
    expect(data.totalSharesVoted).toBe(0);
    expect(data.totalVoters).toBe(0);
  });

  it("dedupes legacy duplicate shareholder rows in GET tallies", async () => {
    await setup();
    const userId = new ObjectId().toString();
    const corpId = new ObjectId();
    const charId = new ObjectId();
    const oldCandidateId = new ObjectId();
    const newCandidateId = new ObjectId();

    const { getAuthUserWithCharacter } = await import("@/lib/auth");
    vi.mocked(getAuthUserWithCharacter).mockResolvedValue({
      userId,
      hasCharacter: true,
      character: { _id: charId },
    } as any);

    const { resolveCorporation } = await import("@/lib/api/corporations/resolveQuery");
    vi.mocked(resolveCorporation).mockResolvedValue({
      ok: true,
      corporation: {
        _id: corpId,
        headquartersState: "US_CA",
        pendingCeoCharacterId: newCandidateId,
        shareholders: [{ characterId: charId, shares: 100 }],
      },
    } as any);

    db.collectionMocks.corporationCeoVotes.find.mockReturnValue({
      toArray: async () => [
        {
          _id: new ObjectId("507f1f77bcf86cd799439041"),
          corporationId: corpId,
          voterCharacterId: charId,
          candidateCharacterId: oldCandidateId,
          createdAt: new Date("2026-04-29T20:00:00Z"),
          updatedAt: new Date("2026-04-29T20:00:00Z"),
        },
        {
          _id: new ObjectId("507f1f77bcf86cd799439042"),
          corporationId: corpId,
          voterCharacterId: charId,
          candidateCharacterId: newCandidateId,
          createdAt: new Date("2026-04-29T20:30:00Z"),
          updatedAt: new Date("2026-04-29T21:00:00Z"),
        },
      ],
    });

    const { bulkFetchCharacterNames } = await import("@/lib/db/characterLookup");
    vi.mocked(bulkFetchCharacterNames).mockResolvedValue(
      new Map([
        [oldCandidateId.toString(), { name: "Candidate A", sequentialId: 1 }],
        [newCandidateId.toString(), { name: "Candidate B", sequentialId: 2 }],
      ])
    );

    const { GET } = await import("./route");
    const res = await GET(new Request("http://localhost/api/corporations/abc/ceo/vote"), {
      params: Promise.resolve({ id: "abc" }),
    });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.tallies).toHaveLength(1);
    expect(data.tallies[0]).toMatchObject({
      characterId: newCandidateId.toString(),
      votes: 100,
    });
    expect(data.myVote).toBe(newCandidateId.toString());
    expect(data.totalVoters).toBe(1);
  });

  it("weights CEO votes by supershare voting power for dual-class corps", async () => {
    await setup();
    const corpId = new ObjectId();
    const charId = new ObjectId();
    const candidateId = new ObjectId();

    const { getAuthUserWithCharacter } = await import("@/lib/auth");
    vi.mocked(getAuthUserWithCharacter).mockResolvedValue({
      hasCharacter: true,
      character: { _id: charId },
    } as any);

    const { resolveCorporation } = await import("@/lib/api/corporations/resolveQuery");
    vi.mocked(resolveCorporation).mockResolvedValue({
      ok: true,
      corporation: {
        _id: corpId,
        headquartersState: "US_CA",
        pendingCeoCharacterId: candidateId,
        superShareMultiplier: 10,
        shareholders: [{ characterId: charId, shares: 10, superShares: 10 }],
      },
    } as any);

    db.collectionMocks.corporationCeoVotes.find.mockReturnValue({
      toArray: async () => [
        {
          _id: new ObjectId(),
          corporationId: corpId,
          voterCharacterId: charId,
          candidateCharacterId: candidateId,
        },
      ],
    });

    const { bulkFetchCharacterNames } = await import("@/lib/db/characterLookup");
    vi.mocked(bulkFetchCharacterNames).mockResolvedValue(
      new Map([[candidateId.toString(), { name: "Founder", sequentialId: 9 }]])
    );

    const { GET } = await import("./route");
    const res = await GET(new Request("http://localhost/api/corporations/abc/ceo/vote"), {
      params: Promise.resolve({ id: "abc" }),
    });
    const data = await res.json();

    expect(res.status).toBe(200);
    // 10 common + 10 supershares × (10 − 1) = 100 votes, not the raw 10 shares.
    expect(data.tallies[0].votes).toBe(100);
    expect(data.totalSharesVoted).toBe(100);
  });
});

describe("sitting CEO handling", () => {
  const okRateLimit = { ok: true as const, limit: 100, remaining: 99, resetAt: 0 };

  it("lets shareholders vote for the sitting CEO even when they live outside the HQ state", async () => {
    await setup();
    const userId = new ObjectId().toString();
    const corpId = new ObjectId();
    const charId = new ObjectId();
    const ceoId = new ObjectId();

    const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
    vi.mocked(requireAuthWithCharacter).mockResolvedValue(
      makeCharacterAuth(userId, charId) as never
    );
    const { checkRateLimit } = await import("@/lib/api/rateLimit");
    vi.mocked(checkRateLimit).mockReturnValue({ ...okRateLimit, resetAt: Date.now() + 60_000 });

    const { resolveCorporation } = await import("@/lib/api/corporations/resolveQuery");
    vi.mocked(resolveCorporation).mockResolvedValue({
      ok: true,
      corporation: {
        _id: corpId,
        name: "Test Corp",
        countryId: "US",
        headquartersState: "US_CA",
        shareholders: [{ characterId: charId, shares: 100 }],
        ceoId,
        ceoVacant: false,
        pendingCeoCharacterId: null,
      },
    } as any);

    // The incumbent has moved to Texas since founding the corp in California.
    db.collectionMocks.characters.findOne.mockResolvedValue({
      _id: ceoId,
      homeState: "US_TX",
      countryId: "US",
      userId: new ObjectId(),
    });
    db.collectionMocks.corporationCeoVotes.updateOne.mockResolvedValue({ modifiedCount: 1 });
    db.collectionMocks.corporationCeoVotes.find.mockReturnValue({
      toArray: async () => [
        {
          _id: new ObjectId(),
          corporationId: corpId,
          voterCharacterId: charId,
          candidateCharacterId: ceoId,
        },
      ],
    });

    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://localhost/api/corporations/abc/ceo/vote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ candidateCharacterId: ceoId.toString() }),
      }),
      { params: Promise.resolve({ id: "abc" }) }
    );

    expect(res.status).toBe(200);
  });

  it("clears a stale pending offer when the sitting CEO leads the tally", async () => {
    await setup();
    const userId = new ObjectId().toString();
    const corpId = new ObjectId();
    const charId = new ObjectId();
    const ceoId = new ObjectId();

    const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
    vi.mocked(requireAuthWithCharacter).mockResolvedValue(
      makeCharacterAuth(userId, charId) as never
    );
    const { checkRateLimit } = await import("@/lib/api/rateLimit");
    vi.mocked(checkRateLimit).mockReturnValue({ ...okRateLimit, resetAt: Date.now() + 60_000 });

    const { resolveCorporation } = await import("@/lib/api/corporations/resolveQuery");
    vi.mocked(resolveCorporation).mockResolvedValue({
      ok: true,
      corporation: {
        _id: corpId,
        name: "Test Corp",
        countryId: "US",
        headquartersState: "US_CA",
        shareholders: [{ characterId: charId, shares: 100 }],
        ceoId,
        ceoVacant: false,
        // Left over from an earlier round of voting.
        pendingCeoCharacterId: new ObjectId(),
      },
    } as any);

    db.collectionMocks.characters.findOne.mockResolvedValue({
      _id: ceoId,
      homeState: "US_CA",
      countryId: "US",
      userId: new ObjectId(),
    });
    db.collectionMocks.corporationCeoVotes.updateOne.mockResolvedValue({ modifiedCount: 1 });
    db.collectionMocks.corporationCeoVotes.find.mockReturnValue({
      toArray: async () => [
        {
          _id: new ObjectId(),
          corporationId: corpId,
          voterCharacterId: charId,
          candidateCharacterId: ceoId,
        },
      ],
    });
    db.collectionMocks.corporations.updateOne.mockResolvedValue({ modifiedCount: 1 });

    const { createNotification } = await import("@/lib/notifications");
    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://localhost/api/corporations/abc/ceo/vote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ candidateCharacterId: ceoId.toString() }),
      }),
      { params: Promise.resolve({ id: "abc" }) }
    );

    expect(res.status).toBe(200);
    expect(createNotification).not.toHaveBeenCalled();
    const update = db.collectionMocks.corporations.updateOne.mock.calls[0][1];
    expect(update.$unset).toEqual({ pendingCeoCharacterId: "" });
  });
});

describe("DELETE /api/corporations/[id]/ceo/vote", () => {
  it("withdraws the caller's vote and clears the pending offer behind it", async () => {
    await setup();
    const userId = new ObjectId().toString();
    const corpId = new ObjectId();
    const charId = new ObjectId();
    const rivalId = new ObjectId();

    const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
    vi.mocked(requireAuthWithCharacter).mockResolvedValue(
      makeCharacterAuth(userId, charId) as never
    );
    const { checkRateLimit } = await import("@/lib/api/rateLimit");
    vi.mocked(checkRateLimit).mockReturnValue({
      ok: true,
      limit: 100,
      remaining: 99,
      resetAt: Date.now() + 60_000,
    });

    const { resolveCorporation } = await import("@/lib/api/corporations/resolveQuery");
    vi.mocked(resolveCorporation).mockResolvedValue({
      ok: true,
      corporation: {
        _id: corpId,
        name: "Test Corp",
        countryId: "US",
        headquartersState: "US_CA",
        shareholders: [{ characterId: charId, shares: 100 }],
        ceoVacant: true,
        pendingCeoCharacterId: rivalId,
      },
    } as any);

    db.collectionMocks.corporations.find.mockReturnValue({ toArray: async () => [] });
    db.collectionMocks.corporationCeoVotes.deleteMany.mockResolvedValue({ deletedCount: 1 });
    // The withdrawn vote was the only one on the books.
    db.collectionMocks.corporationCeoVotes.find.mockReturnValue({ toArray: async () => [] });
    db.collectionMocks.corporations.updateOne.mockResolvedValue({ modifiedCount: 1 });

    const { DELETE } = await import("./route");
    const res = await DELETE(new Request("http://localhost/api/corporations/abc/ceo/vote"), {
      params: Promise.resolve({ id: "abc" }),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, totalVotes: 0 });
    const update = db.collectionMocks.corporations.updateOne.mock.calls[0][1];
    expect(update.$unset).toEqual({ pendingCeoCharacterId: "" });
  });

  it("404s when the caller has no vote to withdraw", async () => {
    await setup();
    const userId = new ObjectId().toString();
    const charId = new ObjectId();

    const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
    vi.mocked(requireAuthWithCharacter).mockResolvedValue(
      makeCharacterAuth(userId, charId) as never
    );
    const { checkRateLimit } = await import("@/lib/api/rateLimit");
    vi.mocked(checkRateLimit).mockReturnValue({
      ok: true,
      limit: 100,
      remaining: 99,
      resetAt: Date.now() + 60_000,
    });

    const { resolveCorporation } = await import("@/lib/api/corporations/resolveQuery");
    vi.mocked(resolveCorporation).mockResolvedValue({
      ok: true,
      corporation: {
        _id: new ObjectId(),
        name: "Test Corp",
        countryId: "US",
        headquartersState: "US_CA",
        shareholders: [{ characterId: charId, shares: 100 }],
        ceoVacant: true,
      },
    } as any);

    db.collectionMocks.corporations.find.mockReturnValue({ toArray: async () => [] });
    db.collectionMocks.corporationCeoVotes.deleteMany.mockResolvedValue({ deletedCount: 0 });

    const { DELETE } = await import("./route");
    const res = await DELETE(new Request("http://localhost/api/corporations/abc/ceo/vote"), {
      params: Promise.resolve({ id: "abc" }),
    });

    expect(res.status).toBe(404);
  });
});
