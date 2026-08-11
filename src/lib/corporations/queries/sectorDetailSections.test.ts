import { describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
import { computeSectorTaxSection } from "@/lib/corporations/queries/sectorDetailSections";
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
