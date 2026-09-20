import { describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
import type { Corporation, CorporateSector, UnownedSector } from "@/lib/db/types";
import type { CorporationType } from "@/lib/constants/corporations";
import { computeUnownedHeadroomUnits } from "@/lib/market/unownedHeadroom";
import { evaluateNppEntry } from "./entryEvaluation";

function corp(overrides: Partial<Corporation> = {}): Corporation {
  return {
    _id: new ObjectId(),
    name: "Entry Industries",
    countryId: "US",
    type: "manufacturing",
    headquartersState: "NY",
    liquidCurrencyCode: "USD",
    liquidCapital: 1_000_000_000_000,
    logisticsStrength: 0,
    ceoType: "npp",
    ...overrides,
  } as unknown as Corporation;
}

function pool(sectorType: CorporationType = "manufacturing", stateId = "NY"): UnownedSector {
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

function evaluate(args: {
  corporation: Corporation;
  pools?: UnownedSector[];
  profitable?: boolean;
  marginPct?: number;
  retailExpansionPaused?: boolean;
  entryCapReached?: boolean;
  prices?: () => number;
  entryEligible?: boolean;
}) {
  const byCountry = new Map<string, UnownedSector[]>();
  for (const item of args.pools ?? [pool()]) {
    const list = byCountry.get(item.countryId) ?? [];
    list.push(item);
    byCountry.set(item.countryId, list);
  }
  return evaluateNppEntry({
    corp: args.corporation,
    sectors: [] as unknown as CorporateSector[],
    unownedByCountry: byCountry,
    stateControlled: new Set<string>(),
    priceRatioOf: args.prices ?? (() => 1),
    placementSignals: undefined,
    plantsEnabled: false,
    eraUnitScale: 1,
    profitable: args.profitable ?? true,
    marginPct: args.marginPct ?? 30,
    marginFloorPct: 10,
    surplusCash: 1_000_000_000,
    minCash: 0,
    sectorCount: 3,
    logisticsSupportedSectors: 10,
    allowExpansion: true,
    ordinaryEntryEligible: args.entryEligible ?? true,
    shortageEntryEligible: args.entryEligible ?? true,
    retailExpansionPaused: args.retailExpansionPaused,
    entryCapReached: args.entryCapReached ?? false,
  });
}

describe("entryEvaluation seam", () => {
  it("selects the candidate and opens ordinary entry when every gate passes", () => {
    const corporation = corp();
    const entry = evaluate({ corporation });
    expect(entry.entryCandidate?.stateId).toBe("NY");
    expect(entry.expansion?.stateId).toBe("NY");
    expect(entry.ordinaryEntry).toBe(true);
    expect(entry.hasLogisticsCapacity).toBe(true);
    expect(entry.marketEntryEligible).toBe(true);
    expect(entry.diagnostic.targetStateId).toBe("NY");
    // Pre-pricing reasons never read `entered`: the nominal surplus band is
    // the last pre-pricing gate, and `entered` is set only after pricing.
    expect(entry.diagnostic.reason).toBe("cash_floor");
  });

  it("names unprofitability as the binding gate when the corp loses money", () => {
    const entry = evaluate({ corporation: corp(), profitable: false });
    expect(entry.entryCandidate?.stateId).toBe("NY");
    expect(entry.expansion).toBeNull();
    expect(entry.ordinaryEntry).toBe(false);
    expect(entry.diagnostic.reason).toBe("unprofitable");
  });

  it("lets a critical shortage bypass profitability without bypassing the cohort", () => {
    const open = evaluate({
      corporation: corp(),
      profitable: false,
      marginPct: -20,
      prices: () => 2,
    });
    const cohortBlocked = evaluate({
      corporation: corp(),
      profitable: false,
      marginPct: -20,
      prices: () => 2,
      entryEligible: false,
    });

    expect(open.expansion).not.toBeNull();
    expect(open.exceptionalShortageEntry).toBe(true);
    expect(cohortBlocked.marketEntryEligible).toBe(false);
    expect(cohortBlocked.exceptionalShortageEntry).toBe(false);
  });

  it("names the retail pause on the candidate instead of the cash floor", () => {
    const entry = evaluate({
      corporation: corp(),
      pools: [pool("retail")],
      retailExpansionPaused: true,
    });
    expect(entry.entryCandidate?.sectorType).toBe("retail");
    expect(entry.expansion).toBeNull();
    expect(entry.diagnostic.reason).toBe("retail_paused");
  });

  it("closes ordinary entry when the per-turn cap is already reached", () => {
    const entry = evaluate({ corporation: corp(), entryCapReached: true });
    expect(entry.ordinaryEntry).toBe(true);
    expect(entry.diagnostic.reason).toBe("entry_cap");
  });
});
