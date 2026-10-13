/**
 * Autopilot corps run the NPP brain and carry the situation signals the turn
 * turns into owner advisories. The strategy restriction itself is the caretaker
 * set (isCaretaker), covered in corpStrategy.test.ts.
 */
import { describe, it, expect } from "vitest";
import { ObjectId } from "mongodb";
import { makeNppCorpDecision, type CommodityPriceRatioFn } from "./nppCorporationBehavior";
import { AUTOPILOT_MODIFIERS } from "@/lib/corporations/autopilot";
import type { Corporation, CorporateSector } from "@/lib/db/types";

const noPrices: CommodityPriceRatioFn = () => null;

function corp(overrides: Partial<Corporation> = {}): Corporation {
  return {
    _id: new ObjectId(),
    countryId: "US",
    type: "manufacturing",
    headquartersState: "CA",
    liquidCapital: 50_000_000,
    ceoType: "character",
    ceoId: new ObjectId(),
    userId: new ObjectId(),
    autopilot: { enabledTurn: 1 },
    ...overrides,
  } as unknown as Corporation;
}

function lowFillSector(): CorporateSector {
  return {
    _id: new ObjectId(),
    sectorType: "manufacturing",
    countryId: "US",
    stateId: "CA",
    revenue: 10_000_000,
    profitMargin: 30,
    targetGrowthRate: 2,
    soldFraction: 0.2,
  } as unknown as CorporateSector;
}

function decide(c: Corporation) {
  return makeNppCorpDecision(
    {
      corp: c,
      sectors: [lowFillSector(), lowFillSector()],
      turn: 100,
      now: new Date(),
      modifiers: AUTOPILOT_MODIFIERS,
      strategyEligible: true,
    },
    new Map(),
    new Set<string>(),
    noPrices
  );
}

describe("makeNppCorpDecision autopilot signals", () => {
  it("reports the low-fill signal for the owner", () => {
    const decision = decide(corp());
    expect(decision.autopilotSignals).toEqual({ chronicLowFill: true, debtDominant: false });
  });

  it("reports nothing for an NPP-run corp", () => {
    const decision = decide(corp({ ceoType: "npp", autopilot: undefined }));
    expect(decision.autopilotSignals).toBeUndefined();
  });
});
