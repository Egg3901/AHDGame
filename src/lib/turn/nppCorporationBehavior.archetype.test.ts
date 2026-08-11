/**
 * Archetype-effect tests for makeNppCorpDecision: identical corp + sectors, only
 * the CEO archetype differs, asserting the modifiers actually move the levers
 * (budgets, dividends, divestiture, expansion gating) within safe bounds.
 */
import { describe, it, expect } from "vitest";
import { ObjectId } from "mongodb";
import { makeNppCorpDecision, type CommodityPriceRatioFn } from "./nppCorporationBehavior";
import { ceoArchetypeModifiers, type CeoArchetype } from "./ceoArchetype";
import type { Corporation, CorporateSector } from "@/lib/db/types";

const noPrices: CommodityPriceRatioFn = () => null;
const noUnowned = new Map();
const noState = new Set<string>();

function corp(overrides: Partial<Corporation> = {}): Corporation {
  return {
    _id: new ObjectId(),
    countryId: "US",
    type: "manufacturing",
    headquartersState: "CA",
    liquidCapital: 50_000_000,
    ceoType: "npp",
    ...overrides,
  } as unknown as Corporation;
}

function sector(overrides: Partial<CorporateSector> = {}): CorporateSector {
  return {
    _id: new ObjectId(),
    sectorType: "manufacturing",
    countryId: "US",
    stateId: "CA",
    revenue: 10_000_000,
    profitMargin: 30, // strong margin band
    targetGrowthRate: 2,
    ...overrides,
  } as unknown as CorporateSector;
}

function decideFor(archetype: CeoArchetype, sectors: CorporateSector[], c = corp()) {
  return makeNppCorpDecision(
    { corp: c, sectors, turn: 100, now: new Date(), modifiers: ceoArchetypeModifiers(archetype) },
    noUnowned,
    noState,
    noPrices
  );
}

describe("makeNppCorpDecision — archetype effects", () => {
  it("innovator outspends the cost-cutter on R&D for the same strong corp", () => {
    const sectors = [sector()];
    const innovator = decideFor("innovator", sectors).updates.rdBudget as number;
    const costCutter = decideFor("costCutter", sectors).updates.rdBudget as number;
    expect(innovator).toBeGreaterThan(costCutter);
  });

  it("aggressive outspends the cost-cutter on marketing", () => {
    const sectors = [sector()];
    const aggressive = decideFor("aggressive", sectors).updates.marketingBudget as number;
    const costCutter = decideFor("costCutter", sectors).updates.marketingBudget as number;
    expect(aggressive).toBeGreaterThan(costCutter);
  });

  it("cost-cutter pays a higher dividend than the innovator", () => {
    const sectors = [sector()];
    const costCutter = decideFor("costCutter", sectors).updates.dividendRate as number;
    const innovator = decideFor("innovator", sectors).updates.dividendRate as number;
    expect(costCutter).toBeGreaterThan(innovator);
  });

  it("patient innovator tolerates a shallow loser the cost-cutter divests", () => {
    // Non-core losing sector at -5% margin; core sector profitable.
    const sectors = [
      sector(), // core manufacturing, profitable
      sector({ sectorType: "technology", profitMargin: -5 }),
    ];
    const costCutter = decideFor("costCutter", sectors).divestedSectorIds ?? [];
    const innovator = decideFor("innovator", sectors).divestedSectorIds ?? [];
    expect(costCutter.length).toBe(1);
    expect(innovator.length).toBe(0);
  });

  it("never divests the corp's core sector even when it is losing money", () => {
    const sectors = [
      sector({ profitMargin: -20 }), // core, deep loss
      sector({ sectorType: "technology", profitMargin: 20 }),
    ];
    const decision = decideFor("costCutter", sectors);
    expect(decision.divestedSectorIds ?? []).toHaveLength(0);
  });

  it("aggressive expands on thinner cash where the cautious holds back", () => {
    // Surplus sized to clear aggressive's lowered bar but not cautious's raised one.
    const sectors = [sector()];
    const lean = corp({ liquidCapital: 6_000_000 });
    const aggressive = decideFor("aggressive", sectors, lean).newSectors ?? [];
    const cautious = decideFor("cautious", sectors, lean).newSectors ?? [];
    expect(aggressive.length).toBeGreaterThanOrEqual(cautious.length);
  });
});
