import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getAuthUser: vi.fn(async () => null) }));
vi.mock("@/lib/observability/apiMetrics", () => ({
  withApiMetrics: (_name: string, handler: unknown) => handler,
}));

const electionId = new ObjectId();
const candA = new ObjectId();
const candB = new ObjectId();
const candC = new ObjectId();

function seedDb(db: MockDb, overrides: { gameState?: Record<string, unknown> } = {}) {
  // Collections are lazily created — touch each one before configuring its mocks.
  for (const name of [
    "gameState",
    "elections",
    "electionCandidates",
    "electionVoteTallies",
    "politicalParties",
    "states",
  ]) {
    db.collection(name);
  }
  db.collectionMocks.gameState!.findOne.mockResolvedValue({
    _id: "current",
    currentTurn: 40,
    nextScheduledTurn: null,
    pausedAt: null,
    liveElectionResultsEnabled: true,
    ...overrides.gameState,
  });
  db.collectionMocks.elections!.findOne.mockResolvedValue({
    _id: electionId,
    countryId: "US",
    electionType: "governor",
    state: "PA",
    cycle: 3,
    status: "active",
    startTurn: 0,
    endTurn: 48,
    totalSeats: 1,
    updatedAt: new Date("2026-07-07T12:00:00Z"),
  });
  db.collectionMocks.electionCandidates!.find.mockReturnValue({
    toArray: vi.fn().mockResolvedValue([
      {
        _id: candA,
        electionId,
        characterName: "Alice Alpha",
        party: "1",
        status: "active",
      },
      {
        _id: candB,
        electionId,
        characterName: "Bob Beta",
        party: "2",
        status: "withdrawn",
      },
      {
        _id: candC,
        electionId,
        characterName: "Zero Votes",
        party: "2",
        status: "withdrawn",
      },
    ]),
    sort: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    project: vi.fn().mockReturnThis(),
  });
  db.collectionMocks.electionVoteTallies!.findOne.mockResolvedValue({
    _id: electionId,
    electionId,
    state: "PA",
    totalVotes: { [candA.toString()]: 900_000, [candB.toString()]: 100_000 },
    candidateNames: {},
    candidateParties: {},
    turnSnapshots: [],
    finalized: false,
    updatedAt: new Date("2026-07-07T12:00:00Z"),
  });
  const partiesCursor = {
    toArray: vi
      .fn()
      .mockResolvedValue([
        { sequentialId: 1, name: "Unity", abbreviation: "UNI", color: "#3B82F6" },
      ]),
    project: vi.fn().mockReturnThis(),
    sort: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
  };
  db.collectionMocks.politicalParties!.find.mockReturnValue(partiesCursor);
  const statesCursor = {
    toArray: vi.fn().mockResolvedValue([{ _id: "PA", name: "Pennsylvania" }]),
    project: vi.fn().mockReturnThis(),
    sort: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
  };
  db.collectionMocks.states!.find.mockReturnValue(statesCursor);
}

describe("GET /api/elections/[id]/results", () => {
  let db: MockDb;

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
    const { getAuthUser } = await import("@/lib/auth");
    vi.mocked(getAuthUser).mockResolvedValue(null);
  });

  const call = async (id: string = electionId.toString()) => {
    const { GET } = await import("./route");
    return (GET as (req: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>)(
      new Request(`http://test/api/elections/${id}/results`),
      { params: Promise.resolve({ id }) }
    );
  };

  it("returns shaped results for an active election", async () => {
    seedDb(db);
    const res = await call();
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.election.id).toBe(electionId.toString());
    expect(body.election.electionType).toBe("governor");
    // Withdrawn candidates stay while they hold votes (resolution marks
    // everyone withdrawn); withdrawn with zero votes drop off the roster.
    expect(body.candidates.map((c: { name: string }) => c.name)).toEqual([
      "Alice Alpha",
      "Bob Beta",
    ]);
    expect(body.candidates[0]).toMatchObject({
      name: "Alice Alpha",
      partyName: "Unity",
      partyColor: "#3B82F6",
      totalVotes: 900_000,
    });
    // Single region unit, leading but never called mid-campaign.
    expect(body.units).toHaveLength(1);
    expect(body.units[0].name).toBe("Pennsylvania");
    expect(body.units[0].called).toBe(false);
    expect(body.summary.totalVotes).toBe(1_000_000);
    expect(body.election.finalHour).toBeNull();
    expect(body.isAdmin).toBe(false);
  });

  it("computes a final-hour drip window in the last turn", async () => {
    seedDb(db, {
      gameState: {
        currentTurn: 47,
        nextScheduledTurn: new Date(Date.now() + 30 * 60 * 1000),
      },
    });
    const res = await call();
    const body = await res.json();
    expect(body.election.finalHour).not.toBeNull();
    expect(body.election.finalHour.progress).toBeGreaterThan(0.4);
    expect(body.election.finalHour.progress).toBeLessThan(0.6);
  });

  it("403s for non-admins while the gate is off", async () => {
    seedDb(db, { gameState: { liveElectionResultsEnabled: false } });
    const res = await call();
    expect(res.status).toBe(403);
  });

  it("lets admins through while the gate is off", async () => {
    seedDb(db, { gameState: { liveElectionResultsEnabled: false } });
    const { getAuthUser } = await import("@/lib/auth");
    vi.mocked(getAuthUser).mockResolvedValue({
      userId: "u1",
      username: "admin",
      email: "a@test",
      role: "admin",
      isAdmin: true,
    });
    const res = await call();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.isAdmin).toBe(true);
  });

  it("404s on an unknown election", async () => {
    seedDb(db);
    db.collectionMocks.elections!.findOne.mockResolvedValue(null);
    const res = await call(new ObjectId().toString());
    expect(res.status).toBe(404);
  });

  it("400s on a malformed id", async () => {
    seedDb(db);
    const res = await call("not-an-objectid");
    expect(res.status).toBe(400);
  });
});
