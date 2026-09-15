import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getAuthUserWithCharacter: vi.fn() }));
vi.mock("@/lib/time/gameTime", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/time/gameTime")>()),
  getGameTime: vi.fn().mockResolvedValue({
    currentTurn: 5,
    effectiveNow: new Date(),
    lastTurnProcessed: new Date(),
    isActive: true,
    pausedAt: null,
    startingYear: 2019,
  }),
}));
vi.mock("@/lib/elections/electionParamResolution", () => ({
  resolveElectionRouteParam: vi.fn(),
}));

let db: MockDb;

const electionId = new ObjectId();
const campaignId = new ObjectId();
const candidateId = new ObjectId();
const userId = new ObjectId();

function makeRequest() {
  return new Request(`http://localhost/api/elections/${electionId.toString()}/campaigns`);
}

function makeUser() {
  return {
    userId: userId.toString(),
    username: "tester",
    email: "tester@example.com",
    role: "user",
    isAdmin: false,
    hasCharacter: true,
    character: {
      _id: candidateId,
      userId,
      name: "Nominee",
      countryId: "US",
      party: "1",
    },
  };
}

async function setUp() {
  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue(db as unknown as Db);

  const { getAuthUserWithCharacter } = await import("@/lib/auth");
  vi.mocked(getAuthUserWithCharacter).mockResolvedValue(makeUser() as never);

  const { resolveElectionRouteParam } = await import("@/lib/elections/electionParamResolution");
  vi.mocked(resolveElectionRouteParam).mockResolvedValue({
    ok: true,
    election: {
      _id: electionId,
      countryId: "US",
      electionType: "president",
      status: "active",
      primaryEndTurn: 20,
      endTurn: 40,
    },
  } as never);

  db.collection("campaigns");
  db.collection("characters");
  db.collection("npps");
  db.collection("politicalParties");
  db.collection("exchangeRates");

  db.collectionMocks["campaigns"]!.find.mockReturnValue({
    toArray: vi.fn().mockResolvedValue([
      {
        _id: campaignId,
        electionId,
        candidateId,
        candidateIsNPP: false,
        party: "1",
        funds: 125_000,
        actions: 10,
        fundraisingLevel: 1,
        oppositionResearchLevel: 0,
        groundGameLevel: 0,
        mediaSpendingLevel: 0,
        totalFundsGenerated: 0,
        totalFundsSpent: 0,
        campaignStrength: 3,
      },
    ]),
  });
  db.collectionMocks["characters"]!.find.mockReturnValue({
    toArray: vi.fn().mockResolvedValue([{ _id: candidateId, name: "Nominee" }]),
  });
}

describe("GET /api/elections/[id]/campaigns", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
  });

  it("projects the activity history out of the query rather than reading it", async () => {
    // This is a list endpoint over every campaign in the election, and a
    // campaign keeps 200 activity entries. Reading them here would carry twenty
    // times the weight of the old ten-entry array for a field nothing renders.
    await setUp();

    const { GET } = await import("./route");
    await GET(makeRequest(), { params: Promise.resolve({ id: electionId.toString() }) });

    const [, options] = db.collectionMocks["campaigns"]!.find.mock.calls[0];
    expect((options as { projection?: Record<string, number> })?.projection).toMatchObject({
      activityHistory: 0,
    });
  });

  it("does not return an activity history to the campaign's own side", async () => {
    // Neither consumer of this endpoint reads the field; the ledger sources its
    // history from the per-campaign detail endpoint instead.
    await setUp();

    const { GET } = await import("./route");
    const res = await GET(makeRequest(), {
      params: Promise.resolve({ id: electionId.toString() }),
    });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.campaigns).toHaveLength(1);
    expect(data.campaigns[0]).not.toHaveProperty("activityHistory");
  });
});
