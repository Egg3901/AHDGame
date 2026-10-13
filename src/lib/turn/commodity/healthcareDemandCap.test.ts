import { describe, expect, it } from "vitest";
import { COMMODITY_TYPES, type CommodityType } from "@/lib/constants/commodities";
import { computeClearingFactors } from "@/lib/market/clearing";
import {
  demandThrottleFactor,
  soldOutMarketHeadroomUnits,
  withLatentDemand,
} from "../corporation/demandThrottle";
import {
  aggregateByCountry,
  applyGovernmentDemand,
  applyHouseholdDemand,
  capHealthcareDemandToLocalSupply,
  ensureStateLedger,
  globalDemandCapSupply,
  governmentSupplyCapFactors,
} from "./demandLegs";
import type { GlobalLedger, StateLedger } from "./ledgerTypes";

const healthcare: CommodityType = "healthcare_services";
const basePrices = Object.fromEntries(COMMODITY_TYPES.map((c) => [c, 100])) as Record<
  CommodityType,
  number
>;
const countries = new Map([
  ["IL", "US"],
  ["CA", "US"],
  ["EN", "UK"],
]);
function ledger(entries: Array<[string, number, number]>) {
  const global: GlobalLedger = new Map(COMMODITY_TYPES.map((c) => [c, { supply: 0, demand: 0 }]));
  const byState: StateLedger = new Map();
  for (const [state, supply, demand] of entries) {
    Object.assign(ensureStateLedger(byState, state).get(healthcare)!, { supply, demand });
    global.get(healthcare)!.supply += supply;
    global.get(healthcare)!.demand += demand;
  }
  return {
    global,
    byState,
    byCountry: aggregateByCountry(byState, countries),
    stateToCountry: countries,
    householdDemandByState: new Map<string, Map<CommodityType, number>>(),
    truncated: new Map<CommodityType, number>(),
  };
}

describe("healthcare local final-demand cap", () => {
  it("caps each clearing book, preserves latent need and reconciles every aggregate", () => {
    const books = ledger([
      ["IL", 100, 300],
      ["CA", 200, 20],
      ["EN", 10, 1000],
    ]);
    books.householdDemandByState.set("IL", new Map([[healthcare, 200]]));
    books.householdDemandByState.set("EN", new Map([[healthcare, 5]]));
    capHealthcareDemandToLocalSupply(books);
    expect(books.byState.get("IL")!.get(healthcare)!.demand).toBe(150);
    expect(books.byState.get("CA")!.get(healthcare)!.demand).toBe(20);
    expect(books.byState.get("EN")!.get(healthcare)!.demand).toBe(15);
    expect(books.byCountry.get("US")!.get(healthcare)!.demand).toBe(170);
    expect(books.byCountry.get("UK")!.get(healthcare)!.demand).toBe(15);
    expect(books.global.get(healthcare)!.demand).toBe(185);
    expect(books.truncated.get(healthcare)).toBe(1135);
    expect(books.householdDemandByState.get("IL")!.get(healthcare)).toBe(150);
    expect(books.householdDemandByState.get("EN")!.get(healthcare)).toBe(5);
  });

  it("preserves buyers outside the household and government ceiling", () => {
    const books = ledger([["IL", 100, 450]]);
    capHealthcareDemandToLocalSupply({ ...books, otherDemandByState: new Map([["IL", 250]]) });
    expect(books.byState.get("IL")!.get(healthcare)!.demand).toBe(400);
    expect(books.global.get(healthcare)!.demand).toBe(400);
    expect(books.byCountry.get("US")!.get(healthcare)!.demand).toBe(400);
    expect(books.truncated.get(healthcare)).toBe(50);
  });

  it("bounds calibrated demand exactly once and adds to existing truncation", () => {
    const books = ledger([["IL", 100, 1000]]);
    books.truncated.set(healthcare, 20);
    capHealthcareDemandToLocalSupply({ ...books, demandCalibration: () => 0.5 });
    expect(books.global.get(healthcare)!.demand * 0.5).toBe(150);
    expect(books.truncated.get(healthcare)).toBe(370);
  });

  it("leaves zero-supply seeded books open for a new provider and needs no new flags or stamps", () => {
    const books = ledger([["IL", 0, 300]]);
    capHealthcareDemandToLocalSupply(books);
    expect(books.global.get(healthcare)!.demand).toBe(300);
    expect(books.truncated.size).toBe(0);
    expect(demandThrottleFactor(100, undefined, undefined)).toBe(1);
  });

  it("defers only healthcare's global cap without mutating its source", () => {
    const old = new Map<CommodityType, number>([
      [healthcare, 1],
      ["ordnance", 50],
    ]);
    const next = globalDemandCapSupply(old);
    expect(old.get(healthcare)).toBe(1);
    expect(next.has(healthcare)).toBe(false);
    expect(next.get("ordnance")).toBe(50);
  });

  it("books raw household and government demand before the local shared ceiling", () => {
    const books = ledger([
      ["IL", 100, 0],
      ["EN", 10, 0],
    ]);
    const supply = globalDemandCapSupply(new Map([[healthcare, 1]]));
    const household = applyHouseholdDemand(
      {
        eraUnitScale: 1,
        plantsUnitScale: 100,
        priorGlobalSupply: supply,
        states: [
          { stateId: "IL", countryId: "US", gdp: 1e9, population: 1e6 },
          { stateId: "EN", countryId: "UK", gdp: 1e9, population: 1e6 },
        ],
        metricsByState: new Map(),
        priorGlobalPrice: new Map(),
      },
      books.global,
      books.byState,
      books.truncated
    );
    books.byCountry = aggregateByCountry(books.byState, countries);
    applyGovernmentDemand(
      {
        federalBudgets: [
          { countryId: "US", spending: { byCategory: { healthcare: 1e12 } } },
          { countryId: "UK", spending: { byCategory: { healthcare: 1e12 } } },
        ] as never,
        ledgerBasePrices: basePrices,
        fxRateForCountry: () => 1,
        ledgerCurrentYear: null,
        ledgerCommandEconomyEnabled: false,
        statesByCountry: new Map([
          ["US", new Map([["IL", 1]])],
          ["UK", new Map([["EN", 1]])],
        ]),
        stateToCountry: countries,
        priorGlobalSupply: supply,
      },
      books.global,
      books.byCountry,
      books.byState,
      books.truncated
    );
    const raw = books.global.get(healthcare)!.demand;
    expect(raw).toBeGreaterThan(165);
    capHealthcareDemandToLocalSupply({ ...books, householdDemandByState: household });
    expect(books.global.get(healthcare)!.demand).toBeCloseTo(165, 6);
    expect(books.truncated.get(healthcare)).toBeCloseTo(raw - 165, 5);
  });

  // Illustrative fixed-demand world. Real production cap, clearing, headroom and
  // throttle functions are chained over many turns, not a chart smoothing test.
  function simulate(localCap: boolean, initial: number, olderSupply: number, capacities: number[]) {
    let produced = capacities.map(
      (capacity) => (initial * capacity) / capacities.reduce((a, b) => a + b, 0)
    );
    let priorSupply = olderSupply;
    const history: number[] = [];
    for (let turn = 0; turn < 24; turn++) {
      const supply = produced.reduce((a, b) => a + b, 0);
      const factor =
        governmentSupplyCapFactors(
          [{ commodity: healthcare, units: 1000 }],
          new Map([[healthcare, priorSupply]]),
          undefined
        ).get(healthcare) ?? 1;
      const books = ledger([["IL", supply, localCap ? 300 : 300 * factor]]);
      if (localCap) capHealthcareDemandToLocalSupply(books);
      const balance = books.byState.get("IL")!.get(healthcare)!;
      const cleared = computeClearingFactors({
        sectors: produced.map((units, i) => ({
          sectorId: String(i),
          revenue: units * 100,
          outputUnitsByCommodity: { [healthcare]: units },
          supplyRates: { [healthcare]: 1 },
          posture: 0,
        })),
        balances: books.global,
        basePrices,
        priceRatioByCommodity: new Map([[healthcare, 1]]),
        stateMarkets: {
          stateBySector: new Map(produced.map((_, i) => [String(i), "IL"])),
          balances: books.byState,
          priceRatios: new Map(),
        },
      });
      const latentFactor = 300 / balance.demand;
      const next = produced.map((units, i) => {
        const clear = cleared.get(String(i))!;
        const headroom = soldOutMarketHeadroomUnits({
          soldByCommodity: clear.soldByCommodity,
          supplyRates: { [healthcare]: 1 },
          mixWeightFor: () => 1,
          marketShareFor: () => clear.marketSupplyShareByCommodity?.[healthcare],
          balanceFor: () => withLatentDemand(balance, latentFactor),
          priceRatioFor: () => 1,
        });
        return (
          capacities[i] *
          demandThrottleFactor(
            capacities[i],
            units * clear.soldFraction,
            units,
            undefined,
            headroom
          )
        );
      });
      priorSupply = supply;
      produced = next;
      history.push(produced.reduce((a, b) => a + b, 0));
    }
    return history;
  }

  it("reproduces the old permanent full/floor cycle", () => {
    const history = simulate(false, 100, 10, [100]);
    expect(history.slice(-4)).toEqual([10, 100, 10, 100]);
  });

  it.each([
    [100, 10, [100]],
    [10, 100, [100]],
    [15, 150, [100, 50]],
  ] as const)(
    "stabilizes existing and newly expanded cohorts from supply %s / older %s",
    (initial, older, capacities) => {
      const history = simulate(true, initial, older, [...capacities]);
      const capacity = capacities.reduce((a, b) => a + b, 0);
      expect(history.slice(-10)).toEqual(Array(10).fill(capacity));
    }
  );

  it("still throttles a genuine local glut instead of forcing full production", () => {
    const books = ledger([["IL", 100, 20]]);
    capHealthcareDemandToLocalSupply(books);
    const clear = computeClearingFactors({
      sectors: [
        { sectorId: "hospital", revenue: 10000, supplyRates: { [healthcare]: 1 }, posture: 0 },
      ],
      balances: books.global,
      basePrices,
      priceRatioByCommodity: new Map([[healthcare, 1]]),
      stateMarkets: {
        stateBySector: new Map([["hospital", "IL"]]),
        balances: books.byState,
        priceRatios: new Map(),
      },
    }).get("hospital")!;
    expect(clear.soldFraction).toBeCloseTo(0.2);
    expect(demandThrottleFactor(100, 100 * clear.soldFraction, 100)).toBeCloseTo(0.23);
  });
});
