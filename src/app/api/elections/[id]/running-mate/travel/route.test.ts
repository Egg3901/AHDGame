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
  runWithOptionalTransaction: vi.fn(async (_withSession, fallback) => {
    await fallback();
  }),
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

function makeRequest(body: unknown): Request {
  return new Request("http://localhost/api/elections/e1/running-mate/travel", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
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
