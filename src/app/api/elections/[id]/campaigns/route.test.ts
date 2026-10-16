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
    const { getAuthUserWithCharacter } = await import("@/lib/auth");
    vi.mocked(getAuthUserWithCharacter).mockResolvedValue(null);
    db = createMockDb();
    for (const c of [
      "campaigns",
      "electionCandidates",
      "characters",
      "npps",
      "politicalParties",
      "campaignFieldOffices",
    ]) {
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
    expect(body.campaigns[0]).not.toHaveProperty("budget");
    expect(body.campaigns[0]).not.toHaveProperty("nextUpgradeCosts");
  });
});

// Budget previews must use the same era, frozen currency and upkeep as the turn.
describe("campaign list budget preview", () => {
  it.each([
    {
      suspended: false,
      countryId: "US",
      preset: "1991-default",
      priceLevel: 0.35808,
      rate: 1,
      currency: "USD",
      count: 2,
      charged: 2,
      trees: true,
    },
    {
      suspended: true,
      countryId: "US",
      preset: "1991-default",
      priceLevel: 0.35808,
      rate: 1,
      currency: "USD",
      count: 2,
      charged: 2,
      trees: true,
    },
    {
      suspended: false,
      countryId: "FR",
      electionType: "president",
      officeAnchor: 6_000,
      preset: "2027-default",
      priceLevel: 1.28579,
      rate: 0.82,
      currency: "EUR",
      count: 2,
      charged: 0,
      trees: true,
    },
    {
      suspended: false,
      countryId: "UK",
      electionType: "president",
      officeAnchor: 6_000,
      preset: "1991-default",
      priceLevel: 0.35808,
      rate: 0.62,
      currency: "GBP",
      count: 0,
      charged: 0,
      trees: false,
    },
    {
      suspended: false,
      countryId: "JP",
      electionType: "house",
      officeAnchor: 1_800,
      preset: "1991-default",
      priceLevel: 0.35808,
      rate: 150,
      currency: "JPY",
      count: 3,
      charged: 3,
      trees: false,
    },
  ])(
    "previews $countryId $preset suspended=$suspended trees=$trees",
    async ({
      suspended,
      countryId,
      preset,
      priceLevel,
      rate,
      currency,
      count,
      charged,
      trees,
      electionType = "president",
      officeAnchor = 6_000,
    }) => {
      const db = createMockDb();
      const row = {
        ...campaign(runningId, "active"),
        fundraisingLevel: 2,
        groundGameLevel: 3,
        mediaSpendingLevel: 2,
        fieldOfficeCount: 99,
        fundraisingTree: { starter: true, a: 2, b: 1, c: 0 },
        groundGameTree: { starter: true, a: 1, b: 2, c: 1 },
        mediaSpendingTree: { starter: true, a: 2, b: 1, c: 0 },
      };
      if (!trees)
        Object.assign(row, {
          fundraisingTree: undefined,
          groundGameTree: undefined,
          mediaSpendingTree: undefined,
        });
      const otherRow = campaign(withdrawnId, "active");
      const rows: Record<string, unknown[]> = {
        campaigns: [row, otherRow],
        electionCandidates: [
          { characterId: runningId, status: "active", campaignSuspended: suspended },
          { characterId: withdrawnId, status: "active" },
        ],
        characters: [
          { _id: runningId, name: "Nominee" },
          { _id: withdrawnId, name: "Other nominee" },
        ],
        campaignFieldOffices: [
          ...Array.from({ length: count }, () => ({ campaignId: row._id, electionId })),
          { campaignId: otherRow._id, electionId },
        ],
      };
      for (const [name, docs] of Object.entries(rows)) {
        const cursor = { project: () => cursor, toArray: async () => docs };
        db.collection(name).find.mockReturnValue(cursor);
      }
      db.collection("gameConfig").findOne.mockResolvedValue({ campaignEraPriceLevelEnabled: true });
      db.collection("gameState").findOne.mockResolvedValue({ preset });
      const { resolveElectionRouteParam } = await import("@/lib/elections/electionParamResolution");
      vi.mocked(resolveElectionRouteParam).mockResolvedValueOnce({
        ok: true,
        election: { _id: electionId, countryId, electionType, status: "active" },
      } as never);
      const { loadCampaignCurrencyRates } = await import("@/lib/campaigns/campaignCurrency");
      vi.mocked(loadCampaignCurrencyRates).mockResolvedValue({
        USD: 1,
        EUR: 0.82,
        FRF: 6.75,
        GBP: 0.62,
        JPY: 150,
      });
      const { getDb } = await import("@/lib/mongodb");
      vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
      const { getAuthUserWithCharacter } = await import("@/lib/auth");
      vi.mocked(getAuthUserWithCharacter).mockResolvedValue({
        userId: new ObjectId().toString(),
        isAdmin: true,
      } as never);
      const { calculateCampaignIncome } = await import("@/lib/campaigns/income");
      const { calculateMaintenanceCosts } = await import("@/lib/campaigns/maintenance");
      const { getTreeMaintenanceCost, getMaintenanceCost } =
        await import("@/lib/campaigns/upgradeCosts");
      const { GET } = await import("./route");
      const res = await GET(new Request("http://localhost/api/elections/test/campaigns"), {
        params: Promise.resolve({ id: "test" }),
      });
      expect(res.status).toBe(200);
      const { campaigns } = await res.json();
      const budget = campaigns[0].budget;
      const local = (n: number) => Math.round(n * priceLevel * rate);
      const income = suspended ? 0 : local(calculateCampaignIncome(row as never, electionType));
      const ops = suspended ? 0 : local(calculateMaintenanceCosts(row as never, electionType));
      const offices = charged * local(officeAnchor);
      expect(campaigns[0].currencyCode).toBe(currency);
      expect(budget.income.total).toBe(income);
      expect(budget.expenses.fieldOfficeMaintenance).toBe(offices);
      expect(budget.expenses.groundGameMaintenance).toBe(
        suspended
          ? 0
          : local(
              trees
                ? getTreeMaintenanceCost("groundGame", row.groundGameTree, electionType)
                : getMaintenanceCost("groundGame", row.groundGameLevel, electionType)
            )
      );
      expect(budget.expenses.fundraisingMaintenance).toBe(
        suspended
          ? 0
          : local(
              trees
                ? getTreeMaintenanceCost("fundraising", row.fundraisingTree, electionType)
                : getMaintenanceCost("fundraising", row.fundraisingLevel, electionType)
            )
      );
      expect(budget.expenses.mediaSpendingMaintenance).toBe(
        suspended
          ? 0
          : local(
              trees
                ? getTreeMaintenanceCost("mediaSpending", row.mediaSpendingTree, electionType)
                : getMaintenanceCost("mediaSpending", row.mediaSpendingLevel, electionType)
            )
      );
      expect(budget.expenses.total).toBe(ops + offices);
      expect(campaigns[1].budget.expenses.fieldOfficeMaintenance).toBe(
        countryId === "FR" ? 0 : local(officeAnchor)
      );
      expect(budget.netIncome).toBe(income - ops - offices);
      expect(db.collectionMocks.campaignFieldOffices!.find).toHaveBeenCalledTimes(1);
      expect(db.collectionMocks.campaignFieldOffices!.find).toHaveBeenCalledWith(
        { campaignId: { $in: [row._id, otherRow._id] }, electionId },
        { projection: { campaignId: 1 } }
      );
    }
  );
});
