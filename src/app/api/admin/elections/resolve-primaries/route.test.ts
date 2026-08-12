import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import type { Db } from "mongodb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAdmin", () => ({ requireAdmin: vi.fn() }));
vi.mock("@/lib/electionEngine", () => ({
  fetchEnrichedCandidates: vi.fn(),
  initElectionVoteTally: vi.fn(),
}));
vi.mock("@/lib/presidentialElectionEngine", () => ({
  initPresidentVoteTally: vi.fn(),
}));
// Only the two scoring functions are stubbed; the rest of the module (the pure
// chair-lookup helpers the route also imports) keeps its real implementation, so
// adding an export upstream can't silently 500 this route under test.
vi.mock("@/lib/primaryScore", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/primaryScore")>()),
  calcPrimaryScore: vi.fn(),
  calcPresidentPrimaryScore: vi.fn(),
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

function makeCursor(docs: unknown[]) {
  return {
    toArray: vi.fn().mockResolvedValue(docs),
    sort: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    skip: vi.fn().mockReturnThis(),
    project: vi.fn().mockReturnThis(),
  };
}

describe("POST /api/admin/elections/resolve-primaries", () => {
  let db: MockDb;

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
    const { requireAdmin } = await import("@/lib/api/requireAdmin");
    vi.mocked(requireAdmin).mockResolvedValue({
      ok: true,
      admin: { username: "admin" },
    } as never);
  });

  it("keeps top-3 UK commons candidates per party (not top-1)", async () => {
    const electionId = new ObjectId();
    const now = new Date();
    const election = {
      _id: electionId,
      electionType: "commons",
      status: "active",
      countryId: "UK",
      state: "SWE",
      primaryEndTime: new Date(now.getTime() - 3600_000),
      endTime: new Date(now.getTime() + 3600_000),
    };
    // 5 candidates in one party — UK advances 3, so 2 losers expected.
    const candidates = [1, 2, 3, 4, 5].map((i) => ({
      _id: new ObjectId(),
      electionId,
      party: "uk_labour",
      characterName: `C${i}`,
      characterId: new ObjectId(),
      isNPP: false,
      status: "active",
    }));

    db.collectionMocks["elections"] = db.collection("elections");
    db.collectionMocks["elections"].find.mockReturnValue(makeCursor([election]));
    db.collectionMocks["politicalParties"] = db.collection("politicalParties");
    db.collectionMocks["politicalParties"].find.mockReturnValue(makeCursor([]));
    db.collectionMocks["electionCandidates"] = db.collection("electionCandidates");
    db.collectionMocks["electionCandidates"].find.mockReturnValue(makeCursor(candidates));
    db.collectionMocks["electionVoteTallies"] = db.collection("electionVoteTallies");
    db.collectionMocks["electionVoteTallies"].find.mockReturnValue(makeCursor([]));
    db.collectionMocks["electionVoteTallies"].findOne.mockResolvedValue(null);

    const { fetchEnrichedCandidates } = await import("@/lib/electionEngine");
    vi.mocked(fetchEnrichedCandidates).mockResolvedValue(
      candidates.map((c) => ({
        candidateId: c._id.toString(),
        charEP: 0,
        charSP: 0,
        favorability: 50,
        politicalInfluence: 100,
      })) as never
    );
    const { calcPrimaryScore } = await import("@/lib/primaryScore");
    vi.mocked(calcPrimaryScore)
      .mockReturnValueOnce(100)
      .mockReturnValueOnce(80)
      .mockReturnValueOnce(60)
      .mockReturnValueOnce(40)
      .mockReturnValueOnce(20);

    const { POST } = await import("./route");
    const res = await POST();
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.eliminated).toBe(2);
    const withdrawCall = db.collectionMocks["electionCandidates"].updateMany.mock.calls[0];
    const withdrawnIds = withdrawCall[0]._id.$in.map((id: ObjectId) => id.toString());
    expect(withdrawnIds).toHaveLength(2);
    expect(withdrawnIds).toContain(candidates[3]._id.toString());
    expect(withdrawnIds).toContain(candidates[4]._id.toString());
    expect(withdrawnIds).not.toContain(candidates[0]._id.toString());
    expect(withdrawnIds).not.toContain(candidates[1]._id.toString());
    expect(withdrawnIds).not.toContain(candidates[2]._id.toString());
  });

  // ticket-1041: this route omitted the redistricting flag, so US House
  // force-resolution capped at 1 and withdrew the two co-nominees the turn
  // resolver would have advanced. Data damage, not a display bug.
  it("keeps top-3 US house candidates per party when redistricting is enabled", async () => {
    const electionId = new ObjectId();
    const now = new Date();
    const election = {
      _id: electionId,
      electionType: "house",
      status: "active",
      countryId: "US",
      state: "CA",
      primaryEndTime: new Date(now.getTime() - 3600_000),
      endTime: new Date(now.getTime() + 3600_000),
    };
    const candidates = [1, 2, 3, 4, 5].map((i) => ({
      _id: new ObjectId(),
      electionId,
      party: "1",
      characterName: `C${i}`,
      characterId: new ObjectId(),
      isNPP: false,
      status: "active",
    }));

    db.collectionMocks["gameState"] = db.collection("gameState");
    db.collectionMocks["gameState"].findOne.mockResolvedValue({
      _id: "current",
      redistrictingEnabled: true,
    });
    db.collectionMocks["elections"] = db.collection("elections");
    db.collectionMocks["elections"].find.mockReturnValue(makeCursor([election]));
    db.collectionMocks["politicalParties"] = db.collection("politicalParties");
    db.collectionMocks["politicalParties"].find.mockReturnValue(makeCursor([]));
    db.collectionMocks["electionCandidates"] = db.collection("electionCandidates");
    db.collectionMocks["electionCandidates"].find.mockReturnValue(makeCursor(candidates));
    db.collectionMocks["electionVoteTallies"] = db.collection("electionVoteTallies");
    db.collectionMocks["electionVoteTallies"].find.mockReturnValue(makeCursor([]));
    db.collectionMocks["electionVoteTallies"].findOne.mockResolvedValue(null);

    const { fetchEnrichedCandidates } = await import("@/lib/electionEngine");
    vi.mocked(fetchEnrichedCandidates).mockResolvedValue(
      candidates.map((c) => ({
        candidateId: c._id.toString(),
        charEP: 0,
        charSP: 0,
        favorability: 50,
        politicalInfluence: 100,
      })) as never
    );
    const { calcPrimaryScore } = await import("@/lib/primaryScore");
    vi.mocked(calcPrimaryScore)
      .mockReturnValueOnce(100)
      .mockReturnValueOnce(80)
      .mockReturnValueOnce(60)
      .mockReturnValueOnce(40)
      .mockReturnValueOnce(20);

    const { POST } = await import("./route");
    const res = await POST();
    const data = await res.json();

    expect(res.status).toBe(200);
    // Top 3 advance; only the bottom 2 are withdrawn.
    expect(data.eliminated).toBe(2);
    const withdrawCall = db.collectionMocks["electionCandidates"].updateMany.mock.calls[0];
    const withdrawnIds = withdrawCall[0]._id.$in.map((id: ObjectId) => id.toString());
    expect(withdrawnIds).toHaveLength(2);
    expect(withdrawnIds).toContain(candidates[3]._id.toString());
    expect(withdrawnIds).toContain(candidates[4]._id.toString());
    expect(withdrawnIds).not.toContain(candidates[2]._id.toString());
  });

  it("keeps top-1 US house candidate per party when redistricting is disabled", async () => {
    const electionId = new ObjectId();
    const now = new Date();
    const election = {
      _id: electionId,
      electionType: "house",
      status: "active",
      countryId: "US",
      state: "CA",
      primaryEndTime: new Date(now.getTime() - 3600_000),
      endTime: new Date(now.getTime() + 3600_000),
    };
    const candidates = [1, 2, 3].map((i) => ({
      _id: new ObjectId(),
      electionId,
      party: "1",
      characterName: `C${i}`,
      characterId: new ObjectId(),
      isNPP: false,
      status: "active",
    }));

    db.collectionMocks["gameState"] = db.collection("gameState");
    db.collectionMocks["gameState"].findOne.mockResolvedValue({
      _id: "current",
      redistrictingEnabled: false,
    });
    db.collectionMocks["elections"] = db.collection("elections");
    db.collectionMocks["elections"].find.mockReturnValue(makeCursor([election]));
    db.collectionMocks["politicalParties"] = db.collection("politicalParties");
    db.collectionMocks["politicalParties"].find.mockReturnValue(makeCursor([]));
    db.collectionMocks["electionCandidates"] = db.collection("electionCandidates");
    db.collectionMocks["electionCandidates"].find.mockReturnValue(makeCursor(candidates));
    db.collectionMocks["electionVoteTallies"] = db.collection("electionVoteTallies");
    db.collectionMocks["electionVoteTallies"].find.mockReturnValue(makeCursor([]));
    db.collectionMocks["electionVoteTallies"].findOne.mockResolvedValue(null);

    const { fetchEnrichedCandidates } = await import("@/lib/electionEngine");
    vi.mocked(fetchEnrichedCandidates).mockResolvedValue(
      candidates.map((c) => ({
        candidateId: c._id.toString(),
        charEP: 0,
        charSP: 0,
        favorability: 50,
        politicalInfluence: 100,
      })) as never
    );
    const { calcPrimaryScore } = await import("@/lib/primaryScore");
    vi.mocked(calcPrimaryScore)
      .mockReturnValueOnce(100)
      .mockReturnValueOnce(80)
      .mockReturnValueOnce(60);

    const { POST } = await import("./route");
    const res = await POST();
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.eliminated).toBe(2);
  });

  it("keeps top-1 US senate candidate per party", async () => {
    const electionId = new ObjectId();
    const now = new Date();
    const election = {
      _id: electionId,
      electionType: "senate",
      status: "active",
      countryId: "US",
      state: "CA",
      primaryEndTime: new Date(now.getTime() - 3600_000),
      endTime: new Date(now.getTime() + 3600_000),
    };
    const candidates = [1, 2, 3].map((i) => ({
      _id: new ObjectId(),
      electionId,
      party: "DEM",
      characterName: `C${i}`,
      characterId: new ObjectId(),
      isNPP: false,
      status: "active",
    }));

    db.collectionMocks["elections"] = db.collection("elections");
    db.collectionMocks["elections"].find.mockReturnValue(makeCursor([election]));
    db.collectionMocks["politicalParties"] = db.collection("politicalParties");
    db.collectionMocks["politicalParties"].find.mockReturnValue(makeCursor([]));
    db.collectionMocks["electionCandidates"] = db.collection("electionCandidates");
    db.collectionMocks["electionCandidates"].find.mockReturnValue(makeCursor(candidates));
    db.collectionMocks["electionVoteTallies"] = db.collection("electionVoteTallies");
    db.collectionMocks["electionVoteTallies"].find.mockReturnValue(makeCursor([]));
    db.collectionMocks["electionVoteTallies"].findOne.mockResolvedValue(null);

    const { fetchEnrichedCandidates } = await import("@/lib/electionEngine");
    vi.mocked(fetchEnrichedCandidates).mockResolvedValue(
      candidates.map((c) => ({
        candidateId: c._id.toString(),
        charEP: 0,
        charSP: 0,
        favorability: 50,
        politicalInfluence: 100,
      })) as never
    );
    const { calcPrimaryScore } = await import("@/lib/primaryScore");
    vi.mocked(calcPrimaryScore)
      .mockReturnValueOnce(100)
      .mockReturnValueOnce(80)
      .mockReturnValueOnce(60);

    const { POST } = await import("./route");
    const res = await POST();
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.eliminated).toBe(2);
    const withdrawCall = db.collectionMocks["electionCandidates"].updateMany.mock.calls[0];
    const withdrawnIds = withdrawCall[0]._id.$in.map((id: ObjectId) => id.toString());
    expect(withdrawnIds).toHaveLength(2);
    expect(withdrawnIds).not.toContain(candidates[0]._id.toString());
  });

  it("skips UK election when all parties already have exactly maxAdvancing candidates", async () => {
    const electionId = new ObjectId();
    const now = new Date();
    const election = {
      _id: electionId,
      electionType: "commons",
      status: "active",
      countryId: "UK",
      state: "SWE",
      primaryEndTime: new Date(now.getTime() - 3600_000),
      endTime: new Date(now.getTime() + 3600_000),
    };
    const candidates = [1, 2, 3].map((i) => ({
      _id: new ObjectId(),
      electionId,
      party: "uk_labour",
      characterName: `C${i}`,
      characterId: new ObjectId(),
      isNPP: false,
      status: "active",
    }));

    db.collectionMocks["elections"] = db.collection("elections");
    db.collectionMocks["elections"].find.mockReturnValue(makeCursor([election]));
    db.collectionMocks["politicalParties"] = db.collection("politicalParties");
    db.collectionMocks["politicalParties"].find.mockReturnValue(makeCursor([]));
    db.collectionMocks["electionCandidates"] = db.collection("electionCandidates");
    db.collectionMocks["electionCandidates"].find.mockReturnValue(makeCursor(candidates));
    db.collectionMocks["electionVoteTallies"] = db.collection("electionVoteTallies");
    // Tally already exists — route should not re-init
    db.collectionMocks["electionVoteTallies"].find.mockReturnValue(makeCursor([{ electionId }]));
    db.collectionMocks["electionVoteTallies"].findOne.mockResolvedValue({ electionId });

    const { POST } = await import("./route");
    const res = await POST();
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.eliminated).toBe(0);
    expect(data.talliesCreated).toBe(0);
    expect(db.collectionMocks["electionCandidates"].updateMany).not.toHaveBeenCalled();
    const { initElectionVoteTally } = await import("@/lib/electionEngine");
    expect(initElectionVoteTally).not.toHaveBeenCalled();
  });
});
