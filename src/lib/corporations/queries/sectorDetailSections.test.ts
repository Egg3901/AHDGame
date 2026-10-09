import { describe, expect, it } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import {
  buildSectorStrategySection,
  buildSectorForSaleInfo,
  computeSectorTaxSection,
  computeSectorMarketPosition,
} from "@/lib/corporations/queries/sectorDetailSections";
import type { Corporation, CorporateSector, FederalBudget, StateBudget } from "@/lib/db/types";

function makeCorp(overrides: Partial<Corporation> = {}): Corporation {
  return {
    _id: new ObjectId(),
    userId: new ObjectId(),
    ceoId: new ObjectId(),
    ceoType: "character",
    name: "Test Corp",
    countryId: "US",
    headquartersState: "US-CA",
    sectorType: "manufacturing",
    marketingBudget: 0,
    marketingStrength: 0,
    logisticsBudget: 0,
    logisticsStrength: 0,
    ceoSalary: 0,
    totalShares: 100,
    sharePrice: 1,
    shareholders: [],
    publicFloat: 0,
    isPrivate: true,
    foundedAtTurn: 1,
    liquidCapital: 0,
    ...overrides,
  } as Corporation;
}

function makeSector(overrides: Partial<CorporateSector> = {}): CorporateSector {
  return {
    _id: new ObjectId(),
    corporationId: new ObjectId(),
    sectorType: "manufacturing",
    countryId: "US",
    stateId: "US-CA",
    revenue: 1000,
    profitMargin: 20,
    currentGrowthCost: 0,
    ...overrides,
  } as CorporateSector;
}

describe("computeSectorTaxSection revenue-weighting basis", () => {
  const corporation = makeCorp({ marketingBudget: 100, logisticsBudget: 0, ceoSalary: 0 });
  const federalBudgets: FederalBudget[] = [
    {
      countryId: "US",
      taxRates: { domesticCorporateTax: 20, foreignCorporateTax: 20 },
    } as FederalBudget,
  ];
  const stateBudgets: StateBudget[] = [];

  it("weights siblings by realized revenue, not nameplate, when they diverge", () => {
    const thisSector = makeSector({ revenue: 1000, realizedRevenue: 1000 });
    // Sibling has a big nameplate/realized gap (e.g. an oversupply or embargo
    // haircut) — this must NOT change how much of the corp-level overhead
    // (marketing/logistics/CEO salary) gets apportioned to `thisSector`.
    const haircutSibling = makeSector({ revenue: 9000, realizedRevenue: 1000 });

    const withHaircutRealized = computeSectorTaxSection({
      allFederalBudgets: federalBudgets,
      allSiblingStateBudgets: stateBudgets,
      corporation,
      allCorpSectors: [thisSector, haircutSibling],
      sector: thisSector,
      profit: 500,
      sectorCountryId: "US",
      fxByCurrency: new Map(),
    });

    // Nameplate would have been 1000 / (1000 + 9000) = 10% share.
    // Realized-preferring is 1000 / (1000 + 1000) = 50% share.
    expect(withHaircutRealized.thisRevenueShare).toBeCloseTo(0.5, 10);

    // Sanity check against the old (buggy) nameplate-only basis: if the sibling's
    // nameplate revenue mattered here, the share would be 0.1, not 0.5.
    expect(withHaircutRealized.thisRevenueShare).not.toBeCloseTo(0.1, 5);
  });

  it("matches nameplate when a sector has not yet been reprocessed (no realizedRevenue)", () => {
    const thisSector = makeSector({ revenue: 1000, realizedRevenue: undefined });
    const sibling = makeSector({ revenue: 1000, realizedRevenue: undefined });

    const result = computeSectorTaxSection({
      allFederalBudgets: federalBudgets,
      allSiblingStateBudgets: stateBudgets,
      corporation,
      allCorpSectors: [thisSector, sibling],
      sector: thisSector,
      profit: 500,
      sectorCountryId: "US",
      fxByCurrency: new Map(),
    });

    expect(result.thisRevenueShare).toBeCloseTo(0.5, 10);
  });
});

describe("persisted operating model strategy reads", () => {
  it("shows an active model by name when its selector is disabled", () => {
    const section = buildSectorStrategySection({
      sector: makeSector({ sectorType: "media", strategyId: "newspaper" }),
      sectorType: "media",
      effectiveRates: { isTransitioning: false },
      transitionProgress: 0,
      strategyTransitionMod: 0,
      currentTurn: 100,
      sectorHostLiquidCode: "USD",
      sectorHostFxRate: 1,
      commodityPrices: [],
      techCorpView: { type: "media", unlockedTechNodeIds: [] },
      techCurrentYear: 1991,
      techTreesEnabled: false,
      shouldRedact: false,
      stateResources: undefined,
      strategyCapacityMultipliers: null,
      marginProjection: null,
      mediaOperatingModelsEnabled: false,
    });

    expect(section.currentStrategyName).toBe("Newspaper");
    expect(section.availableStrategies.some((strategy) => strategy.id === "newspaper")).toBe(false);
  });
});

describe("pledged property sale affordability", () => {
  it("includes actual native FX fees in the buyer quote and refuses a same-market merge", async () => {
    const memory = createInMemoryDb();
    const viewer = makeCorp({ liquidCurrencyCode: "EUR", liquidCapital: 300_500 });
    const sector = makeSector({
      forSale: { priceAnchor: 150_000, listedAt: new Date(0), npvAnchor: 150_000, pledged: true },
      constructionFinancing: { currency: "USD" } as CorporateSector["constructionFinancing"],
    });
    memory.seed("corporateSectors", []);
    const args = { sector, viewerCorporation: viewer, isCeo: false, viewerCorpFxRate: 2 };
    const quote = await buildSectorForSaleInfo(memory as unknown as Db, args);
    expect(quote).toMatchObject({
      priceInViewerCapital: 301_500,
      hasFunds: false,
      eligible: false,
    });
    viewer.liquidCapital = 400_000;
    memory.seed("corporateSectors", [
      { ...makeSector({ corporationId: viewer._id, industryModel: "vehicles" }) },
    ]);
    expect(await buildSectorForSaleInfo(memory as unknown as Db, args)).toMatchObject({
      hasFunds: true,
      conflict: false,
      eligible: true,
    });
    memory.seed("corporateSectors", [{ ...makeSector({ corporationId: viewer._id }) }]);
    expect(await buildSectorForSaleInfo(memory as unknown as Db, args)).toMatchObject({
      hasFunds: true,
      conflict: true,
      eligible: false,
    });
  });
});

describe("computeSectorMarketPosition share bounds", () => {
  const position = (revenues: number[]) => {
    const corp = makeCorp({ countryId: "US" });
    const sectors = revenues.map((revenue, i) =>
      makeSector({
        corporationId: i === 0 ? corp._id : new ObjectId(),
        revenue,
        stateId: "US-CA",
        countryId: "US",
        sectorType: "manufacturing",
      })
    );
    return computeSectorMarketPosition({
      state: null,
      sector: sectors[0],
      sectorCountryId: "US",
      corporation: corp,
      siblingCorps: [],
      siblingsSectors: sectors,
      siblingFxByCurrency: new Map(),
      unownedDoc: null,
    });
  };

  it("never exceeds 100% when a sibling reports negative revenue", () => {
    const result = position([1000, -800]);
    expect(result.marketShare).toBe(100);
    expect(result.competitors[0].marketShare).toBe(0);
  });

  it("a sole producer with fractional revenue reads exactly 100%", () => {
    expect(position([1.4]).marketShare).toBe(100);
  });

  it("shares in a cell add to 100%", () => {
    const result = position([300, 100]);
    expect(result.marketShare).toBe(75);
    expect(result.competitors[0].marketShare).toBe(25);
  });
});
