import { describe, it, expect } from "vitest";
import {
  computeHouseholdConsumption,
  HOUSEHOLD_CONSUMER_BASKET,
  type HouseholdConsumptionState,
  type HouseholdStateSignals,
  type HouseholdConsumptionResult,
} from "./householdConsumption";
import { COMMODITY_BASE_PRICES, type CommodityType } from "@/lib/constants/commodities";

const mkState = (over: Partial<HouseholdConsumptionState> = {}): HouseholdConsumptionState => ({
  stateId: "S1",
  countryId: "US",
  gdp: 100_000,
  population: 10_000_000,
  ...over,
});

const run = (
  states: HouseholdConsumptionState[],
  metrics: Array<[string, HouseholdStateSignals]> = [],
  opts: { priorGlobalPrice?: Map<CommodityType, number>; perCapita?: number } = {}
): HouseholdConsumptionResult =>
  computeHouseholdConsumption({
    states,
    metricsByState: new Map(metrics),
    priorGlobalPrice: opts.priorGlobalPrice,
    perCapita: opts.perCapita,
  });

const gd = (r: HouseholdConsumptionResult, c: CommodityType) => r.global.get(c) ?? 0;
const stateTotal = (r: HouseholdConsumptionResult, sid: string): number => {
  let t = 0;
  for (const v of (r.byState.get(sid) ?? new Map()).values()) t += v;
  return t;
};

describe("computeHouseholdConsumption — basket coverage", () => {
  it("produces demand for consumer commodities and none for excluded ones", () => {
    const r = run([mkState()]);
    // Basket commodities get demand
    expect(gd(r, "food")).toBeGreaterThan(0);
    expect(gd(r, "vehicles")).toBeGreaterThan(0);
    expect(gd(r, "healthcare_services")).toBeGreaterThan(0);
    expect(gd(r, "retail")).toBeGreaterThan(0);
    // Raw extractables + pure-B2B goods are NOT bought by households
    for (const c of [
      "oil",
      "coal",
      "iron",
      "natural_gas",
      "timber",
      "rare_earth",
      "ordnance",
    ] as CommodityType[]) {
      expect(gd(r, c)).toBe(0);
    }
  });

  it("works with no metrics (degrades to a neutral GDP-share basket)", () => {
    const r = run([mkState()]); // empty metricsByState
    expect(stateTotal(r, "S1")).toBeGreaterThan(0);
  });

  it("conserves: global demand equals the sum of per-state contributions", () => {
    const r = run([mkState({ stateId: "A" }), mkState({ stateId: "B" })]);
    for (const c of Object.keys(HOUSEHOLD_CONSUMER_BASKET) as CommodityType[]) {
      const perState = (r.byState.get("A")?.get(c) ?? 0) + (r.byState.get("B")?.get(c) ?? 0);
      expect(gd(r, c)).toBeCloseTo(perState, 6);
    }
  });

  it("requires population but not GDP (budget is population-anchored)", () => {
    // No population → no consumers.
    expect(run([mkState({ population: 0 })]).global.size).toBe(0);
    // Zero measured GDP still consumes — people buy regardless of the GDP figure
    // (and GDP is unreliable across countries, so it must not gate consumption).
    expect(run([mkState({ gdp: 0 })]).global.size).toBeGreaterThan(0);
  });

  it("scales linearly with the per-capita knob (price-neutral)", () => {
    const lo = run([mkState()], [], { perCapita: 0.0004 });
    const hi = run([mkState()], [], { perCapita: 0.0008 });
    expect(gd(hi, "food")).toBeCloseTo(gd(lo, "food") * 2, 6);
  });

  it("sizes the budget by population, independent of the GDP figure", () => {
    // Two states, same population, wildly different (unreliable) GDP → same
    // budget size. Compare total demand; GDP only tilts basket composition.
    const sameIncome: [string, HouseholdStateSignals][] = [
      ["NORMAL", { medianIncome: 50_000 }],
      ["INFLATED", { medianIncome: 50_000 }],
    ];
    const r = run(
      [
        mkState({ stateId: "NORMAL", countryId: "A", gdp: 300_000, population: 10_000_000 }),
        mkState({ stateId: "INFLATED", countryId: "B", gdp: 300_000_000, population: 10_000_000 }),
      ],
      sameIncome
    );
    const total = (sid: string) => {
      let t = 0;
      for (const v of (r.byState.get(sid) ?? new Map()).values()) t += v;
      return t;
    };
    // 1000× GDP difference must not blow up the budget — within the basket-tilt band.
    expect(total("INFLATED") / total("NORMAL")).toBeLessThan(1.3);
  });
});

describe("computeHouseholdConsumption — household signal modulators", () => {
  const twin = (idA: string, idB: string): HouseholdConsumptionState[] => [
    mkState({ stateId: idA }),
    mkState({ stateId: idB }),
  ];

  it("higher income (vs country average) lifts demand", () => {
    const r = run(twin("RICH", "POOR"), [
      ["RICH", { medianIncome: 60_000 }],
      ["POOR", { medianIncome: 40_000 }],
    ]);
    expect(stateTotal(r, "RICH")).toBeGreaterThan(stateTotal(r, "POOR"));
  });

  it("higher unemployment lowers demand", () => {
    const r = run(twin("LOWU", "HIGHU"), [
      ["LOWU", { unemploymentRate: 3 }],
      ["HIGHU", { unemploymentRate: 15 }],
    ]);
    expect(stateTotal(r, "LOWU")).toBeGreaterThan(stateTotal(r, "HIGHU"));
  });

  it("higher consumer confidence lifts demand", () => {
    const r = run(twin("UP", "DOWN"), [
      ["UP", { consumerConfidence: 75 }],
      ["DOWN", { consumerConfidence: 45 }],
    ]);
    expect(stateTotal(r, "UP")).toBeGreaterThan(stateTotal(r, "DOWN"));
  });
});

describe("computeHouseholdConsumption — price elasticity (demand destruction)", () => {
  it("a dearer commodity draws less demand, and staples are less sensitive than luxuries", () => {
    const base = run([mkState()]);
    const dear = run([mkState()], [], {
      priorGlobalPrice: new Map<CommodityType, number>([
        ["food", COMMODITY_BASE_PRICES.food * 2],
        ["vehicles", COMMODITY_BASE_PRICES.vehicles * 2],
      ]),
    });
    const foodDrop = 1 - gd(dear, "food") / gd(base, "food");
    const vehicleDrop = 1 - gd(dear, "vehicles") / gd(base, "vehicles");
    expect(foodDrop).toBeGreaterThan(0); // demand fell when price rose
    expect(vehicleDrop).toBeGreaterThan(0);
    expect(vehicleDrop).toBeGreaterThan(foodDrop); // luxuries more elastic than staples
  });
});

describe("computeHouseholdConsumption — Engel's law tiering", () => {
  it("a richer state tilts its basket away from food toward services", () => {
    // wealthMult ∝ sqrt(gdp/pop): keep population fixed, vary GDP.
    const r = run([
      mkState({ stateId: "RICH", gdp: 600_000, population: 10_000_000 }),
      mkState({ stateId: "POOR", gdp: 30_000, population: 10_000_000 }),
    ]);
    const foodToHealth = (sid: string) =>
      (r.byState.get(sid)!.get("food") ?? 0) /
      (r.byState.get(sid)!.get("healthcare_services") ?? 1);
    // Poorer state spends relatively more on food vs services than the richer one.
    expect(foodToHealth("POOR")).toBeGreaterThan(foodToHealth("RICH"));
  });
});

describe("computeHouseholdConsumption — plants unit re-anchor (ticket #1027)", () => {
  it("scales every basket demand linearly by plantsUnitScale", () => {
    const base = run([mkState()]);
    const scaled = computeHouseholdConsumption({
      states: [mkState()],
      metricsByState: new Map(),
      plantsUnitScale: 3000,
    });
    for (const c of Object.keys(HOUSEHOLD_CONSUMER_BASKET) as CommodityType[]) {
      expect(scaled.global.get(c) ?? 0).toBeCloseTo((base.global.get(c) ?? 0) * 3000, 6);
    }
  });

  it("plantsUnitScale absent / 1 is byte-identical to the legacy path", () => {
    const base = run([mkState()]);
    const explicit = computeHouseholdConsumption({
      states: [mkState()],
      metricsByState: new Map(),
      plantsUnitScale: 1,
      priorGlobalSupply: new Map([["food", 1] as [CommodityType, number]]),
    });
    // scale 1 ⇒ the supply clamp must NOT engage even against tiny supply
    expect(explicit.global.get("food")).toBe(base.global.get("food"));
  });

  it("clamps scaled demand at PLANTS_HOUSEHOLD_SUPPLY_CAP x prior supply, preserving state shares", () => {
    const states = [
      // Equal GDP/capita so the Engel tilt is identical and demand is exactly
      // proportional to population.
      mkState({ stateId: "S1", population: 10_000_000, gdp: 100_000 }),
      mkState({ stateId: "S2", population: 30_000_000, gdp: 300_000 }),
    ];
    const unclamped = computeHouseholdConsumption({
      states,
      metricsByState: new Map(),
      plantsUnitScale: 3000,
    });
    const pharmaDemand = unclamped.global.get("pharmaceuticals") ?? 0;
    expect(pharmaDemand).toBeGreaterThan(0);
    // World supply far below demand: cap engages at 1.5 x supply
    const supply = pharmaDemand / 10;
    const clamped = computeHouseholdConsumption({
      states,
      metricsByState: new Map(),
      plantsUnitScale: 3000,
      priorGlobalSupply: new Map([["pharmaceuticals", supply] as [CommodityType, number]]),
    });
    expect(clamped.global.get("pharmaceuticals")).toBeCloseTo(supply * 1.5, 6);
    // State shares preserved: S2 has 3x S1's population, keeps 3x the demand
    const s1 = clamped.byState.get("S1")?.get("pharmaceuticals") ?? 0;
    const s2 = clamped.byState.get("S2")?.get("pharmaceuticals") ?? 0;
    expect(s2 / s1).toBeCloseTo(3, 4);
    // ...and the state legs still sum to the clamped global
    expect(s1 + s2).toBeCloseTo(supply * 1.5, 6);
    // Commodities whose supply is ample are untouched
    const foodDemand = unclamped.global.get("food") ?? 0;
    const clampedAmple = computeHouseholdConsumption({
      states,
      metricsByState: new Map(),
      plantsUnitScale: 3000,
      priorGlobalSupply: new Map([
        ["pharmaceuticals", supply],
        ["food", foodDemand * 10],
      ] as [CommodityType, number][]),
    });
    expect(clampedAmple.global.get("food")).toBeCloseTo(foodDemand, 6);
  });
});
