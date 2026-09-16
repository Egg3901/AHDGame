/**
 * Integration tests for GET /api/elections/[id]/campaigns — the Campaign
 * Operations list on the election page.
 *
 * Regression: a withdrawn candidate kept appearing in the list because the
 * route trusted `campaign.status !== "archived"`, a flag ~10 different
 * withdrawal paths each had to remember to set. Live evidence on the US
 * presidential race: Vladimir Iskra and Keiko Fujimori were both withdrawn by
 * a party switch (`withdrawFromMismatchedPrimaries`), which left their
 * campaigns `status: "active"` and rendered them next to candidates still
 * running. The list now keys off the candidacy itself, which cannot drift.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));

vi.mock("@/lib/auth", () => ({
  getAuthUserWithCharacter: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/lib/time/gameTime", () => ({
  getGameTime: vi.fn().mockResolvedValue({
    currentTurn: 892,
    lastTurnProcessed: new Date("2026-09-15"),
    isActive: true,
    pausedAt: null,
    effectiveNow: new Date("2026-09-15"),
  }),
}));

vi.mock("@/lib/campaigns/campaignCurrency", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/campaigns/campaignCurrency")>();
  return { ...actual, loadCampaignCurrencyRates: vi.fn().mockResolvedValue({}) };
});

const electionId = new ObjectId();
const runningId = new ObjectId();
const withdrawnId = new ObjectId();

vi.mock("@/lib/elections/electionParamResolution", () => ({
  resolveElectionRouteParam: vi.fn(async () => ({
    ok: true,
    election: {
      _id: electionId,
      countryId: "US",
      electionType: "president",
      state: "US",
      status: "active",
    },
  })),
}));

function campaign(candidateId: ObjectId, status: string) {
  return {
    _id: new ObjectId(),
    electionId,
    candidateId,
    candidateIsNPP: false,
    party: "1",
    status,
    funds: 1_000_000,
    actions: 50,
    fundraisingLevel: 0,
    oppositionResearchLevel: 0,
    groundGameLevel: 0,
    mediaSpendingLevel: 0,
    activityHistory: [],
    totalFundsGenerated: 0,
    totalFundsSpent: 0,
    totalActionsGenerated: 0,
    totalActionsSpent: 0,
  };
}

describe("GET /api/elections/[id]/campaigns", () => {
  let db: MockDb;

  function stubFind(collection: string, docs: unknown[]) {
    const cursor = {
      project: () => cursor,
      sort: () => cursor,
      limit: () => cursor,
      toArray: async () => docs,
    };
    db.collectionMocks[collection]!.find.mockReturnValue(cursor as never);
  }

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    for (const c of ["campaigns", "electionCandidates", "characters", "npps", "politicalParties"]) {
      db.collection(c);
      stubFind(c, []);
    }
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
  });

  it("omits a withdrawn candidate whose campaign was never archived", async () => {
    // Both campaigns are status:"active" — exactly the live data shape. Only the
    // candidacy distinguishes who is still in the race.
    stubFind("campaigns", [campaign(runningId, "active"), campaign(withdrawnId, "active")]);
    stubFind("electionCandidates", [
      { _id: new ObjectId(), electionId, characterId: runningId, status: "active" },
    ]);
    stubFind("characters", [
      { _id: runningId, name: "Sean Oppenheimer", sequentialId: 11 },
      { _id: withdrawnId, name: "Vladimir Iskra", sequentialId: 12 },
    ]);

    const { GET } = await import("./route");
    const res = await GET(new Request("http://localhost/api/elections/US-president/campaigns"), {
      params: Promise.resolve({ id: "US-president" }),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.campaigns.map((c: { candidateName: string }) => c.candidateName)).toEqual([
      "Sean Oppenheimer",
    ]);
  });

  it("returns an empty list without reading candidacies when the race has no campaigns", async () => {
    // Campaign Manager is US-only, so most races hit this path on every page
    // load. It must not pay for the candidacy read.
    stubFind("campaigns", []);

    const { GET } = await import("./route");
    const res = await GET(new Request("http://localhost/api/elections/UK-commons/campaigns"), {
      params: Promise.resolve({ id: "UK-commons" }),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.campaigns).toEqual([]);
    expect(db.collectionMocks.electionCandidates!.find).not.toHaveBeenCalled();
  });

  it("projects the activity history out of the campaigns query", async () => {
    // This endpoint serves every campaign in the election at once and returns
    // no activity history, so it must not read one either: a campaign keeps 200
    // entries now rather than 10.
    stubFind("campaigns", [campaign(runningId, "active")]);
    stubFind("electionCandidates", [
      { _id: new ObjectId(), electionId, characterId: runningId, status: "active" },
    ]);
    stubFind("characters", [{ _id: runningId, name: "Ariane Yeong", sequentialId: 11 }]);

    const { GET } = await import("./route");
    await GET(new Request("http://localhost/api/elections/US-president/campaigns"), {
      params: Promise.resolve({ id: "US-president" }),
    });

    const [, options] = db.collectionMocks.campaigns!.find.mock.calls[0];
    expect((options as { projection?: Record<string, number> })?.projection).toMatchObject({
      activityHistory: 0,
    });
  });

  it("returns no activity history even to the campaign's own candidate", async () => {
    // The nominee gets the privileged payload. The ledger reads its history from
    // the per-campaign detail endpoint, and neither consumer of this list reads
    // the field, so it is not shipped here at any access level.
    const { getAuthUserWithCharacter } = await import("@/lib/auth");
    vi.mocked(getAuthUserWithCharacter).mockResolvedValue({
      userId: new ObjectId().toString(),
      username: "nominee",
      email: "nominee@example.com",
      role: "user",
      isAdmin: false,
      hasCharacter: true,
      character: { _id: runningId, name: "Ariane Yeong", countryId: "US", party: "1" },
    } as never);

    stubFind("campaigns", [campaign(runningId, "active")]);
    stubFind("electionCandidates", [
      { _id: new ObjectId(), electionId, characterId: runningId, status: "active" },
    ]);
    stubFind("characters", [{ _id: runningId, name: "Ariane Yeong", sequentialId: 11 }]);

    const { GET } = await import("./route");
    const res = await GET(new Request("http://localhost/api/elections/US-president/campaigns"), {
      params: Promise.resolve({ id: "US-president" }),
    });
    const body = await res.json();

    expect(body.campaigns).toHaveLength(1);
    expect(body.campaigns[0].isExact).toBe(true);
    expect(body.campaigns[0]).not.toHaveProperty("activityHistory");
  });

  it("still lists a candidate who is actively running", async () => {
    stubFind("campaigns", [campaign(runningId, "active")]);
    stubFind("electionCandidates", [
      { _id: new ObjectId(), electionId, characterId: runningId, status: "active" },
    ]);
    stubFind("characters", [{ _id: runningId, name: "Ariane Yeong", sequentialId: 11 }]);

    const { GET } = await import("./route");
    const res = await GET(new Request("http://localhost/api/elections/US-president/campaigns"), {
      params: Promise.resolve({ id: "US-president" }),
    });
    const body = await res.json();

    expect(body.campaigns).toHaveLength(1);
    expect(body.campaigns[0].candidateName).toBe("Ariane Yeong");
  });
});
