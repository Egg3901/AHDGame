import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({ requireAuthWithCharacter: vi.fn() }));
vi.mock("@/lib/api/rateLimit", () => ({
  ELECTION_LIMITS: { maxRequests: 30, windowMs: 60000 },
  checkRateLimit: vi.fn().mockReturnValue({ ok: true }),
  rateLimitResponse: vi.fn(),
}));
vi.mock("@/lib/elections/electionParamResolution", () => ({
  resolveElectionRouteParam: vi.fn(),
}));
vi.mock("@/lib/constants/states", () => ({
  getElectoralVoteUnits: vi.fn().mockReturnValue([{ stateId: "PA" }, { stateId: "OH" }]),
  getTravelActionCost: vi.fn().mockReturnValue(3),
}));
vi.mock("@/lib/api/sameCountry", () => ({ isSameCountry: vi.fn().mockReturnValue(true) }));
vi.mock("@/lib/db/runWithOptionalTransaction", () => ({
  // Pass through the fallback's return value so keyed-flow claims
  // (`fresh` / `in-progress` / `duplicate`) reach the route's response.
  runWithOptionalTransaction: vi.fn(async (_withSession, fallback) => fallback()),
}));
vi.mock("@/lib/time/gameTime", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/time/gameTime")>()),
  getGameTime: vi.fn().mockResolvedValue({
    currentTurn: 100,
    effectiveNow: new Date(),
    lastTurnProcessed: new Date(),
    isActive: true,
    pausedAt: null,
  }),
}));

function makeRequest(body: unknown, idempotencyKey?: string): Request {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (idempotencyKey !== undefined) headers["Idempotency-Key"] = idempotencyKey;
  return new Request("http://localhost/api/elections/e1/running-mate/travel", {
    method: "POST",
    body: JSON.stringify(body),
    headers,
  });
}

const params = { params: Promise.resolve({ id: "e1" }) };

// General-phase presidential election (turn-first: primary ended, not yet ended).
function generalElection(overrides: Record<string, unknown> = {}) {
  return {
    _id: new ObjectId(),
    electionType: "president",
    status: "active",
    countryId: "US",
    primaryEndTurn: 50,
    endTurn: 200,
    ...overrides,
  };
}

describe("POST /api/elections/[id]/running-mate/travel", () => {
  let db: MockDb;
  const characterId = new ObjectId();

  async function auth() {
    const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
    vi.mocked(requireAuthWithCharacter).mockResolvedValue({
      ok: true,
      user: {
        userId: "u1",
        isAdmin: false,
        character: { _id: characterId, countryId: "US", actions: 10 },
      },
    } as never);
  }

  async function setElection(election: Record<string, unknown>) {
    const { resolveElectionRouteParam } = await import("@/lib/elections/electionParamResolution");
    vi.mocked(resolveElectionRouteParam).mockResolvedValue({ ok: true, election } as never);
  }

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("gameState").findOne.mockResolvedValue({ preset: undefined });
    db.collection("characters").findOne.mockResolvedValue({ _id: characterId, actions: 10 });
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
    await auth();
  });

  it("sets the surrogate travel state and draws down the shared pool", async () => {
    await setElection(generalElection());
    db.collection("electionCandidates").findOne.mockResolvedValue({
      _id: new ObjectId(),
      characterId: new ObjectId(),
      runningMateId: characterId,
      status: "active",
      runningMateTravelState: null,
    });
    db.collection("campaigns").findOne.mockResolvedValue({ _id: new ObjectId() });

    const { POST } = await import("./route");
    const res = await POST(makeRequest({ stateId: "PA" }), params);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.runningMateTravelState).toBe("PA");
    // Pool decrement guarded by $gte 1, $inc -1.
    const poolCall = db.collectionMocks.campaigns.updateOne.mock.calls[0];
    expect(
      (poolCall[0] as { runningMateSurrogateActionsRemaining?: { $gte?: number } })
        .runningMateSurrogateActionsRemaining?.$gte
    ).toBe(1);
    expect(
      (poolCall[1] as { $inc?: { runningMateSurrogateActionsRemaining?: number } }).$inc
        ?.runningMateSurrogateActionsRemaining
    ).toBe(-1);
    // Candidate row updated with the surrogate travel state.
    const candCall = db.collectionMocks.electionCandidates.updateOne.mock.calls[0];
    expect(
      (candCall[1] as { $set?: { runningMateTravelState?: string } }).$set?.runningMateTravelState
    ).toBe("PA");
  });

  it("rejects travel before the general phase opens", async () => {
    // primaryEndTurn beyond currentTurn 100 → primary still open → not general.
    await setElection(generalElection({ primaryEndTurn: 200, endTurn: 400 }));
    db.collection("electionCandidates").findOne.mockResolvedValue({
      _id: new ObjectId(),
      characterId: new ObjectId(),
      runningMateId: characterId,
      status: "active",
    });

    const { POST } = await import("./route");
    const res = await POST(makeRequest({ stateId: "PA" }), params);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toContain("general election");
  });

  it("returns 403 when the caller is not the ticket's running mate", async () => {
    await setElection(generalElection());
    db.collection("electionCandidates").findOne.mockResolvedValue(null);

    const { POST } = await import("./route");
    const res = await POST(makeRequest({ stateId: "PA" }), params);

    expect(res.status).toBe(403);
  });

  it("returns 409 and does not debit the VP when the pool is exhausted", async () => {
    await setElection(generalElection());
    db.collection("electionCandidates").findOne.mockResolvedValue({
      _id: new ObjectId(),
      characterId: new ObjectId(),
      runningMateId: characterId,
      status: "active",
      runningMateTravelState: null,
    });
    db.collection("campaigns").findOne.mockResolvedValue({ _id: new ObjectId() });
    db.collection("campaigns").updateOne.mockResolvedValue({ modifiedCount: 0, matchedCount: 0 });

    const { POST } = await import("./route");
    const res = await POST(makeRequest({ stateId: "PA" }), params);
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.error).toBe("No running-mate surrogate actions remaining today.");
    expect(db.collectionMocks.characters.updateOne).not.toHaveBeenCalled();
  });
});

interface StoredReceipt {
  _id: string;
  status: string;
  fingerprint: string;
  error?: string;
}

// Keyed-flow fault/retry coverage for the #1672 migration: replays converge,
// crashed attempts reconcile, and a lost race compensates instead of
// stranding a debit.
describe("POST /api/elections/[id]/running-mate/travel keyed flow", () => {
  let db: MockDb;
  const characterId = new ObjectId();
  const candidateId = new ObjectId();
  const campaignId = new ObjectId();

  function installStatefulReceipts(seed: Record<string, StoredReceipt> = {}) {
    const store = new Map<string, StoredReceipt>(Object.entries(seed));
    const receipts = db.collection("nonAtomicMoneyFlowReceipts");
    receipts.insertOne.mockImplementation(async (doc: { _id: string }) => {
      if (store.has(doc._id)) {
        const dup = new Error("E11000 duplicate key") as Error & { code: number };
        dup.code = 11000;
        throw dup;
      }
      store.set(doc._id, doc as StoredReceipt);
      return { insertedId: doc._id };
    });
    receipts.findOne.mockImplementation(async (filter: { _id: string }) => {
      return store.get(filter._id) ?? null;
    });
    receipts.updateOne.mockImplementation(
      async (filter: { _id: string }, update: { $set?: Partial<StoredReceipt> }) => {
        const existing = store.get(filter._id);
        if (!existing) return { matchedCount: 0, modifiedCount: 0 };
        Object.assign(existing, update.$set ?? {});
        return { matchedCount: 1, modifiedCount: 1 };
      }
    );
    return store;
  }

  function candidateDoc() {
    return {
      _id: candidateId,
      characterId: new ObjectId(),
      runningMateId: characterId,
      status: "active",
      runningMateTravelState: null,
    };
  }

  async function setupFlow() {
    const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
    vi.mocked(requireAuthWithCharacter).mockResolvedValue({
      ok: true,
      user: {
        userId: "u1",
        isAdmin: false,
        character: { _id: characterId, countryId: "US", actions: 10 },
      },
    } as never);
    const { resolveElectionRouteParam } = await import("@/lib/elections/electionParamResolution");
    vi.mocked(resolveElectionRouteParam).mockResolvedValue({
      ok: true,
      election: generalElection(),
    } as never);
    db.collection("gameState").findOne.mockResolvedValue({ preset: undefined });
    db.collection("characters").findOne.mockResolvedValue({ _id: characterId, actions: 10 });
    db.collection("electionCandidates").findOne.mockResolvedValue(candidateDoc());
    db.collection("campaigns").findOne.mockResolvedValue({ _id: campaignId });
  }

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
    await setupFlow();
  });

  it("replays a completed flow under the same Idempotency-Key without moving money again", async () => {
    installStatefulReceipts();
    const { POST } = await import("./route");

    const first = await POST(makeRequest({ stateId: "PA" }, "replay-key-1"), params);
    const firstBody = await first.json();
    expect(first.status).toBe(200);
    expect(firstBody.duplicate ?? false).toBe(false);

    const second = await POST(makeRequest({ stateId: "PA" }, "replay-key-1"), params);
    const secondBody = await second.json();
    expect(second.status).toBe(200);
    expect(secondBody.duplicate).toBe(true);
    expect(secondBody.runningMateTravelState).toBe("PA");

    // Exactly one debit, one pool draw, one travel-state write across both calls.
    expect(db.collectionMocks.characters.updateOne.mock.calls).toHaveLength(1);
    expect(db.collectionMocks.campaigns.updateOne.mock.calls).toHaveLength(1);
    expect(db.collectionMocks.electionCandidates.updateOne.mock.calls).toHaveLength(1);
  });

  it("rejects empty and over-long Idempotency-Key headers", async () => {
    installStatefulReceipts();
    const { POST } = await import("./route");

    const empty = await POST(makeRequest({ stateId: "PA" }, ""), params);
    expect(empty.status).toBe(400);
    expect((await empty.json()).error).toBe("Invalid Idempotency-Key header");

    const long = await POST(makeRequest({ stateId: "PA" }, "k".repeat(129)), params);
    expect(long.status).toBe(400);
    expect((await long.json()).error).toBe("Invalid Idempotency-Key header");

    expect(db.collectionMocks.characters.updateOne).not.toHaveBeenCalled();
  });

  it("reconciles a crashed in_progress attempt without double-spending", async () => {
    const key = "recovery-key-1";
    const fingerprint = `${characterId.toHexString()}:${candidateId.toHexString()}:rm-travel:PA:3`;
    const store = installStatefulReceipts({
      [key]: { _id: key, status: "in_progress", fingerprint },
    });
    // Every leg already applied under this key: the guarded writes match
    // nothing and disambiguation finds the key record.
    for (const name of ["characters", "campaigns", "electionCandidates"]) {
      db.collection(name).updateOne.mockResolvedValue({ matchedCount: 0, modifiedCount: 0 });
    }
    db.collection("characters").findOne.mockImplementation(
      async (_filter: unknown, opts?: { projection?: Record<string, unknown> }) =>
        opts?.projection && "appliedMoneyFlowKeys" in opts.projection
          ? { _id: characterId, appliedMoneyFlowKeys: [key] }
          : { _id: characterId, actions: 10 }
    );
    db.collection("campaigns").findOne.mockImplementation(
      async (_filter: unknown, opts?: { projection?: Record<string, unknown> }) =>
        opts?.projection && "appliedMoneyFlowKeys" in opts.projection
          ? { _id: campaignId, appliedMoneyFlowKeys: [key] }
          : { _id: campaignId }
    );
    db.collection("electionCandidates").findOne.mockImplementation(
      async (_filter: unknown, opts?: unknown) =>
        opts ? { ...candidateDoc(), appliedMoneyFlowKeys: [key] } : candidateDoc()
    );

    const { POST } = await import("./route");
    const res = await POST(makeRequest({ stateId: "PA" }, key), params);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.duplicate).toBe(true);
    expect(store.get(key)?.status).toBe("completed");
    // Re-attempted writes still carry the key guard, so a live process crash
    // between them cannot double-apply.
    for (const name of ["characters", "campaigns"] as const) {
      for (const call of db.collectionMocks[name].updateOne.mock.calls) {
        expect((call[0] as { appliedMoneyFlowKeys?: unknown }).appliedMoneyFlowKeys).toEqual({
          $ne: key,
        });
      }
    }
  });

  it("compensates the pool draw and VP debit when the ticket state races", async () => {
    installStatefulReceipts();
    // Travel-state write loses the optimistic-concurrency race.
    db.collection("electionCandidates").updateOne.mockResolvedValue({
      matchedCount: 0,
      modifiedCount: 0,
    });

    const { POST } = await import("./route");
    const res = await POST(makeRequest({ stateId: "PA" }, "race-key-1"), params);
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.error).toContain("surrogate travel state changed");

    // Pool draw reversed with its compensate key.
    const poolCalls = db.collectionMocks.campaigns.updateOne.mock.calls;
    expect(poolCalls).toHaveLength(2);
    expect(
      (poolCalls[0][1] as { $inc?: Record<string, number> }).$inc
        ?.runningMateSurrogateActionsRemaining
    ).toBe(-1);
    expect((poolCalls[1][0] as { appliedMoneyFlowKeys?: unknown }).appliedMoneyFlowKeys).toEqual({
      $ne: "race-key-1:compensate:surrogate-pool",
    });
    expect(
      (poolCalls[1][1] as { $inc?: Record<string, number> }).$inc
        ?.runningMateSurrogateActionsRemaining
    ).toBe(1);

    // VP actions debit reversed as well.
    const charCalls = db.collectionMocks.characters.updateOne.mock.calls;
    expect(charCalls).toHaveLength(2);
    expect((charCalls[1][1] as { $inc?: Record<string, number> }).$inc?.actions).toBe(3);
  });

  it("fails closed when the same key is reused for a different transfer", async () => {
    installStatefulReceipts();
    const { POST } = await import("./route");

    const first = await POST(makeRequest({ stateId: "PA" }, "conflict-key-1"), params);
    expect(first.status).toBe(200);

    // Same key, different destination: fingerprint mismatch.
    const second = await POST(makeRequest({ stateId: "OH" }, "conflict-key-1"), params);
    expect(second.status).toBe(500);
    // No second debit or pool draw under the reused key.
    expect(db.collectionMocks.characters.updateOne.mock.calls).toHaveLength(1);
    expect(db.collectionMocks.campaigns.updateOne.mock.calls).toHaveLength(1);
  });
});
