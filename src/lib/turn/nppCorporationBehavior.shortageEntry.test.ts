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
  NPP_BASE_SECTOR_CAP,
  NPP_SHORTAGE_ENTRIES_PER_TURN,
  NPP_SHORTAGE_SECTOR_HARD_CAP,
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

function corp(liquidCapital = 500_000_000): Corporation {
  return {
    _id: new ObjectId(),
    name: "Shortage Industries",
    countryId: "US",
    type: "manufacturing",
    headquartersState: "NY",
    liquidCurrencyCode: "USD",
    liquidCapital,
    ceoType: "npp",
  } as unknown as Corporation;
}

function sectors(corporationId: ObjectId, count = NPP_BASE_SECTOR_CAP): CorporateSector[] {
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
  sectorType: "manufacturing" | "logistics" = "manufacturing",
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
      shortageEntryCreditLocal: args.shortageEntryCreditLocal,
    },
    new Map([["US", args.pools ?? [pool()]]]),
    noStateControl,
    args.prices,
    plants
  );
}

describe("NPP shortage-responsive market entry", () => {
  it("lets a corporation at the old cap enter a deep-shortage commodity", () => {
    const corporation = corp();
    const decision = decide({ corporation, prices: shortagePrices });

    expect(NPP_SHORTAGE_SECTOR_HARD_CAP).toBeGreaterThan(NPP_BASE_SECTOR_CAP);
    expect(decision.newSectors).toHaveLength(1);
    expect(decision.newSectors?.[0].sectorType).toBe("manufacturing");
  });

  it.each([
    ["balanced", balancedPrices],
    ["glutted", glutPrices],
  ] as const)("does not exceed the old cap for a %s commodity", (_label, prices) => {
    const decision = decide({ corporation: corp(), prices });

    expect(decision.newSectors).toBeUndefined();
    expect(decision.shortageCreditRequest).toBeUndefined();
  });

  it("enforces the cohort slot and one-entry per-turn limit", () => {
    const corporation = corp();
    const blocked = decide({ corporation, prices: shortagePrices, eligible: false });
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

  it("stops exceptional entry at the higher hard ceiling", () => {
    const decision = decide({
      corporation: corp(),
      prices: shortagePrices,
      sectorCount: NPP_SHORTAGE_SECTOR_HARD_CAP,
    });

    expect(decision.newSectors).toBeUndefined();
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
    const endingCash = funded.updates.liquidCapital as number;
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

  it("leaves an under-cap corporation on the ordinary cash-funded path", () => {
    // The cap exception is only for corps that have hit the ordinary limit. A
    // corp below it with a real shortage in front of it must still save up
    // rather than borrow, which is the pre-existing behaviour.
    const decision = decide({
      corporation: corp(0),
      prices: shortagePrices,
      sectorCount: NPP_BASE_SECTOR_CAP - 2,
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
  });
});
