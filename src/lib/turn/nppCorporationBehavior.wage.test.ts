import { describe, it, expect } from "vitest";
import { ObjectId } from "mongodb";
import { makeNppCorpDecision, type CommodityPriceRatioFn } from "./nppCorporationBehavior";
import { ceoArchetypeModifiers } from "./ceoArchetype";
import type { Corporation, CorporateSector } from "@/lib/db/types";

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
    realizedRevenue: 10_000_000,
    profitMargin: 30,
    effectiveProfitMargin: 30,
    targetGrowthRate: 2,
    wageLevel: 1,
    ...overrides,
  } as unknown as CorporateSector;
}

function decide(sectors: CorporateSector[], priceRatioOf: CommodityPriceRatioFn, wages = true) {
  return makeNppCorpDecision(
    {
      corp: corp(),
      sectors,
      turn: 100,
      now: new Date(),
      modifiers: ceoArchetypeModifiers("cautious"),
      labourWagesEnabled: wages,
    },
    noUnowned,
    noState,
    priceRatioOf
  );
}

const wageSets = (d: ReturnType<typeof decide>) =>
  d.sectorUpdates.filter((u) => "wageLevel" in ((u.update.$set ?? {}) as Record<string, unknown>));

describe("NPP wage policy (section 2d)", () => {
  it("is a no-op when labour wages are off", () => {
    const d = decide([sector()], () => 1.4, false);
    expect(wageSets(d)).toHaveLength(0);
  });

  it("raises wages toward 1.08 in a shortage with healthy margins", () => {
    const s = sector({ wageLevel: 1 });
    const d = decide([s], () => 1.4);
    const sets = wageSets(d);
    expect(sets).toHaveLength(1);
    expect(sets[0].filter._id).toBe(s._id);
    expect((sets[0].update.$set as Record<string, unknown>).wageLevel).toBe(1.02);
  });

  it("cuts wages toward 0.95 in a glut", () => {
    const s = sector({ wageLevel: 1, profitMargin: 5, effectiveProfitMargin: 5 });
    const d = decide([s], () => 0.7);
    const sets = wageSets(d);
    expect(sets).toHaveLength(1);
    expect((sets[0].update.$set as Record<string, unknown>).wageLevel).toBe(0.98);
  });

  it("skips mothballed plants", () => {
    const d = decide([sector({ mothballed: true })], () => 1.4);
    expect(wageSets(d)).toHaveLength(0);
  });
});
