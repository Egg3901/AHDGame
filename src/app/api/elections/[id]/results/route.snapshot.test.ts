/**
 * A finished race is served from its frozen snapshot, not recomputed.
 *
 * The fixture below is the defect in miniature. The race ran in 1960, when the
 * college held 531 votes and 266 won it. The world has since advanced to 1995,
 * so a live recomputation scores it against the modern map instead, and the
 * page tells the reader a race was won on a threshold that did not exist at the
 * time. The snapshot is what stops that.
 */
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

const SNAPSHOT_TOTAL_EV = 531;
const SNAPSHOT_EV_NEEDED = 266;

function snapshotDoc(over: Record<string, unknown> = {}) {
  return {
    _id: new ObjectId(),
    electionId,
    countryId: "US",
    electionType: "president",
    cycle: 3,
    electionYear: 1960,
    schemaVersion: 1,
    capturedAt: new Date("2026-03-03T00:00:00.000Z"),
    capturedAtTurn: 412,
    totalEv: SNAPSHOT_TOTAL_EV,
    evNeeded: SNAPSHOT_EV_NEEDED,
    totalSeats: 0,
    candidates: [
      {
        id: candA.toString(),
        name: "Alice Alpha",
        party: "1",
        partyName: "Unity As It Was",
        partyColor: "#111111",
        isNPP: false,
        totalVotes: 900_000,
        voteSharePct: 100,
        electoralVotes: 300,
        leadingElectoralVotes: 0,
      },
    ],
    units: [],
    national: null,
    summary: {
      totalVotes: 900_000,
      unitsReporting: 1,
      totalUnits: 1,
      unitsCalled: 1,
      projectedWinner: candA.toString(),
    },
    ...over,
  };
}

function seedDb(
  db: MockDb,
  opts: { status?: string; snapshot?: Record<string, unknown> | null } = {}
) {
  for (const name of [
    "gameState",
    "elections",
    "electionCandidates",
    "electionVoteTallies",
    "politicalParties",
    "states",
    "electionResultSnapshots",
  ]) {
    db.collection(name);
  }
  db.collectionMocks.gameState!.findOne.mockResolvedValue({
    _id: "current",
    currentTurn: 900,
    // 1995: past the 23rd Amendment, so a live recompute would not produce 531.
    currentYear: 1995,
    nextScheduledTurn: null,
    pausedAt: null,
    liveElectionResultsEnabled: true,
  });
  db.collectionMocks.elections!.findOne.mockResolvedValue({
    _id: electionId,
    countryId: "US",
    electionType: "president",
    state: "US",
    cycle: 3,
    electionYear: 1960,
    status: opts.status ?? "resolved",
    startTurn: 100,
    endTurn: 200,
    totalSeats: 0,
    updatedAt: new Date("2026-07-07T12:00:00Z"),
  });
  db.collectionMocks.electionResultSnapshots!.findOne.mockResolvedValue(
    opts.snapshot === null ? null : (opts.snapshot ?? snapshotDoc())
  );

  // Live-computation fallback fixtures, so the non-snapshot paths still render.
  db.collectionMocks.electionCandidates!.find.mockReturnValue({
    toArray: vi
      .fn()
      .mockResolvedValue([
        { _id: candA, electionId, characterName: "Alice Now", party: "1", status: "active" },
      ]),
    sort: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    project: vi.fn().mockReturnThis(),
  });
  db.collectionMocks.electionVoteTallies!.findOne.mockResolvedValue({
    _id: electionId,
    electionId,
    state: "US",
    totalVotes: { [candA.toString()]: 900_000 },
    totalVotesByUnit: {},
    candidateNames: {},
    candidateParties: {},
    turnSnapshots: [],
    finalized: true,
    updatedAt: new Date("2026-07-07T12:00:00Z"),
  });
  const cursor = (rows: unknown[]) => ({
    toArray: vi.fn().mockResolvedValue(rows),
    project: vi.fn().mockReturnThis(),
    sort: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
  });
  db.collectionMocks.politicalParties!.find.mockReturnValue(
    cursor([{ sequentialId: 1, name: "Unity Today", abbreviation: "UNI", color: "#3B82F6" }])
  );
  db.collectionMocks.states!.find.mockReturnValue(cursor([{ _id: "US", name: "United States" }]));
}

describe("GET /api/elections/[id]/results — frozen snapshots", () => {
  let db: MockDb;

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
    const { getAuthUser } = await import("@/lib/auth");
    vi.mocked(getAuthUser).mockResolvedValue(null);
  });

  const call = async () => {
    const { GET } = await import("./route");
    const id = electionId.toString();
    return (GET as (req: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>)(
      new Request(`http://test/api/elections/${id}/results`),
      { params: Promise.resolve({ id }) }
    );
  };

  it("serves the college totals that were in force, not today's", async () => {
    seedDb(db);
    const body = await (await call()).json();
    expect(body.election.totalEv).toBe(SNAPSHOT_TOTAL_EV);
    expect(body.election.evNeeded).toBe(SNAPSHOT_EV_NEEDED);
  });

  it("serves the party identity as it stood, not as it stands now", async () => {
    seedDb(db);
    const body = await (await call()).json();
    expect(body.candidates[0].partyName).toBe("Unity As It Was");
    expect(body.candidates[0].partyColor).toBe("#111111");
  });

  it("dates the payload to the capture, so polls keep 304-ing", async () => {
    seedDb(db);
    const body = await (await call()).json();
    expect(body.lastUpdated).toBe("2026-03-03T00:00:00.000Z");
    expect(body.election.finalHour).toBeNull();
  });

  it("ignores a snapshot on a race still running and computes live", async () => {
    // A stale snapshot must never freeze a race that is still taking votes.
    seedDb(db, { status: "active" });
    const body = await (await call()).json();
    expect(body.candidates[0].name).toBe("Alice Now");
    expect(body.candidates[0].partyName).toBe("Unity Today");
  });

  it("falls back to live computation when the schema version is unreadable", async () => {
    seedDb(db, { snapshot: snapshotDoc({ schemaVersion: 99 }) });
    const body = await (await call()).json();
    expect(body.candidates[0].partyName).toBe("Unity Today");
  });

  it("falls back to live computation when no snapshot was ever captured", async () => {
    seedDb(db, { snapshot: null });
    const body = await (await call()).json();
    expect(body.candidates[0].partyName).toBe("Unity Today");
  });
});
