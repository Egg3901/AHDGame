import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getAuthUser: vi.fn().mockResolvedValue(null) }));
vi.mock("@/lib/tariffs/ftaOverrides", () => ({
  loadActiveFtaPairs: vi.fn().mockResolvedValue([]),
}));

let db: MockDb;

const ctx = () => ({ params: Promise.resolve({ code: "US", id: "CA" }) });

beforeEach(async () => {
  vi.clearAllMocks();
  db = createMockDb();
  db.collection("states");
  db.collection("stateMetrics");
  db.collection("macroMetrics");
  db.collection("tariffs");
  db.collection("stateResourceCapacity");
  db.collection("corporateSectors");
  db.collection("unownedSectors");
  db.collection("corporations");
  db.collection("users");
  db.collection("exchangeRates");
  db.collection("characters");
  db.collection("imperialCharacters");

  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
});

describe("GET /api/country/[code]/region/[id]/economy", () => {
  it("filters out orphan sectors whose corporation no longer exists", async () => {
    const liveCorpId = new ObjectId();
    const orphanCorpId = new ObjectId(); // not present in `corporations`
    const liveSectorId = new ObjectId();
    const orphanSectorId = new ObjectId();

    db.collectionMocks.states.findOne.mockResolvedValue({
      _id: "CA",
      countryId: "US",
      name: "California",
      gdp: 1_000_000_000,
    });
    db.collectionMocks.stateMetrics.findOne.mockResolvedValue(null);
    db.collectionMocks.tariffs.find.mockReturnValue({ toArray: async () => [] });
    db.collectionMocks.stateResourceCapacity.findOne.mockResolvedValue(null);

    // Two sectors of the same type in CA: one owned by a live corp, one orphan.
    db.collectionMocks.corporateSectors.find.mockReturnValue({
      toArray: async () => [
        {
          _id: liveSectorId,
          corporationId: liveCorpId,
          countryId: "US",
          stateId: "CA",
          sectorType: "extraction",
          revenue: 500_000,
          targetGrowthRate: 0,
          currentGrowthRate: 0,
        },
        {
          _id: orphanSectorId,
          corporationId: orphanCorpId,
          countryId: "US",
          stateId: "CA",
          sectorType: "extraction",
          revenue: 250_000,
          targetGrowthRate: 0,
          currentGrowthRate: 0,
        },
      ],
    });

    db.collectionMocks.unownedSectors.find.mockReturnValue({ toArray: async () => [] });

    // Only the live corp comes back from `corporations.find({_id: {$in: [...]}})`.
    db.collectionMocks.corporations.find.mockReturnValue({
      project: vi.fn().mockReturnValue({
        toArray: async () => [
          {
            _id: liveCorpId,
            name: "Live Corp",
            ceoId: new ObjectId(),
            ceoType: "regular",
            ceoVacant: false,
            sequentialId: 42,
            brandColor: "#fff",
            logoUrl: null,
            marketingStrength: 100,
            countryOwnerId: null,
            countryId: "US",
            liquidCurrencyCode: "USD",
          },
        ],
      }),
    });

    db.collectionMocks.exchangeRates.find.mockReturnValue({
      toArray: async () => [{ currencyCode: "USD", rate: 1 }],
    });

    db.collectionMocks.characters.find.mockReturnValue({
      project: vi.fn().mockReturnValue({ toArray: async () => [] }),
    });
    db.collectionMocks.imperialCharacters.find.mockReturnValue({
      project: vi.fn().mockReturnValue({ toArray: async () => [] }),
    });

    const { GET } = await import("./route");
    const response = await GET(
      new Request("http://localhost/api/country/US/region/CA/economy"),
      ctx()
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    const extractionEntry = (
      data.sectors as Array<{
        type: string;
        owners: Array<{ sectorId: string; corporationId: string }>;
      }>
    ).find((s) => s.type === "extraction");
    expect(extractionEntry).toBeDefined();
    const ownerSectorIds = extractionEntry!.owners.map((o) => o.sectorId);
    expect(ownerSectorIds).toContain(liveSectorId.toHexString());
    expect(ownerSectorIds).not.toContain(orphanSectorId.toHexString());
  });

  it("redacts marketingStrength/revenue/workers for private corps to a public viewer but keeps marketShare", async () => {
    const privateCorpId = new ObjectId();
    const sectorId = new ObjectId();

    db.collectionMocks.states.findOne.mockResolvedValue({
      _id: "CA",
      countryId: "US",
      name: "California",
      gdp: 1_000_000_000,
    });
    db.collectionMocks.stateMetrics.findOne.mockResolvedValue(null);
    db.collectionMocks.tariffs.find.mockReturnValue({ toArray: async () => [] });
    db.collectionMocks.stateResourceCapacity.findOne.mockResolvedValue(null);

    db.collectionMocks.corporateSectors.find.mockReturnValue({
      toArray: async () => [
        {
          _id: sectorId,
          corporationId: privateCorpId,
          countryId: "US",
          stateId: "CA",
          sectorType: "extraction",
          revenue: 500_000,
          targetGrowthRate: 0,
          currentGrowthRate: 0,
        },
      ],
    });
    db.collectionMocks.unownedSectors.find.mockReturnValue({ toArray: async () => [] });

    db.collectionMocks.corporations.find.mockReturnValue({
      project: vi.fn().mockReturnValue({
        toArray: async () => [
          {
            _id: privateCorpId,
            name: "Secret Holdings",
            ceoId: new ObjectId(),
            ceoType: "regular",
            ceoVacant: false,
            sequentialId: 7,
            brandColor: "#000",
            logoUrl: null,
            marketingStrength: 99,
            countryOwnerId: null,
            countryId: "US",
            liquidCurrencyCode: "USD",
            isPrivate: true,
            userId: new ObjectId(),
          },
        ],
      }),
    });

    db.collectionMocks.exchangeRates.find.mockReturnValue({
      toArray: async () => [{ currencyCode: "USD", rate: 1 }],
    });
    db.collectionMocks.characters.find.mockReturnValue({
      project: vi.fn().mockReturnValue({ toArray: async () => [] }),
    });
    db.collectionMocks.imperialCharacters.find.mockReturnValue({
      project: vi.fn().mockReturnValue({ toArray: async () => [] }),
    });

    const { GET } = await import("./route");
    const response = await GET(
      new Request("http://localhost/api/country/US/region/CA/economy"),
      ctx()
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    const extraction = (
      data.sectors as Array<{
        type: string;
        owners: Array<{
          corporationId: string;
          defenderMarketingStrength: number | null;
          revenue: number | null;
          workers: number | null;
          marketShare: number;
        }>;
      }>
    ).find((s) => s.type === "extraction");
    const owner = extraction!.owners.find((o) => o.corporationId === privateCorpId.toHexString());
    expect(owner).toBeDefined();
    expect(owner!.defenderMarketingStrength).toBeNull();
    expect(owner!.revenue).toBeNull();
    expect(owner!.workers).toBeNull();
    // marketShare stays so the ownership ranking / Sector Targets view still works.
    expect(owner!.marketShare).toBeGreaterThan(0);
  });

  it("returns macro growth context (own region metric + canonical national) for the macro header", async () => {
    db.collectionMocks.states.findOne.mockResolvedValue({
      _id: "CA",
      countryId: "US",
      name: "California",
      gdp: 1_000_000_000,
    });
    db.collectionMocks.states.find.mockReturnValue({
      project: vi.fn().mockReturnValue({
        toArray: async () => [
          { _id: "CA", population: 30_000_000 },
          { _id: "TX", population: 10_000_000 },
        ],
      }),
    });
    db.collectionMocks.stateMetrics.findOne.mockResolvedValue(null);
    // The region's own value comes from its own doc; the NATIONAL figure comes
    // from the national doc (`federal` for US), never a mean of the regions.
    db.collectionMocks.macroMetrics.findOne.mockImplementation(async (filter: { _id: string }) =>
      filter._id === "CA"
        ? { _id: "CA", economic: { gdpGrowth: { value: 2.5 } } }
        : { _id: "federal", economic: { gdpGrowth: { value: 4.068 } } }
    );
    db.collectionMocks.tariffs.find.mockReturnValue({ toArray: async () => [] });
    db.collectionMocks.stateResourceCapacity.findOne.mockResolvedValue(null);
    db.collectionMocks.corporateSectors.find.mockReturnValue({ toArray: async () => [] });
    db.collectionMocks.unownedSectors.find.mockReturnValue({ toArray: async () => [] });
    db.collectionMocks.exchangeRates.find.mockReturnValue({
      toArray: async () => [{ currencyCode: "USD", rate: 1 }],
    });

    const { GET } = await import("./route");
    const response = await GET(
      new Request("http://localhost/api/country/US/region/CA/economy"),
      ctx()
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.macro).toBeDefined();
    expect(data.macro.stateGdpGrowth).toBe(2.5);
    // The national doc's own value, NOT a population-weighted mean of the two
    // regions (which would have produced 2.25). Population is the wrong weight:
    // the engine compounds each region's GDP by that region's own rate, so only
    // a GDP-weighted aggregate is consistent, and the national doc already is
    // one. See lib/country/nationalGdpGrowth.
    expect(data.macro.nationalGdpGrowth).toBe(4.068);
  });

  it("degrades macro growth to nulls when metrics are missing instead of failing", async () => {
    db.collectionMocks.states.findOne.mockResolvedValue({
      _id: "CA",
      countryId: "US",
      name: "California",
      gdp: 1_000_000_000,
    });
    db.collectionMocks.states.find.mockReturnValue({
      project: vi.fn().mockReturnValue({ toArray: async () => [] }),
    });
    db.collectionMocks.stateMetrics.findOne.mockResolvedValue(null);
    db.collectionMocks.macroMetrics.find.mockReturnValue({
      project: vi.fn().mockReturnValue({ toArray: async () => [] }),
    });
    db.collectionMocks.tariffs.find.mockReturnValue({ toArray: async () => [] });
    db.collectionMocks.stateResourceCapacity.findOne.mockResolvedValue(null);
    db.collectionMocks.corporateSectors.find.mockReturnValue({ toArray: async () => [] });
    db.collectionMocks.unownedSectors.find.mockReturnValue({ toArray: async () => [] });
    db.collectionMocks.exchangeRates.find.mockReturnValue({
      toArray: async () => [{ currencyCode: "USD", rate: 1 }],
    });

    const { GET } = await import("./route");
    const response = await GET(
      new Request("http://localhost/api/country/US/region/CA/economy"),
      ctx()
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.macro).toEqual({ stateGdpGrowth: null, nationalGdpGrowth: null });
  });

  it("includes national sector totals for the cross-link context line", async () => {
    db.collectionMocks.states.findOne.mockResolvedValue({
      _id: "CA",
      countryId: "US",
      name: "California",
      gdp: 0,
    });
    db.collectionMocks.states.find.mockReturnValue({
      project: vi.fn().mockReturnValue({
        toArray: async () => [{ _id: "CA", name: "California", gdp: 0, population: 30 }],
      }),
    });
    db.collectionMocks.stateMetrics.findOne.mockResolvedValue(null);
    db.collectionMocks.macroMetrics.find.mockReturnValue({
      project: vi.fn().mockReturnValue({ toArray: async () => [] }),
    });
    db.collectionMocks.tariffs.find.mockReturnValue({ toArray: async () => [] });
    db.collectionMocks.stateResourceCapacity.findOne.mockResolvedValue(null);
    db.collectionMocks.corporateSectors.find.mockReturnValue({ toArray: async () => [] });
    // National pool: one persisted unowned energy market of 1000 in CA.
    db.collectionMocks.unownedSectors.find.mockReturnValue({
      toArray: async () => [
        { stateId: "CA", countryId: "US", sectorType: "energy", revenue: 1000 },
      ],
    });
    db.collectionMocks.corporations.find.mockReturnValue({
      project: vi.fn().mockReturnValue({ toArray: async () => [] }),
    });
    db.collectionMocks.exchangeRates.find.mockReturnValue({
      toArray: async () => [{ currencyCode: "USD", rate: 1 }],
    });

    const { GET } = await import("./route");
    const response = await GET(
      new Request("http://localhost/api/country/US/region/CA/economy"),
      ctx()
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.nationalSectorTotals).toBeDefined();
    expect(data.nationalSectorTotals.energy).toBe(1000);
  });

  it("exposes the sector's production level on each owner row", async () => {
    const corpId = new ObjectId();
    const sectorId = new ObjectId();

    db.collectionMocks.states.findOne.mockResolvedValue({
      _id: "CA",
      countryId: "US",
      name: "California",
      gdp: 1_000_000_000,
    });
    db.collectionMocks.stateMetrics.findOne.mockResolvedValue(null);
    db.collectionMocks.tariffs.find.mockReturnValue({ toArray: async () => [] });
    db.collectionMocks.stateResourceCapacity.findOne.mockResolvedValue(null);

    db.collectionMocks.corporateSectors.find.mockReturnValue({
      toArray: async () => [
        {
          _id: sectorId,
          corporationId: corpId,
          countryId: "US",
          stateId: "CA",
          sectorType: "extraction",
          revenue: 500_000,
          targetGrowthRate: 0,
          currentGrowthRate: 0,
          productionPolicyLevel: -12,
        },
      ],
    });
    db.collectionMocks.unownedSectors.find.mockReturnValue({ toArray: async () => [] });
    db.collectionMocks.corporations.find.mockReturnValue({
      project: vi.fn().mockReturnValue({
        toArray: async () => [
          {
            _id: corpId,
            name: "Prod Corp",
            ceoId: new ObjectId(),
            ceoType: "regular",
            ceoVacant: false,
            sequentialId: 9,
            brandColor: "#fff",
            logoUrl: null,
            marketingStrength: 10,
            countryOwnerId: null,
            countryId: "US",
            liquidCurrencyCode: "USD",
          },
        ],
      }),
    });
    db.collectionMocks.exchangeRates.find.mockReturnValue({
      toArray: async () => [{ currencyCode: "USD", rate: 1 }],
    });
    db.collectionMocks.characters.find.mockReturnValue({
      project: vi.fn().mockReturnValue({ toArray: async () => [] }),
    });
    db.collectionMocks.imperialCharacters.find.mockReturnValue({
      project: vi.fn().mockReturnValue({ toArray: async () => [] }),
    });

    const { GET } = await import("./route");
    const response = await GET(
      new Request("http://localhost/api/country/US/region/CA/economy"),
      ctx()
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    const extraction = (
      data.sectors as Array<{
        type: string;
        owners: Array<{ corporationId: string; productionLevel: number }>;
      }>
    ).find((s) => s.type === "extraction");
    const owner = extraction!.owners.find((o) => o.corporationId === corpId.toHexString());
    expect(owner).toBeDefined();
    expect(owner!.productionLevel).toBe(-12);
  });

  it("keeps attack estimates visible for private corps (needed for Attack button to render) while hiding revenue/workers/MS", async () => {
    const privateCorpId = new ObjectId();
    const privateOwnerUserId = new ObjectId();
    const viewerUserId = new ObjectId();
    const viewerCharacterId = new ObjectId();
    const viewerCorpId = new ObjectId();
    const sectorId = new ObjectId();

    const { getAuthUser } = await import("@/lib/auth");
    vi.mocked(getAuthUser).mockResolvedValue({
      userId: viewerUserId.toHexString(),
      isAdmin: false,
      isModerator: false,
    } as never);

    db.collectionMocks.states.findOne.mockResolvedValue({
      _id: "CA",
      countryId: "US",
      name: "California",
      gdp: 1_000_000_000,
    });
    db.collectionMocks.stateMetrics.findOne.mockResolvedValue(null);
    db.collectionMocks.tariffs.find.mockReturnValue({ toArray: async () => [] });
    db.collectionMocks.stateResourceCapacity.findOne.mockResolvedValue(null);
    db.collectionMocks.users.findOne.mockResolvedValue({ _id: viewerUserId });
    db.collectionMocks.characters.findOne.mockResolvedValue({
      _id: viewerCharacterId,
      userId: viewerUserId,
    });
    db.collectionMocks.corporations.findOne.mockResolvedValue({
      _id: viewerCorpId,
      type: "technology",
      marketingStrength: 50,
      splitEscalation: 7,
      countryId: "US",
    });

    db.collectionMocks.corporateSectors.find.mockReturnValue({
      toArray: async () => [
        {
          _id: sectorId,
          corporationId: privateCorpId,
          countryId: "US",
          stateId: "CA",
          sectorType: "extraction",
          revenue: 500_000,
          targetGrowthRate: 0,
          currentGrowthRate: 0,
        },
      ],
    });
    db.collectionMocks.unownedSectors.find.mockReturnValue({ toArray: async () => [] });

    db.collectionMocks.corporations.find.mockReturnValue({
      project: vi.fn().mockReturnValue({
        toArray: async () => [
          {
            _id: privateCorpId,
            name: "Secret Holdings",
            ceoId: new ObjectId(),
            ceoType: "regular",
            ceoVacant: false,
            sequentialId: 7,
            brandColor: "#000",
            logoUrl: null,
            marketingStrength: 99,
            countryOwnerId: null,
            countryId: "US",
            liquidCurrencyCode: "USD",
            isPrivate: true,
            userId: privateOwnerUserId,
          },
        ],
      }),
    });

    db.collectionMocks.exchangeRates.find.mockReturnValue({
      toArray: async () => [{ currencyCode: "USD", rate: 1 }],
    });
    db.collectionMocks.characters.find.mockReturnValue({
      project: vi.fn().mockReturnValue({ toArray: async () => [] }),
    });
    db.collectionMocks.imperialCharacters.find.mockReturnValue({
      project: vi.fn().mockReturnValue({ toArray: async () => [] }),
    });

    const { GET } = await import("./route");
    const response = await GET(
      new Request("http://localhost/api/country/US/region/CA/economy"),
      ctx()
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.attackMsCost).toBe(128);
    const extraction = (
      data.sectors as Array<{
        type: string;
        owners: Array<{
          corporationId: string;
          defenderMarketingStrength: number | null;
          revenue: number | null;
          workers: number | null;
          attackCost: number | null;
          attackEstimatedCapture: number | null;
          marketShare: number;
        }>;
      }>
    ).find((s) => s.type === "extraction");
    const owner = extraction!.owners.find((o) => o.corporationId === privateCorpId.toHexString());
    expect(owner).toBeDefined();
    expect(owner!.defenderMarketingStrength).toBeNull();
    expect(owner!.revenue).toBeNull();
    expect(owner!.workers).toBeNull();
    // attackCost and attackEstimatedCapture are kept visible so the Attack
    // button renders — nulling them made private corps immune to attack.
    expect(owner!.attackCost).toBeGreaterThan(0);
    expect(owner!.attackEstimatedCapture).toBeGreaterThan(0);
    expect(owner!.marketShare).toBeGreaterThan(0);
  });
});
