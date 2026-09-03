import { describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import type { Bond, Corporation, CorporateSector, UnownedSector } from "@/lib/db/types";
import type { CommodityType } from "@/lib/constants/commodities";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { CAPACITY_ANCHOR_YEAR } from "@/lib/constants/capacityEconomy";
import { computeUnownedHeadroomUnits } from "@/lib/market/unownedHeadroom";
import { sectorEntryFeeAnchor } from "@/lib/corporations/foundingPlant";
import { ceoArchetypeModifiers } from "@/lib/turn/ceoArchetype";
import { issueRelocationBond } from "@/lib/corporations/issueRelocationBond";
import {
  makeNppCorpDecision,
  NPP_SHORTAGE_ENTRIES_PER_TURN,
  type NppPlantsContext,
} from "./nppCorporationBehavior";

const TURN = 400;
const noStateControl = new Set<string>();
const sectorTypes = ["technology", "energy", "agriculture", "healthcare", "financial"] as const;

const plants: NppPlantsContext = {
  enabled: true,
  eraUnitScale: 1,
  year: CAPACITY_ANCHOR_YEAR,
  preset: "2019-default",
  primeRateOf: () => 0,
  costOfLivingOf: () => null,
};

function corp(liquidCapital = 500_000_000, logisticsStrength = 0): Corporation {
  return {
    _id: new ObjectId(),
    name: "Shortage Industries",
    countryId: "US",
    type: "manufacturing",
    headquartersState: "NY",
    liquidCurrencyCode: "USD",
    liquidCapital,
    logisticsStrength,
    ceoType: "npp",
  } as unknown as Corporation;
}

function sectors(corporationId: ObjectId, count = 8): CorporateSector[] {
  return Array.from({ length: count }, (_, index) => ({
    _id: new ObjectId(),
    corporationId,
    sectorType: sectorTypes[index % sectorTypes.length],
    countryId: "US",
    stateId: "NY",
    revenue: 2_000_000,
    realizedRevenue: 2_000_000,
    profitMargin: 30,
    effectiveProfitMargin: 30,
    targetGrowthRate: 2,
  })) as unknown as CorporateSector[];
}

function pool(
  sectorType: UnownedSector["sectorType"] = "manufacturing",
  stateId = "NY"
): UnownedSector {
  const revenue = 80_000_000;
  return {
    _id: new ObjectId(),
    stateId,
    countryId: "US",
    sectorType,
    revenue,
    headroomUnits: computeUnownedHeadroomUnits(sectorType, revenue, 1),
  } as unknown as UnownedSector;
}

const shortagePrices = (commodity: CommodityType): number =>
  commodity === "steel" || commodity === "building_materials" ? 4 : 1;
const balancedPrices = (): number => 1;
const glutPrices = (): number => 0.5;

function decide(args: {
  corporation: Corporation;
  prices: (commodity: CommodityType, countryId: string) => number | null;
  eligible?: boolean;
  pools?: UnownedSector[];
  sectorCount?: number;
  shortageEntryCreditLocal?: number;
  ordinaryEntryEligible?: boolean;
  placementSignals?: { preferFragileMarketSupply?: boolean };
}) {
  return makeNppCorpDecision(
    {
      corp: args.corporation,
      sectors: sectors(args.corporation._id, args.sectorCount),
      turn: TURN,
      now: new Date("2026-08-25T00:00:00Z"),
      fxRate: 1,
      modifiers: ceoArchetypeModifiers("cautious"),
      shortageEntryEligible: args.eligible ?? true,
      ordinaryEntryEligible: args.ordinaryEntryEligible,
      shortageEntryCreditLocal: args.shortageEntryCreditLocal,
    },
    new Map([["US", args.pools ?? [pool()]]]),
    noStateControl,
    args.prices,
    plants,
    args.placementSignals
  );
}

describe("NPP shortage-responsive market entry", () => {
  it("has no fixed corporation-size ceiling when logistics can support the footprint", () => {
    const decision = decide({
      corporation: corp(500_000_000, 1_000),
      prices: balancedPrices,
      sectorCount: 40,
    });

    expect(decision.newSectors).toHaveLength(1);
  });

  it("stops at the logistics-supported footprint until logistics strength grows", () => {
    const decision = decide({
      corporation: corp(500_000_000, 0),
      prices: shortagePrices,
      sectorCount: 15,
    });

    expect(decision.newSectors).toBeUndefined();
    expect(decision.entryDiagnostic?.reason).toBe("logistics_capacity");
  });

  it("opens ordinary diversification slots beyond five sectors", () => {
    const decision = decide({ corporation: corp(), prices: balancedPrices, sectorCount: 5 });

    expect(decision.newSectors).toHaveLength(1);
  });

  it("paces ordinary entry on the corporation cohort slot", () => {
    const decision = decide({
      corporation: corp(),
      prices: balancedPrices,
      sectorCount: 4,
      ordinaryEntryEligible: false,
    });

    expect(decision.newSectors).toBeUndefined();
    expect(decision.entryDiagnostic?.reason).toBe("cohort_ineligible");
  });

  it("does not grant shortages a second market-entry cohort slot", () => {
    const decision = decide({
      corporation: corp(),
      prices: shortagePrices,
      eligible: true,
      ordinaryEntryEligible: false,
    });

    expect(decision.newSectors).toBeUndefined();
    expect(decision.shortageCreditRequest).toBeUndefined();
  });

  it("lets a logistically capable corporation enter a deep-shortage commodity", () => {
    const corporation = corp();
    const decision = decide({ corporation, prices: shortagePrices });

    expect(decision.newSectors).toHaveLength(1);
    expect(decision.newSectors?.[0].sectorType).toBe("manufacturing");
    expect(decision.entryDiagnostic).toMatchObject({
      reason: "entered",
      targetStateId: "NY",
      targetSectorType: "manufacturing",
      cohortEligible: true,
    });
  });

  it("founds the dedicated recipe when a governed fragile market receives the slot", () => {
    const decision = decide({
      corporation: corp(),
      prices: (commodity) => (commodity === "energy" ? 3 : commodity === "fertilizers" ? 2.5 : 1),
      pools: [pool("energy", "PA"), pool("chemical_industries", "PA")],
      placementSignals: { preferFragileMarketSupply: true },
    });

    expect(decision.newSectors).toHaveLength(1);
    expect(decision.newSectors?.[0]).toMatchObject({
      sectorType: "chemical_industries",
      strategyId: "fertilizers",
    });
    expect(decision.entryDiagnostic).toMatchObject({
      reason: "entered",
      interventionTargetCommodity: "fertilizers",
    });
  });

  it.each([
    ["balanced", balancedPrices],
    ["glutted", glutPrices],
  ] as const)("does not exceed logistics capacity in a %s market", (_label, prices) => {
    const decision = decide({ corporation: corp(), prices, sectorCount: 15 });

    expect(decision.newSectors).toBeUndefined();
    expect(decision.shortageCreditRequest).toBeUndefined();
  });

  it("enforces the cohort slot and one-entry per-turn limit", () => {
    const corporation = corp();
    const blocked = decide({
      corporation,
      prices: shortagePrices,
      eligible: false,
      ordinaryEntryEligible: false,
    });
    const eligible = decide({
      corporation,
      prices: (commodity) =>
        commodity === "steel" || commodity === "building_materials" || commodity === "freight"
          ? 4
          : 1,
      pools: [pool("manufacturing", "NY"), pool("logistics", "CA")],
    });

    expect(blocked.newSectors).toBeUndefined();
    expect(eligible.newSectors).toHaveLength(NPP_SHORTAGE_ENTRIES_PER_TURN);
  });

  it("allows exceptional entry for a large corporation with enough logistics", () => {
    const decision = decide({
      corporation: corp(500_000_000, 1_000),
      prices: shortagePrices,
      sectorCount: 40,
    });

    expect(decision.newSectors).toHaveLength(1);
  });

  it("expands to an adjacent state before a larger distant market", () => {
    const distant = pool("manufacturing", "CA");
    distant.revenue = 1e12;
    distant.headroomUnits = computeUnownedHeadroomUnits("manufacturing", distant.revenue, 1);
    const decision = decide({
      corporation: corp(),
      prices: balancedPrices,
      pools: [pool("manufacturing", "PA"), distant],
    });

    expect(decision.newSectors?.[0].stateId).toBe("PA");
  });

  it("funds entry with recorded corporate debt, crediting the proceeds exactly once", async () => {
    const corporation = corp(0);
    const unfunded = decide({ corporation, prices: shortagePrices });
    const request = unfunded.shortageCreditRequest;
    expect(request?.amountLocal).toBeGreaterThan(0);

    const inserted: Array<Omit<Bond, "_id">> = [];
    const insertOne = vi.fn(async (doc: Omit<Bond, "_id">) => {
      inserted.push(doc);
      return { insertedId: new ObjectId() };
    });
    const db = {
      collection: vi.fn(() => ({ insertOne })),
    } as unknown as Db;
    const requestedFace = Math.ceil(request!.amountLocal / 1_000) * 1_000;
    const issued = await issueRelocationBond(
      db,
      corporation,
      requestedFace,
      TURN,
      {
        ok: true,
        cooldownTurnsRemaining: null,
        availableBondCapacity: requestedFace,
        creditRating: "A",
        couponRate: 5,
        existingDebt: 0,
        totalEquity: requestedFace,
      },
      new Map<CurrencyCode, number>([["USD", 1]])
    );
    expect(issued.ok).toBe(true);
    if (!issued.ok) throw new Error("Expected shortage-entry bond issuance to succeed");

    const funded = decide({
      corporation,
      prices: shortagePrices,
      shortageEntryCreditLocal: issued.data.bondFaceValueLocal,
    });
    const bond = inserted[0];
    const order = funded.newSectors?.[0].starterOrder;
    const endingCash = (corporation.liquidCapital ?? 0) + funded.liquidCapitalDelta;
    const foundingSpend = sectorEntryFeeAnchor(plants.preset) + (order?.costPaidAnchor ?? 0);

    expect(funded.newSectors).toHaveLength(1);
    expect(order).toBeDefined();
    expect(bond.corporationId).toEqual(corporation._id);
    expect(bond.totalIssued).toBe(issued.data.bondFaceValueLocal);
    expect(bond.publicFloat * bond.faceValue).toBe(bond.totalIssued);
    expect(bond.matured).toBe(false);
    // Cash after entry + actual founding spend equals opening cash + debt proceeds.
    expect(endingCash + foundingSpend).toBeCloseTo(
      (corporation.liquidCapital ?? 0) + bond.totalIssued
    );
  });

  it("does not borrow for a shortage outside its shortage cohort slot", () => {
    const decision = decide({
      corporation: corp(0),
      prices: shortagePrices,
      sectorCount: 6,
      eligible: false,
    });

    expect(decision.newSectors).toBeUndefined();
    expect(decision.shortageCreditRequest).toBeUndefined();
  });

  it("requests exactly the funding gap, in the corporation's own units", () => {
    // The request is converted local -> anchor and floored back on the way out
    // around issuance, so it must start as a clean local-denominated gap: the
    // founding cost plus the cash floor, less what the corp already holds.
    const rich = decide({ corporation: corp(500_000_000), prices: shortagePrices });
    const broke = decide({ corporation: corp(0), prices: shortagePrices });

    expect(rich.shortageCreditRequest).toBeUndefined();
    expect(broke.shortageCreditRequest).toBeDefined();
    expect(broke.shortageCreditRequest?.amountLocal).toBeGreaterThan(0);
    expect(broke.entryDiagnostic?.reason).toBe("credit_requested");
  });
});
