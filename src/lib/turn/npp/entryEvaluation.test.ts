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
  sectors?: CorporateSector[];
  profitable?: boolean;
  marginPct?: number;
  retailExpansionPaused?: boolean;
  entryCapReached?: boolean;
  prices?: () => number;
  entryEligible?: boolean;
  allowExpansion?: boolean;
  wideEligible?: boolean;
}) {
  const byCountry = new Map<string, UnownedSector[]>();
  for (const item of args.pools ?? [pool()]) {
    const list = byCountry.get(item.countryId) ?? [];
    list.push(item);
    byCountry.set(item.countryId, list);
  }
  return evaluateNppEntry({
    corp: args.corporation,
    sectors: args.sectors ?? [],
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
    allowExpansion: args.allowExpansion ?? true,
    ordinaryEntryEligible: args.entryEligible ?? true,
    shortageEntryEligible: args.entryEligible ?? true,
    criticalLogisticsEntryEligible: args.wideEligible,
    criticalLogisticsShortageEligible: args.wideEligible,
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

describe("critical freight shortage", () => {
  const logisticsCorp = () => corp({ type: "logistics" });
  const logisticsPool = () => [pool("logistics")];

  it("admits a logistics candidate that the strategy lever would hold", () => {
    const held = evaluate({
      corporation: logisticsCorp(),
      pools: logisticsPool(),
      allowExpansion: false,
      prices: () => 2,
    });
    expect(held.entryCandidate?.sectorType).toBe("logistics");
    expect(held.criticalShortage).toBe(true);
    expect(held.expansion).not.toBeNull();
    expect(held.allowExpansion).toBe(true);
    expect(held.exceptionalShortageEntry).toBe(true);
    expect(held.diagnostic.reason).toBe("cash_floor");
  });

  it("uses the widened cohort slot for logistics only", () => {
    const widened = evaluate({
      corporation: logisticsCorp(),
      pools: logisticsPool(),
      entryEligible: false,
      wideEligible: true,
      prices: () => 2,
    });
    expect(widened.marketEntryEligible).toBe(true);
    expect(widened.exceptionalShortageEntry).toBe(true);
    const outside = evaluate({
      corporation: logisticsCorp(),
      pools: logisticsPool(),
      entryEligible: false,
      wideEligible: false,
      prices: () => 2,
    });
    expect(outside.marketEntryEligible).toBe(false);
    expect(outside.diagnostic.reason).toBe("cohort_ineligible");
  });

  it("keeps the lever and cohort for a non-critical logistics shortage", () => {
    const entry = evaluate({
      corporation: logisticsCorp(),
      pools: logisticsPool(),
      allowExpansion: false,
      entryEligible: false,
      wideEligible: true,
      prices: () => 1.2,
    });
    expect(entry.criticalShortage).toBe(false);
    expect(entry.allowExpansion).toBe(false);
    expect(entry.expansion).toBeNull();
    expect(entry.marketEntryEligible).toBe(false);
    expect(entry.diagnostic.reason).toBe("strategy_disallowed");
  });

  it("leaves other sector types under the lever and ordinary cohort", () => {
    const held = evaluate({
      corporation: corp(),
      pools: [pool("manufacturing")],
      allowExpansion: false,
      entryEligible: false,
      wideEligible: true,
      prices: () => 2,
    });
    expect(held.criticalShortage).toBe(true);
    expect(held.allowExpansion).toBe(false);
    expect(held.expansion).toBeNull();
    expect(held.marketEntryEligible).toBe(false);
    expect(held.diagnostic.reason).toBe("strategy_disallowed");
  });

  it("does not report profit or margin blocks for a critical candidate", () => {
    const entry = evaluate({
      corporation: logisticsCorp(),
      pools: logisticsPool(),
      profitable: false,
      marginPct: -20,
      prices: () => 2,
    });
    expect(entry.diagnostic.reason).toBe("cash_floor");
    const ordinary = evaluate({
      corporation: logisticsCorp(),
      pools: logisticsPool(),
      profitable: false,
      marginPct: -20,
      prices: () => 1.2,
    });
    expect(ordinary.diagnostic.reason).toBe("unprofitable");
  });
});

describe("existing media sector occupancy", () => {
  it("still permits a different media model in the same state", () => {
    const corporation = corp({ type: "media" });
    const market = pool("media", "KAN");
    const existing = {
      _id: new ObjectId(),
      corporationId: corporation._id,
      countryId: "US",
      stateId: "KAN",
      sectorType: "media",
      mediaDiscriminator: "entertainment",
    } as CorporateSector;
    expect(evaluate({ corporation, pools: [market], sectors: [existing] }).entryCandidate).toBe(
      market
    );
  });

  it("does not found a second entertainment sector in an occupied bucket", () => {
    const corporation = corp({ type: "media", mediaDiscriminator: "entertainment" });
    const market = { ...pool("media", "KAN"), mediaDiscriminator: "entertainment" as const };
    const existing = {
      _id: new ObjectId(),
      corporationId: corporation._id,
      countryId: "US",
      stateId: "KAN",
      sectorType: "media",
      mediaDiscriminator: "entertainment",
    } as CorporateSector;
    const result = evaluate({ corporation, pools: [market], sectors: [existing] });
    expect(result.entryCandidate).toBeNull();
    expect(result.expansion).toBeNull();
  });
});
