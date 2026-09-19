import { describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
import type { Corporation, CorporateSector, UnownedSector } from "@/lib/db/types";
import type { CommodityType } from "@/lib/constants/commodities";
import type { CorporationType } from "@/lib/constants/corporations";
import { CAPACITY_ANCHOR_YEAR } from "@/lib/constants/capacityEconomy";
import { computeUnownedHeadroomUnits } from "@/lib/market/unownedHeadroom";
import { ceoArchetypeModifiers } from "@/lib/turn/ceoArchetype";
import { bucketKey } from "@/lib/nationalization/stateControlledBuckets";
import { makeNppCorpDecision, type NppPlantsContext } from "../nppCorporationBehavior";
import type { NppCorpDecisionContext } from "./corpDecisionTypes";

const TURN = 400;

const plants: NppPlantsContext = {
  enabled: true,
  eraUnitScale: 1,
  year: CAPACITY_ANCHOR_YEAR,
  preset: "2019-default",
  primeRateOf: () => 0,
  costOfLivingOf: () => null,
};

function corp(
  liquidCapital = 1_000_000_000_000,
  overrides: Partial<Corporation> = {}
): Corporation {
  return {
    _id: new ObjectId(),
    name: "Frontier Industries",
    countryId: "US",
    type: "manufacturing",
    headquartersState: "NY",
    liquidCurrencyCode: "USD",
    liquidCapital,
    logisticsStrength: 0,
    ceoType: "npp",
    ...overrides,
  } as unknown as Corporation;
}

function profitableSectors(corporationId: ObjectId, count = 3): CorporateSector[] {
  return Array.from({ length: count }, (_, index) => ({
    _id: new ObjectId(),
    corporationId,
    sectorType: ["technology", "energy", "agriculture"][index % 3],
    countryId: "US",
    stateId: "NY",
    revenue: 2_000_000,
    realizedRevenue: 2_000_000,
    profitMargin: 30,
    effectiveProfitMargin: 30,
    targetGrowthRate: 2,
  })) as unknown as CorporateSector[];
}

function losingSectors(corporationId: ObjectId, count = 3): CorporateSector[] {
  return Array.from({ length: count }, (_, index) => ({
    _id: new ObjectId(),
    corporationId,
    sectorType: ["technology", "energy", "agriculture"][index % 3],
    countryId: "US",
    stateId: "NY",
    revenue: 2_000_000,
    realizedRevenue: 2_000_000,
    targetGrowthRate: 2,
    plantsPnl: {
      revenue: 2_000_000,
      profit: -200_000,
      inventoryRevenue: 0,
      inventoryCarry: 0,
      inputs: 0,
      labour: 0,
      upkeep: 0,
      compliance: 0,
    },
  })) as unknown as CorporateSector[];
}

function thinMarginSectors(corporationId: ObjectId, count = 3): CorporateSector[] {
  return losingSectors(corporationId, count).map((sector) => ({
    ...sector,
    plantsPnl: { ...(sector.plantsPnl as object), revenue: 2_000_000, profit: 100_000 },
  })) as unknown as CorporateSector[];
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

const balancedPrices = (): number => 1;
const glutPrices = (): number => 0.5;

interface FrontierState {
  enabled: boolean;
  enteredCohorts: Set<string>;
  enteredControllers: Set<string>;
}

function frontierOn(): FrontierState {
  return { enabled: true, enteredCohorts: new Set(), enteredControllers: new Set() };
}

function decide(args: {
  corporation: Corporation;
  sectors: CorporateSector[];
  prices?: (commodity: CommodityType, countryId: string) => number | null;
  pools?: UnownedSector[];
  stateControlled?: ReadonlySet<string>;
  frontierEntry?: FrontierState;
  ordinaryEntryEligible?: boolean;
  retailExpansionPaused?: boolean;
  usePlants?: boolean;
}) {
  const ctx: NppCorpDecisionContext = {
    corp: args.corporation,
    sectors: args.sectors,
    turn: TURN,
    now: new Date("2026-08-25T00:00:00Z"),
    fxRate: 1,
    modifiers: ceoArchetypeModifiers("cautious"),
    shortageEntryEligible: true,
    ordinaryEntryEligible: args.ordinaryEntryEligible,
    retailExpansionPaused: args.retailExpansionPaused,
    frontierEntry: args.frontierEntry,
  };
  const byCountry = new Map<string, UnownedSector[]>();
  for (const item of args.pools ?? [pool()]) {
    const list = byCountry.get(item.countryId) ?? [];
    list.push(item);
    byCountry.set(item.countryId, list);
  }
  return makeNppCorpDecision(
    ctx,
    byCountry,
    args.stateControlled ?? new Set<string>(),
    args.prices ?? balancedPrices,
    args.usePlants === false ? undefined : plants,
    undefined
  );
}

describe("frontier entry experiment turn path", () => {
  it("is byte-equivalent with the flag off, disabled, or slot-taken", () => {
    const corporation = corp();
    const shared = profitableSectors(corporation._id);
    const base = decide({ corporation, sectors: shared });
    const disabled = decide({
      corporation,
      sectors: shared,
      frontierEntry: { enabled: false, enteredCohorts: new Set(), enteredControllers: new Set() },
    });
    expect(disabled).toEqual(base);

    const losing = corp();
    const losingSectorsShared = losingSectors(losing._id);
    const off = decide({ corporation: losing, sectors: losingSectorsShared });
    expect(off.entryDiagnostic?.reason).toBe("unprofitable");
    expect(off.newSectors).toBeUndefined();
    const taken = frontierOn();
    // Block the exact cohort the off-path candidate targeted.
    taken.enteredCohorts.add(
      `${off.entryDiagnostic?.countryId ?? "US"}\0${off.entryDiagnostic?.targetStateId ?? ""}`
    );
    const guardedAfterSlot = decide({
      corporation: losing,
      sectors: losingSectorsShared,
      frontierEntry: taken,
    });
    expect(guardedAfterSlot).toEqual(off);
  });

  it("places an unprofitable but fundable candidate with real costs and the trial marker", () => {
    const corporation = corp();
    const state = frontierOn();
    const decision = decide({
      corporation,
      sectors: losingSectors(corporation._id),
      frontierEntry: state,
    });
    expect(decision.entryDiagnostic?.reason).toBe("entered");
    expect(decision.newSectors).toHaveLength(1);
    expect(decision.newSectors?.[0]).toMatchObject({ stateId: "NY", countryId: "US" });
    expect(decision.entryDiagnostic?.frontierExperiment).toMatchObject({
      cohortKey: "US\0NY",
      controllerKey: corporation._id.toString(),
      relaxedReason: "unprofitable",
    });
    const foundingCost = decision.entryDiagnostic?.foundingCostLocal ?? 0;
    expect(foundingCost).toBeGreaterThan(0);
    expect(decision.liquidCapitalDelta).toBeLessThan(0);
    expect(decision.unownedDraws).toHaveLength(1);
    // The slot is consumed: the same cohort cannot enter again this turn.
    expect(state.enteredCohorts.has("US\0NY")).toBe(true);
    expect(state.enteredControllers.has(corporation._id.toString())).toBe(true);
    // No survival protection is attached: a plain sector, cold flags unset.
    expect(decision.newSectors?.[0]).not.toHaveProperty("mothballed");
  });

  it("relaxes a thin margin through the same priced path", () => {
    const corporation = corp();
    const decision = decide({
      corporation,
      sectors: thinMarginSectors(corporation._id),
      frontierEntry: frontierOn(),
    });
    expect(decision.entryDiagnostic?.reason).toBe("entered");
    expect(decision.entryDiagnostic?.frontierExperiment?.relaxedReason).toBe("margin_below_floor");
    expect(decision.newSectors).toHaveLength(1);
  });

  it("relaxes the nominal cash floor on the legacy path when the real cost is covered", () => {
    // Cautious bands: floor 375k, expansion needs 937.5k surplus, flat cost
    // 500k. 1M surplus (625k) misses the nominal band but covers the cost.
    const corporation = corp(1_000_000);
    const off = decide({
      corporation,
      sectors: profitableSectors(corporation._id),
      usePlants: false,
    });
    expect(off.entryDiagnostic?.reason).toBe("cash_floor");
    expect(off.newSectors).toBeUndefined();
    const on = decide({
      corporation,
      sectors: profitableSectors(corporation._id),
      usePlants: false,
      frontierEntry: frontierOn(),
    });
    expect(on.entryDiagnostic?.reason).toBe("entered");
    expect(on.entryDiagnostic?.frontierExperiment?.relaxedReason).toBe("cash_floor");
    expect(on.newSectors).toHaveLength(1);
    expect(on.liquidCapitalDelta).toBeLessThan(0);
  });

  it("caps one entrant per cohort and one per controller, with no aggregate cap", () => {
    const state = frontierOn();
    const first = corp();
    const firstDecision = decide({
      corporation: first,
      sectors: losingSectors(first._id),
      frontierEntry: state,
    });
    expect(firstDecision.newSectors).toHaveLength(1);

    // Same state cohort, different corp: blocked.
    const second = corp();
    const secondDecision = decide({
      corporation: second,
      sectors: losingSectors(second._id),
      frontierEntry: state,
    });
    expect(secondDecision.newSectors).toBeUndefined();
    expect(secondDecision.entryDiagnostic?.reason).toBe("unprofitable");
    expect(secondDecision.entryDiagnostic?.frontierExperiment).toBeUndefined();

    // Same controller, different state: blocked by common-control dedup.
    const parent = new ObjectId();
    const thirdState = frontierOn();
    const third = corp(1_000_000_000_000, { parentDividendFloorSetByCorpId: parent });
    const thirdDecision = decide({
      corporation: third,
      sectors: losingSectors(third._id),
      pools: [pool("manufacturing", "PA")],
      frontierEntry: thirdState,
    });
    expect(thirdDecision.newSectors).toHaveLength(1);
    const fourth = corp(1_000_000_000_000, {
      headquartersState: "OH",
      parentDividendFloorSetByCorpId: parent,
    });
    const fourthDecision = decide({
      corporation: fourth,
      sectors: losingSectors(fourth._id),
      pools: [pool("manufacturing", "OH")],
      frontierEntry: thirdState,
    });
    expect(fourthDecision.newSectors).toBeUndefined();
    expect(fourthDecision.entryDiagnostic?.frontierExperiment).toBeUndefined();

    // Different cohorts and controllers: no aggregate cap, both enter.
    const wide = frontierOn();
    const corpA = corp();
    const decisionA = decide({
      corporation: corpA,
      sectors: losingSectors(corpA._id),
      pools: [pool("manufacturing", "NY")],
      frontierEntry: wide,
    });
    const corpB = corp();
    const decisionB = decide({
      corporation: corpB,
      sectors: losingSectors(corpB._id),
      pools: [pool("manufacturing", "PA")],
      frontierEntry: wide,
    });
    expect(decisionA.newSectors).toHaveLength(1);
    expect(decisionB.newSectors).toHaveLength(1);
  });

  it("an ordinary entry consumes the cohort slot for the experiment", () => {
    const state = frontierOn();
    const ordinary = corp();
    const ordinaryDecision = decide({
      corporation: ordinary,
      sectors: profitableSectors(ordinary._id),
      frontierEntry: state,
    });
    expect(ordinaryDecision.entryDiagnostic?.reason).toBe("entered");
    expect(ordinaryDecision.entryDiagnostic?.frontierExperiment).toBeUndefined();
    expect(state.enteredCohorts.has("US\0NY")).toBe(true);

    const late = corp();
    const lateDecision = decide({
      corporation: late,
      sectors: losingSectors(late._id),
      frontierEntry: state,
    });
    expect(lateDecision.newSectors).toBeUndefined();
    expect(lateDecision.entryDiagnostic?.reason).toBe("unprofitable");
  });

  it("rejects on the real founding cost and leaves the slot unconsumed", () => {
    const state = frontierOn();
    const poor = corp(1);
    const decision = decide({
      corporation: poor,
      sectors: losingSectors(poor._id),
      frontierEntry: state,
    });
    expect(decision.newSectors).toBeUndefined();
    expect(decision.entryDiagnostic?.reason).toBe("founding_cost");
    expect(decision.entryDiagnostic?.frontierExperiment).toBeUndefined();
    expect(state.enteredCohorts.size).toBe(0);

    // The unconsumed slot stays usable for a fundable corp in the same cohort.
    const funded = corp();
    const fundedDecision = decide({
      corporation: funded,
      sectors: losingSectors(funded._id),
      frontierEntry: state,
    });
    expect(fundedDecision.newSectors).toHaveLength(1);
  });

  it("never bypasses state control, glut, retail pause, or cohort stagger", () => {
    const controlled = corp();
    const controlledDecision = decide({
      corporation: controlled,
      sectors: profitableSectors(controlled._id),
      stateControlled: new Set([bucketKey("NY", "manufacturing")]),
      frontierEntry: frontierOn(),
    });
    expect(controlledDecision.newSectors).toBeUndefined();
    expect(controlledDecision.entryDiagnostic?.frontierExperiment).toBeUndefined();

    const glutted = corp();
    const glutDecision = decide({
      corporation: glutted,
      sectors: profitableSectors(glutted._id),
      prices: glutPrices,
      frontierEntry: frontierOn(),
    });
    expect(glutDecision.entryDiagnostic?.reason).toBe("glutted_market");
    expect(glutDecision.newSectors).toBeUndefined();

    const retail = corp();
    const retailDecision = decide({
      corporation: retail,
      sectors: profitableSectors(retail._id),
      pools: [pool("retail", "NY")],
      retailExpansionPaused: true,
      frontierEntry: frontierOn(),
    });
    expect(retailDecision.entryDiagnostic?.reason).toBe("retail_paused");
    expect(retailDecision.newSectors).toBeUndefined();

    const staggered = corp();
    const staggerDecision = decide({
      corporation: staggered,
      sectors: profitableSectors(staggered._id),
      ordinaryEntryEligible: false,
      frontierEntry: frontierOn(),
    });
    expect(staggerDecision.entryDiagnostic?.reason).toBe("cohort_ineligible");
    expect(staggerDecision.newSectors).toBeUndefined();

    // A relaxable reason must not mask a failed later gate: unprofitable AND
    // cohort-staggered stays out.
    const masked = corp();
    const maskedDecision = decide({
      corporation: masked,
      sectors: losingSectors(masked._id),
      ordinaryEntryEligible: false,
      frontierEntry: frontierOn(),
    });
    expect(maskedDecision.newSectors).toBeUndefined();
    expect(maskedDecision.entryDiagnostic?.frontierExperiment).toBeUndefined();
  });
});
