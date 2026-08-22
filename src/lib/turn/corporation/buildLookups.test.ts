/**
 * Unit tests for buildCorporationLookups — focuses on bond holdings classification.
 * Sovereign bonds held by a corp must contribute to bondsHeldByCorpId so they
 * flow into the share-price portfolio anchor (the API already counts them as
 * portfolio assets — the share-price formula must too).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import type { Bond, Corporation } from "@/lib/db/types";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));

function makeCursor(docs: unknown[]) {
  return {
    toArray: vi.fn().mockResolvedValue(docs),
    sort: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    skip: vi.fn().mockReturnThis(),
    project: vi.fn().mockReturnThis(),
  };
}

describe("buildCorporationLookups — bond holdings", () => {
  let db: MockDb;
  const holderCorp: Corporation = {
    _id: new ObjectId(),
    name: "Holder",
    countryId: "US",
    headquartersState: "CA",
    liquidCapital: 1_000_000,
    liquidCurrencyCode: "USD",
    sharePrice: 1,
    totalShares: 1_000_000,
    publicFloat: 0,
    shareholders: [],
    type: "manufacturing",
    marketingBudget: 0,
    marketingStrength: 0,
    logisticsBudget: 0,
    logisticsStrength: 0,
    ceoSalary: 0,
    ceoId: null,
    sequentialId: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as unknown as Corporation;

  const issuerCorp: Corporation = {
    ...holderCorp,
    _id: new ObjectId(),
    name: "CorpIssuer",
    sequentialId: 2,
  };

  const corporateBond: Bond = {
    _id: new ObjectId(),
    issuerType: "corporation",
    corporationId: issuerCorp._id,
    faceValue: 1000,
    couponRate: 5,
    maturityTurns: 96,
    issuedAtTurn: 100,
    maturityTurn: 196,
    marketPrice: 1.0,
    totalIssued: 50_000_000,
    publicFloat: 0,
    holders: [{ corporationId: holderCorp._id, units: 50_000 }],
    defaulted: false,
    defaultedAtTurn: null,
    matured: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const sovereignBond: Bond = {
    _id: new ObjectId(),
    issuerType: "sovereign",
    countryId: "US",
    corporationId: new ObjectId("700000000000000000000011"),
    faceValue: 1000,
    couponRate: 4,
    maturityTurns: 240,
    issuedAtTurn: 100,
    maturityTurn: 340,
    marketPrice: 1.0,
    totalIssued: 100_000_000,
    publicFloat: 0,
    holders: [{ corporationId: holderCorp._id, units: 30_000 }],
    defaulted: false,
    defaultedAtTurn: null,
    matured: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    // Pre-create every collection that buildCorporationLookups reads — defaults
    // to empty cursors except bonds + corporations which we override below.
    for (const name of [
      "corporations",
      "corporateSectors",
      "stateMetrics",
      "commodityPrices",
      "centralBanks",
      "bonds",
      "federalBudget",
      "stateBudgets",
      "tariffs",
      "subsidies",
      "states",
      "exchangeRates",
    ]) {
      db.collection(name);
    }
    db.collectionMocks.corporations.find.mockReturnValue(makeCursor([holderCorp, issuerCorp]));
    db.collectionMocks.bonds.find.mockReturnValue(makeCursor([corporateBond, sovereignBond]));

    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
  });

  it("includes sovereign bond holdings in bondsHeldByCorpId", async () => {
    const { buildCorporationLookups } = await import("./buildLookups");
    const lookups = await buildCorporationLookups(db as unknown as Db);

    const positions = lookups.bondsHeldByCorpId.get(holderCorp._id.toString());
    expect(positions).toBeDefined();
    expect(positions!.length).toBe(2);
    const issuerTypes = positions!.map((p) => p.bond.issuerType ?? "undefined").sort();
    expect(issuerTypes).toEqual(["corporation", "sovereign"]);
  });

  it("sovereign bond holdings contribute to bondAndImfPortfolioAnchorByCorpId", async () => {
    const { buildCorporationLookups } = await import("./buildLookups");
    const lookups = await buildCorporationLookups(db as unknown as Db);

    // 50_000 units * $1000 face * 1.0 marketPrice (corporate)
    //   + 30_000 units * $1000 face * 1.0 marketPrice (sovereign)
    //   = 80_000_000
    expect(lookups.bondAndImfPortfolioAnchorByCorpId.get(holderCorp._id.toString())).toBe(
      80_000_000
    );
  });

  it("issuer-side bondsByCorpId still excludes sovereign bonds (credit rating uses corporate only)", async () => {
    const { buildCorporationLookups } = await import("./buildLookups");
    const lookups = await buildCorporationLookups(db as unknown as Db);

    // Sovereign bond's synthetic issuer must NOT appear in bondsByCorpId — the
    // map is consumed by the credit-rating logic which is corporate-only.
    expect(lookups.bondsByCorpId.has("700000000000000000000011")).toBe(false);
    // Corporate bond's issuer DOES appear.
    expect(lookups.bondsByCorpId.get(issuerCorp._id.toString())?.length).toBe(1);
  });

  it("issuedBondDebtByCorpId sums totalIssued for active corporate bonds", async () => {
    const { buildCorporationLookups } = await import("./buildLookups");
    const lookups = await buildCorporationLookups(db as unknown as Db);

    // issuerCorp has one active corporate bond with totalIssued = 50_000_000
    expect(lookups.issuedBondDebtByCorpId.get(issuerCorp._id.toString())).toBe(50_000_000);
  });

  it("issuedBondDebtByCorpId excludes natcorps (countryOwnerId set)", async () => {
    // Override fixture: make issuerCorp a natcorp
    const natcorpIssuer = { ...issuerCorp, countryOwnerId: "US" };
    db.collectionMocks.corporations.find.mockReturnValue(makeCursor([holderCorp, natcorpIssuer]));

    const { buildCorporationLookups } = await import("./buildLookups");
    const lookups = await buildCorporationLookups(db as unknown as Db);

    // Natcorp's bond debt must NOT contribute — government backstops principal.
    expect(lookups.issuedBondDebtByCorpId.has(issuerCorp._id.toString())).toBe(false);
  });

  it("issuedBondDebtByCorpId excludes defaulted bonds", async () => {
    const defaultedCorpBond: Bond = {
      ...corporateBond,
      _id: new ObjectId(),
      defaulted: true,
      defaultedAtTurn: 50,
      marketPrice: 0.1,
      totalIssued: 30_000_000,
    };
    db.collectionMocks.bonds.find.mockReturnValue(
      makeCursor([corporateBond, sovereignBond, defaultedCorpBond])
    );

    const { buildCorporationLookups } = await import("./buildLookups");
    const lookups = await buildCorporationLookups(db as unknown as Db);

    // Only the active 50M bond counts; the 30M defaulted bond is excluded.
    expect(lookups.issuedBondDebtByCorpId.get(issuerCorp._id.toString())).toBe(50_000_000);
  });

  it("backfills authored rates for countries without a live forex market", async () => {
    // Poland has a real local denomination in 1953, but it is deliberately not
    // forex-traded and therefore has no exchangeRates row. The corporation turn
    // still has to convert its revenue, profit, cash, debt, and market cap at
    // 24 PLZ per anchor rather than silently treating PLZ as 1:1 with anchor.
    db.collectionMocks.exchangeRates.find.mockReturnValue(
      makeCursor([{ currencyCode: "USD", rate: 1 }])
    );
    db.collection("gameState");
    db.collectionMocks.gameState.findOne.mockResolvedValue({
      _id: "current",
      preset: "1953-default",
    });

    const { buildCorporationLookups } = await import("./buildLookups");
    const lookups = await buildCorporationLookups(db as unknown as Db);

    expect(lookups.exchangeRatesByCurrency.get("PLZ")).toBe(24);
    expect(lookups.exchangeRatesByCurrency.get("CSK")).toBe(27);
  });

  it("populates domestic and foreign corporate tax rate maps per country and state", async () => {
    db.collectionMocks.federalBudget.find.mockReturnValue(
      makeCursor([
        {
          _id: "federal",
          countryId: "US",
          taxRates: { domesticCorporateTax: 20, foreignCorporateTax: 35 },
          economicFactors: {},
          debtToGdpRatio: 0,
          surplus: 0,
          gdp: 1,
        },
        {
          _id: "UK",
          countryId: "UK",
          taxRates: { domesticCorporateTax: 25, foreignCorporateTax: 40 },
          economicFactors: {},
          debtToGdpRatio: 0,
          surplus: 0,
          gdp: 1,
        },
      ])
    );
    db.collectionMocks.stateBudgets.find.mockReturnValue(
      makeCursor([
        { _id: "US_CA", taxRates: { domesticCorporateTax: 10, foreignCorporateTax: 18 } },
        { _id: "UK_ENG", taxRates: { domesticCorporateTax: 0, foreignCorporateTax: 5 } },
      ])
    );

    const { buildCorporationLookups } = await import("./buildLookups");
    const lookups = await buildCorporationLookups(db as unknown as Db);

    expect(lookups.domesticCorpTaxRateByCountry.get("US")).toBe(20);
    expect(lookups.foreignCorpTaxRateByCountry.get("US")).toBe(35);
    expect(lookups.domesticCorpTaxRateByCountry.get("UK")).toBe(25);
    expect(lookups.foreignCorpTaxRateByCountry.get("UK")).toBe(40);
    expect(lookups.domesticStateCorpTaxRateByState.get("US_CA")).toBe(10);
    expect(lookups.foreignStateCorpTaxRateByState.get("US_CA")).toBe(18);
    expect(lookups.domesticStateCorpTaxRateByState.get("UK_ENG")).toBe(0);
    expect(lookups.foreignStateCorpTaxRateByState.get("UK_ENG")).toBe(5);
  });
});

describe("buildCorporationLookups — sovereign default contagion FX normalization", () => {
  // Regression: federalBudget.gdp is in local currency. Without FX
  // normalization the cross-country `defaultingCountryGdp / globalGdp`
  // contagion ratio mixes denominations (yen-denominated GDP would dominate
  // a raw sum). The fix normalizes each budget's GDP into anchor units before
  // summing or passing into buildSovereignDefaultMarginByCorpId.
  let db: MockDb;

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    for (const name of [
      "corporations",
      "corporateSectors",
      "stateMetrics",
      "commodityPrices",
      "centralBanks",
      "bonds",
      "federalBudget",
      "stateBudgets",
      "tariffs",
      "subsidies",
      "states",
      "exchangeRates",
      "stateResourceCapacity",
      "freeTradeAgreements",
      "unownedSectors",
    ]) {
      db.collection(name);
    }
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
  });

  it("normalizes mixed-currency GDPs to anchor before passing to contagion calc", async () => {
    // US: 30T USD GDP at 1.00 USD/anchor → 30T anchor
    // JP: 600T JPY GDP at 100 JPY/anchor → 6T anchor
    // Without FX normalization, raw sum would be 630T (JPY dominates).
    // With FX normalization, sum should be 36T anchor and US share = 30/36 ≈ 0.833.
    db.collectionMocks.federalBudget.find.mockReturnValue(
      makeCursor([
        {
          _id: "federal",
          countryId: "US",
          gdp: 30_000_000_000_000, // 30T USD (local)
          economicFactors: {},
          debtToGdpRatio: 0,
          surplus: 0,
          taxRates: {},
          sovereignCrisisState: "recovering",
          lastDefaultTurn: 100,
          crisisChoice: "repudiate",
        },
        {
          _id: "JP",
          countryId: "JP",
          gdp: 600_000_000_000_000, // 600T JPY (local)
          economicFactors: {},
          debtToGdpRatio: 0,
          surplus: 0,
          taxRates: {},
        },
      ])
    );
    db.collectionMocks.exchangeRates.find.mockReturnValue(
      makeCursor([
        { _id: "US", countryId: "US", currencyCode: "USD", rate: 1.0 },
        { _id: "JP", countryId: "JP", currencyCode: "JPY", rate: 100 },
      ])
    );

    const captureSpy = vi.fn().mockReturnValue(new Map());
    vi.doMock("@/lib/sovereignDefault/marginPenalty/buildPerCorpMap", () => ({
      buildSovereignDefaultMarginByCorpId: captureSpy,
    }));

    vi.resetModules();
    const { buildCorporationLookups } = await import("./buildLookups");
    await buildCorporationLookups(db as unknown as Db);

    expect(captureSpy).toHaveBeenCalledTimes(1);
    const args = captureSpy.mock.calls[0][0] as {
      recoveringBudgets: Array<{ countryId?: string; gdp?: number }>;
      globalGdp: number;
    };
    // globalGdp should be anchor-normalized:
    //   US: 30T / 1.0 + JP: 600T / 100 = 30T + 6T = 36T
    expect(args.globalGdp).toBeCloseTo(36_000_000_000_000, -8);
    // The US recovering budget's gdp should also be anchor-normalized.
    const usRow = args.recoveringBudgets.find((b) => b.countryId === "US");
    expect(usRow?.gdp).toBeCloseTo(30_000_000_000_000, -8);

    vi.doUnmock("@/lib/sovereignDefault/marginPenalty/buildPerCorpMap");
  });
});
