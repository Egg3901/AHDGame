import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { makeCorporation } from "@/lib/test-utils/factories";
import { getFogFactor } from "@/lib/corporations/financialFogOfWar";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/gameState", () => ({
  getGameState: vi.fn().mockResolvedValue({ currentTurn: 10 }),
}));
vi.mock("@/lib/auth", () => ({
  getAuthUser: vi.fn().mockResolvedValue(null),
}));
vi.mock("@/lib/corporations/queries/corporationDetail", () => ({
  loadCorporationDetailView: vi.fn(),
}));

let db: MockDb;

beforeEach(async () => {
  db = createMockDb();
  vi.clearAllMocks();
  db.collection("corporations");
  const { getGameState } = await import("@/lib/gameState");
  vi.mocked(getGameState).mockResolvedValue({ currentTurn: 10 } as never);
});

async function wireDb() {
  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue(db as never);
  const { getGameState } = await import("@/lib/gameState");
  vi.mocked(getGameState).mockResolvedValue({ currentTurn: 10 } as never);
}

describe("GET /api/corporations/[id]", () => {
  it("returns 400 for invalid corporation id param", async () => {
    await wireDb();
    const { GET } = await import("./route");
    const res = await GET(new Request("http://localhost/api/corporations/not-valid-id"), {
      params: Promise.resolve({ id: "not-valid-id" }),
    });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("Invalid");
  });

  it("returns 404 when corporation does not exist", async () => {
    await wireDb();
    const hex = new ObjectId().toString();
    db.collectionMocks["corporations"]!.findOne.mockResolvedValue(null);

    const { GET } = await import("./route");
    const res = await GET(new Request(`http://localhost/api/corporations/${hex}`), {
      params: Promise.resolve({ id: hex }),
    });
    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error).toContain("not found");
  });

  it("delegates successful detail reads to the corporation detail query", async () => {
    await wireDb();
    const corporation = makeCorporation({
      _id: new ObjectId(),
      countryId: "US",
      headquartersState: "CA",
      liquidCurrencyCode: "USD",
    });
    db.collectionMocks["corporations"]!.findOne.mockResolvedValue(corporation);

    const { getAuthUser } = await import("@/lib/auth");
    vi.mocked(getAuthUser).mockResolvedValue({ userId: corporation.userId.toString() } as never);

    const detailPayload = {
      corporation: { _id: corporation._id.toString(), name: corporation.name },
      ceo: null,
      financials: { totalRevenue: 0 },
      sectors: [],
      balanceSheet: { assets: {}, liabilities: {}, equity: {} },
    };
    const { loadCorporationDetailView } =
      await import("@/lib/corporations/queries/corporationDetail");
    vi.mocked(loadCorporationDetailView).mockResolvedValue(detailPayload as never);

    const { GET } = await import("./route");
    const res = await GET(new Request(`http://localhost/api/corporations/${corporation._id}`), {
      params: Promise.resolve({ id: corporation._id.toString() }),
    });

    expect(res.status).toBe(200);
    expect(loadCorporationDetailView).toHaveBeenCalledWith(
      expect.objectContaining({
        db,
        corporation,
        currentTurn: 10,
        viewerUserId: expect.any(String),
      })
    );
    // Response wraps the detail payload with isPrivate and financialFogOfWar metadata.
    // openPrivatizationVoteId is nested under corporation because the page stores
    // data.corporation directly.
    await expect(res.json()).resolves.toEqual({
      ...detailPayload,
      corporation: {
        ...detailPayload.corporation,
        viewerIsControllingParentCeo: false,
        openPrivatizationVoteId: null,
      },
      isPrivate: false,
      financialFogOfWar: null,
      // Procurement position. Present on every corporation, empty for one the state has
      // never contracted — a missing block would read to the page as "still loading".
      defenceContracts: {
        contracts: [],
        pendingCount: 0,
        gradeCeiling: 0,
        totalEarned: 0,
        // Gross earnings alone became misleading once deliveries carried a production cost:
        // a corporation can take a fat headline number on a contract it lost money on.
        totalNetMargin: 0,
        totalEncumbered: 0,
      },
    });
  });

  it("exposes a private subsidiary's books only to its controlling parent CEO", async () => {
    await wireDb();
    const subsidiary = makeCorporation({
      _id: new ObjectId(),
      countryId: "US",
      headquartersState: "CA",
      liquidCurrencyCode: "USD",
      isPrivate: true,
      liquidCapital: 125_000,
    });
    const parent = makeCorporation({ _id: new ObjectId(), userId: new ObjectId() });
    const detailPayload = {
      corporation: {
        _id: subsidiary._id.toString(),
        name: subsidiary.name,
        liquidCapital: 125_000,
        parentCorporation: { _id: parent._id.toString(), ownershipPct: 100 },
      },
      ceo: null,
      financials: { totalRevenue: 80_000 },
      sectors: [],
      balanceSheet: { assets: { cashOnHand: 125_000 }, liabilities: {}, equity: {} },
    };
    db.collectionMocks["corporations"]!.findOne.mockResolvedValueOnce(
      subsidiary
    ).mockResolvedValueOnce(parent);
    const { getAuthUser } = await import("@/lib/auth");
    vi.mocked(getAuthUser).mockResolvedValue({ userId: parent.userId.toString() } as never);
    const { loadCorporationDetailView } =
      await import("@/lib/corporations/queries/corporationDetail");
    vi.mocked(loadCorporationDetailView).mockResolvedValue(detailPayload as never);

    const { GET } = await import("./route");
    const parentRes = await GET(
      new Request(`http://localhost/api/corporations/${subsidiary._id}`),
      { params: Promise.resolve({ id: subsidiary._id.toString() }) }
    );
    const parentJson = await parentRes.json();

    expect(parentRes.status).toBe(200);
    expect(parentJson.corporation.viewerIsControllingParentCeo).toBe(true);
    expect(parentJson.corporation.liquidCapital).toBe(125_000);
    expect(parentJson.financials).toEqual(detailPayload.financials);
    expect(parentJson.balanceSheet).toEqual(detailPayload.balanceSheet);

    const outsiderUserId = new ObjectId().toString();
    db.collectionMocks["corporations"]!.findOne.mockResolvedValueOnce(
      subsidiary
    ).mockResolvedValueOnce(parent);
    vi.mocked(getAuthUser).mockResolvedValue({ userId: outsiderUserId } as never);
    const outsiderRes = await GET(
      new Request(`http://localhost/api/corporations/${subsidiary._id}`),
      { params: Promise.resolve({ id: subsidiary._id.toString() }) }
    );
    const outsiderJson = await outsiderRes.json();

    expect(outsiderRes.status).toBe(200);
    expect(outsiderJson.corporation.viewerIsControllingParentCeo).toBe(false);
    expect(outsiderJson.corporation.liquidCapital).toBeUndefined();
    expect(outsiderJson.financials).toBeNull();
    expect(outsiderJson.balanceSheet).toBeNull();
  });

  it("marks the controlling parent CEO as an insider of a public subsidiary", async () => {
    await wireDb();
    const subsidiary = makeCorporation({
      _id: new ObjectId(),
      countryId: "US",
      headquartersState: "CA",
      liquidCurrencyCode: "USD",
      isPrivate: false,
    });
    const parent = makeCorporation({ _id: new ObjectId(), userId: new ObjectId() });
    const detailPayload = {
      corporation: {
        _id: subsidiary._id.toString(),
        name: subsidiary.name,
        parentCorporation: { _id: parent._id.toString(), ownershipPct: 100 },
      },
      ceo: null,
      financials: { totalRevenue: 80_000 },
      sectors: [],
      balanceSheet: { assets: { cashOnHand: 100 }, liabilities: {}, equity: {} },
    };
    db.collectionMocks["corporations"]!.findOne.mockResolvedValueOnce(
      subsidiary
    ).mockResolvedValueOnce(parent);
    const { getAuthUser } = await import("@/lib/auth");
    vi.mocked(getAuthUser).mockResolvedValue({ userId: parent.userId.toString() } as never);
    const { loadCorporationDetailView } =
      await import("@/lib/corporations/queries/corporationDetail");
    vi.mocked(loadCorporationDetailView).mockResolvedValue(detailPayload as never);

    const { GET } = await import("./route");
    const res = await GET(new Request(`http://localhost/api/corporations/${subsidiary._id}`), {
      params: Promise.resolve({ id: subsidiary._id.toString() }),
    });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.corporation.viewerIsControllingParentCeo).toBe(true);
    expect(json.financialFogOfWar).toBeNull();
    expect(json.financials).toEqual(detailPayload.financials);
  });

  it("keeps financial fog for anonymous viewers when a public corp has no userId", async () => {
    await wireDb();
    const corporation = makeCorporation({
      _id: new ObjectId("000000000000000000000001"),
      userId: undefined,
      countryId: "US",
      headquartersState: "CA",
      liquidCurrencyCode: "USD",
      isPrivate: false,
      liquidCapital: 160_000,
    });
    expect(corporation.userId).toBeUndefined();
    db.collectionMocks["corporations"]!.findOne.mockResolvedValue(corporation);

    const { getAuthUser } = await import("@/lib/auth");
    vi.mocked(getAuthUser).mockResolvedValue(null);
    const detailPayload = {
      corporation: {
        _id: corporation._id.toString(),
        name: corporation.name,
        liquidCapital: corporation.liquidCapital,
      },
      ceo: null,
      financials: {
        totalRevenue: 80_000,
        maintenanceCosts: 5_000,
        laborCosts: 0,
        growthCosts: 0,
        marketingCosts: 0,
        logisticsCosts: 0,
        rdCosts: 0,
        ceoSalaryCost: 0,
        pensionContributionCost: 0,
        pensionTopUpCost: 0,
        pensionSchemesInDeficit: 0,
        operatingCosts: 5_000,
        operatingIncome: 75_000,
        federalTax: 0,
        stateTax: 0,
        federalTaxByCountry: {},
        bondInterestCost: 0,
        bondCouponIncome: 0,
        dividendIncomeReceived: 0,
        governmentBondSubsidy: 0,
        imfFacilityPaymentDaily: 0,
        imfFacilityReceiptsDaily: 0,
        totalCosts: 5_000,
        income: 75_000,
        dividendRate: 0,
        effectiveDividendRate: 0,
        dividendDistribution: 0,
        regulatoryBurden: 0,
        currentGrowthRate: 0,
        subsidyBenefit: 0,
      },
      sectors: [],
      balanceSheet: {
        assets: {
          cashOnHand: 160_000,
          sectorNPVs: [],
          totalSectorNPV: 0,
          bondHoldingsValue: 0,
          stockHoldingsValue: 0,
          imfFacilityReceivablesValue: 0,
          imfFacilityReceivables: [],
          totalPortfolioValue: 0,
          heldBonds: [],
          techAssetValue: 0,
          totalAssets: 160_000,
        },
        liabilities: { dailyCosts: 5_000, totalDebt: 0, dailyInterestCost: 0, bondCount: 0 },
        equity: { totalEquity: 160_000, bookValue: 160_000, marketCapitalization: 200_000 },
      },
    };
    const { loadCorporationDetailView } =
      await import("@/lib/corporations/queries/corporationDetail");
    vi.mocked(loadCorporationDetailView).mockResolvedValue(detailPayload as never);

    const { GET } = await import("./route");
    const res = await GET(new Request(`http://localhost/api/corporations/${corporation._id}`), {
      params: Promise.resolve({ id: corporation._id.toString() }),
    });
    const json = await res.json();
    const factor = getFogFactor(corporation._id.toString(), 10);

    expect(res.status).toBe(200);
    expect(json.corporation.viewerIsControllingParentCeo).toBe(false);
    expect(json.financialFogOfWar).toMatchObject({
      isFinancialFogOfWar: true,
      fogSourceTurn: null,
      maxDeviation: 0.1,
    });
    expect(json.financials.totalRevenue).toBe(Math.round(80_000 * factor));
    expect(json.financials.totalRevenue).not.toBe(80_000);
    expect(json.balanceSheet.assets.cashOnHand).toBe(Math.round(160_000 * factor));
    expect(json.corporation.liquidCapital).toBe(Math.round(160_000 * factor));
  });
});

describe("acquisition navigation capability", () => {
  it.each([
    { role: "ceo", vacant: false, enabled: true, paused: false, expected: true },
    { role: "spectator", vacant: false, enabled: true, paused: false, expected: false },
    { role: "ceo", vacant: true, enabled: true, paused: false, expected: false },
    { role: "ceo", vacant: false, enabled: false, paused: false, expected: false },
    { role: "ceo", vacant: false, enabled: true, paused: true, expected: false },
  ])(
    "returns $expected for $role with vacancy $vacant, enabled $enabled and paused $paused",
    async ({ role, vacant, enabled, paused, expected }) => {
      await wireDb();
      const corporation = makeCorporation({ countryId: "US", ceoVacant: vacant });
      db.collection("corporations").findOne.mockResolvedValue(corporation);
      db.collection("gameState").findOne.mockResolvedValue({
        corpDealsEnabled: enabled,
        corporationActionsPaused: paused,
      });
      const { getAuthUser } = await import("@/lib/auth");
      vi.mocked(getAuthUser).mockResolvedValue({
        userId: role === "ceo" ? String(corporation.userId) : String(new ObjectId()),
      } as never);
      const { loadCorporationDetailView } =
        await import("@/lib/corporations/queries/corporationDetail");
      vi.mocked(loadCorporationDetailView).mockResolvedValue({
        corporation: { _id: String(corporation._id) },
        sectors: [],
      } as never);
      const { GET } = await import("./route");
      const res = await GET(new Request("http://localhost/api/corporations/1"), {
        params: Promise.resolve({ id: String(corporation._id) }),
      });
      expect(res.status).toBe(200);
      expect((await res.json()).corporation.canManageAcquisitions).toBe(expected);
    }
  );
});

describe("editorial management capability", () => {
  it.each([
    { paused: false, enabled: true, sector: "media", role: "ceo", expected: true },
    { paused: true, enabled: true, sector: "media", role: "ceo", expected: false },
    { paused: false, enabled: false, sector: "media", role: "ceo", expected: false },
    { paused: false, enabled: true, sector: "manufacturing", role: "ceo", expected: false },
    { paused: false, enabled: true, sector: "media", role: "spectator", expected: false },
  ])(
    "returns $expected for $role, pause $paused and sector $sector",
    async ({ paused, enabled, sector, role, expected }) => {
      await wireDb();
      const corporation = makeCorporation({ countryId: "US", type: "media" });
      db.collection("corporations").findOne.mockResolvedValue(corporation);
      db.collection("gameState").findOne.mockResolvedValue({ corporationActionsPaused: paused });
      db.collection("gameConfig").findOne.mockResolvedValue({ mediaEditorialEnabled: enabled });
      const { getAuthUser } = await import("@/lib/auth");
      vi.mocked(getAuthUser).mockResolvedValue({
        userId: role === "ceo" ? String(corporation.userId) : String(new ObjectId()),
      } as never);
      const { loadCorporationDetailView } =
        await import("@/lib/corporations/queries/corporationDetail");
      vi.mocked(loadCorporationDetailView).mockResolvedValue({
        corporation: { _id: String(corporation._id) },
        sectors: [{ sectorType: sector }],
      } as never);
      const { GET } = await import("./route");
      const res = await GET(new Request("http://localhost/api/corporations/1"), {
        params: Promise.resolve({ id: String(corporation._id) }),
      });
      expect(res.status).toBe(200);
      expect((await res.json()).corporation.canEditEditorialStance).toBe(expected);
    }
  );
});
