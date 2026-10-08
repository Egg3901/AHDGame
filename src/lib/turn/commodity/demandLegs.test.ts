import { describe, expect, it } from "vitest";
import { COMMODITY_TYPES, type CommodityType } from "@/lib/constants/commodities";
import {
  aggregateByCountry,
  applyAdvertisingDemand,
  applyDemandCalibration,
  applyDemographicsUplift,
  applyGovernmentDemand,
  GOVERNMENT_DEMAND_SUPPLY_CAP,
  governmentSupplyCapFactors,
  applyLatentFinancialDemand,
  bondIssuanceAnchor,
  applyRateSensitiveDemand,
  buildStatesByCountry,
} from "./demandLegs";
import type { GlobalLedger, StateLedger } from "./ledgerTypes";

function blankLedgers(): { global: GlobalLedger; byState: StateLedger } {
  const global: GlobalLedger = new Map();
  for (const c of COMMODITY_TYPES) global.set(c, { supply: 0, demand: 0 });
  return { global, byState: new Map() };
}

describe("applyAdvertisingDemand", () => {
  const corp = (overrides: Record<string, unknown>) => ({
    _id: { toString: () => "corp1" },
    marketingBudget: 0,
    liquidCapital: 0,
    headquartersState: "s1",
    countryOwnerId: null,
    countryId: "US",
    liquidCurrencyCode: undefined,
    ...overrides,
  });

  it("books funded budgets to global and HQ-state demand", () => {
    const { global, byState } = blankLedgers();
    applyAdvertisingDemand(
      {
        // Cast: only the fields the leg reads matter here.
        allCorporations: [corp({ marketingBudget: 2400, liquidCapital: 2400 })] as never,
        currencyByCorpId: new Map([["corp1", { code: undefined, rate: 1 }]]),
        advertisingBasePrice: 100,
      },
      global,
      byState
    );
    expect(global.get("advertising")!.demand).toBeGreaterThan(0);
    expect(byState.get("s1")!.get("advertising")!.demand).toBe(global.get("advertising")!.demand);
  });

  it("treats unfunded intent as no demand", () => {
    const { global, byState } = blankLedgers();
    applyAdvertisingDemand(
      {
        allCorporations: [corp({ marketingBudget: 2400, liquidCapital: 0 })] as never,
        currencyByCorpId: new Map([["corp1", { code: undefined, rate: 1 }]]),
        advertisingBasePrice: 100,
      },
      global,
      byState
    );
    expect(global.get("advertising")!.demand).toBe(0);
    expect(byState.has("s1")).toBe(false);
  });

  it("caps funded demand at what the treasury covers", () => {
    const { global: g1, byState: b1 } = blankLedgers();
    const { global: g2, byState: b2 } = blankLedgers();
    const fx = new Map([["corp1", { code: undefined, rate: 1 }]]);
    applyAdvertisingDemand(
      {
        allCorporations: [corp({ marketingBudget: 2400, liquidCapital: 2400 })] as never,
        currencyByCorpId: fx,
        advertisingBasePrice: 100,
      },
      g1,
      b1
    );
    applyAdvertisingDemand(
      {
        allCorporations: [corp({ marketingBudget: 1_000_000, liquidCapital: 100 })] as never,
        currencyByCorpId: fx,
        advertisingBasePrice: 100,
      },
      g2,
      b2
    );
    // Same funded total (min(1M, 100×24) = 2400) ⇒ same demand despite the
    // larger headline budget, since the sublinear damping pivots on the total.
    expect(g2.get("advertising")!.demand).toBe(g1.get("advertising")!.demand);
  });
});

describe("applyRateSensitiveDemand", () => {
  function setup() {
    const { global, byState } = blankLedgers();
    global.get("food")!.demand = 10;
    return { global, byState };
  }

  it("floors the delta at zero when money is dear", () => {
    const { global, byState } = setup();
    applyRateSensitiveDemand(
      {
        allStateBudgets: [{ stateId: "s1", stateGdp: 1000 }] as never,
        stateToCountry: new Map([["s1", "US"]]),
        fxRateForCountry: () => 1,
        // Prime far above any neutral rate ⇒ (neutral - prime) < 0 ⇒ floored.
        centralBankByCountry: new Map([["US", 99]]),
        ledgerBasePrices: Object.fromEntries(COMMODITY_TYPES.map((c) => [c, 100])) as Record<
          CommodityType,
          number
        >,
      },
      global,
      byState
    );
    expect(global.get("food")!.demand).toBe(10);
    expect(global.get("vehicles")!.demand).toBe(0);
    expect(global.get("financial_services")!.demand).toBe(0);
  });

  it("adds demand when rates sit below neutral", () => {
    const { global, byState } = setup();
    applyRateSensitiveDemand(
      {
        allStateBudgets: [{ stateId: "s1", stateGdp: 1000 }] as never,
        stateToCountry: new Map([["s1", "US"]]),
        fxRateForCountry: () => 1,
        centralBankByCountry: new Map([["US", 0]]),
        ledgerBasePrices: Object.fromEntries(COMMODITY_TYPES.map((c) => [c, 100])) as Record<
          CommodityType,
          number
        >,
      },
      global,
      byState
    );
    expect(global.get("food")!.demand).toBeGreaterThan(10);
    expect(byState.get("s1")!.get("food")!.demand).toBeGreaterThan(0);
  });
});

describe("applyDemographicsUplift", () => {
  it("uplifts existing demand proportionally and skips empty states", () => {
    const { global, byState } = blankLedgers();
    global.get("food")!.demand = 100;
    byState.set(
      "s1",
      new Map(COMMODITY_TYPES.map((c) => [c, { supply: 0, demand: c === "food" ? 100 : 0 }]))
    );
    byState.set("s2", new Map(COMMODITY_TYPES.map((c) => [c, { supply: 0, demand: 0 }])));
    applyDemographicsUplift(
      [
        { _id: "s1", gdp: 1000, population: 100 },
        { _id: "s2", gdp: 0, population: 0 },
      ],
      global,
      byState
    );
    expect(global.get("food")!.demand).toBeGreaterThan(100);
    expect(byState.get("s1")!.get("food")!.demand).toBe(global.get("food")!.demand);
    expect(byState.get("s2")!.get("food")!.demand).toBe(0);
  });
});

describe("aggregateByCountry", () => {
  it("sums state books into country books", () => {
    const { byState } = blankLedgers();
    const food = (supply: number, demand: number) => ({ supply, demand });
    byState.set(
      "s1",
      new Map(COMMODITY_TYPES.map((c) => [c, c === "food" ? food(3, 7) : food(0, 0)]))
    );
    byState.set(
      "s2",
      new Map(COMMODITY_TYPES.map((c) => [c, c === "food" ? food(5, 1) : food(0, 0)]))
    );
    const byCountry = aggregateByCountry(
      byState,
      new Map([
        ["s1", "US"],
        ["s2", "US"],
      ])
    );
    expect(byCountry.get("US")!.get("food")).toEqual({ supply: 8, demand: 8 });
  });
});

describe("buildStatesByCountry", () => {
  it("skips national-scope rows and zero-gdp states", () => {
    const out = buildStatesByCountry([
      { _id: "s1", countryId: "US", gdp: 100 },
      { _id: "s2", countryId: "US", gdp: 0 },
      { _id: "federal", countryId: "US", gdp: 999 },
    ]);
    expect(out.get("US")!.get("s1")).toBe(100);
    expect(out.get("US")!.has("s2")).toBe(false);
    expect(out.get("US")!.has("federal")).toBe(false);
  });
});

describe("applyLatentFinancialDemand", () => {
  it("allocates sovereign issuance pro-rata by state GDP", () => {
    const { global, byState } = blankLedgers();
    applyLatentFinancialDemand(
      {
        statesByCountry: new Map([["US", new Map([["s1", 100]])]]),
        allCorporations: [],
        recentBonds: [{ issuerType: "sovereign", countryId: "US", totalIssued: 10000000 }] as never,
        centralBankByCountry: new Map([["US", 5]]),
        fxRateForBond: () => 1,
      },
      global,
      byState
    );
    expect(global.get("financial_services")!.demand).toBeGreaterThan(0);
    expect(byState.get("s1")!.get("financial_services")!.demand).toBe(
      global.get("financial_services")!.demand
    );
  });

  it("ignores issuance with no rate signal", () => {
    const { global, byState } = blankLedgers();
    applyLatentFinancialDemand(
      {
        statesByCountry: new Map([["US", new Map([["s1", 100]])]]),
        allCorporations: [],
        recentBonds: [{ issuerType: "sovereign", countryId: "US", totalIssued: 10000000 }] as never,
        centralBankByCountry: new Map(),
        fxRateForBond: () => 1,
      },
      global,
      byState
    );
    expect(global.get("financial_services")!.demand).toBe(0);
    expect(byState.has("s1")).toBe(false);
  });
});

describe("latent financial demand currency", () => {
  const run = (bonds: unknown[], fx: (code?: string) => number, corps: unknown[] = []) => {
    const { global, byState } = blankLedgers();
    applyLatentFinancialDemand(
      {
        statesByCountry: new Map([
          ["US", new Map([["s1", 100]])],
          ["IT", new Map([["it1", 100]])],
        ]),
        allCorporations: corps as never,
        recentBonds: bonds as never,
        centralBankByCountry: new Map([
          ["US", 5],
          ["IT", 5],
        ]),
        fxRateForBond: (bond) => fx(bond.currencyCode),
      },
      global,
      byState
    );
    return global.get("financial_services")!.demand;
  };

  it("converts a lira issue to anchor before it becomes demand", () => {
    // 1.358 trillion lira at 1,358 lira per anchor is a 1 billion anchor issue.
    const lira = run(
      [
        {
          issuerType: "sovereign",
          countryId: "IT",
          currencyCode: "ITL",
          totalIssued: 1_358_000_000_000,
        },
      ],
      (code) => (code === "ITL" ? 1358 : 1)
    );
    const dollars = run(
      [
        {
          issuerType: "sovereign",
          countryId: "US",
          currencyCode: "USD",
          totalIssued: 1_000_000_000,
        },
      ],
      () => 1
    );
    expect(dollars).toBeGreaterThan(0);
    expect(lira).toBeCloseTo(dollars, 1);
  });

  it("converts corporate issues at the bond's currency", () => {
    const corps = [{ _id: { toString: () => "c1" }, headquartersState: "it1", countryId: "IT" }];
    const lira = run(
      [
        {
          issuerType: "corporate",
          corporationId: "c1",
          currencyCode: "ITL",
          totalIssued: 135_800_000_000,
        },
      ],
      (code) => (code === "ITL" ? 1358 : 1),
      corps
    );
    const anchor = run(
      [{ issuerType: "corporate", corporationId: "c1", totalIssued: 100_000_000 }],
      () => 1,
      corps
    );
    expect(lira).toBeCloseTo(anchor, 1);
  });

  it("treats a missing or non-positive rate as anchor", () => {
    expect(
      bondIssuanceAnchor(
        { totalIssued: 500, issuerType: "sovereign", countryId: "US" } as never,
        () => 0
      )
    ).toBe(500);
    expect(
      bondIssuanceAnchor({ totalIssued: 500, currencyCode: "JPY" } as never, () => 136)
    ).toBeCloseTo(500 / 136, 9);
  });
});

describe("government demand supply cap", () => {
  const BASE_100 = Object.fromEntries(COMMODITY_TYPES.map((c) => [c, 100])) as Record<
    CommodityType,
    number
  >;
  const run = (
    prior: Map<CommodityType, number> | undefined,
    truncated = new Map<CommodityType, number>()
  ) => {
    const { global, byState } = blankLedgers();
    const byCountry = aggregateByCountry(byState, new Map());
    applyGovernmentDemand(
      {
        federalBudgets: [
          { countryId: "US", spending: { byCategory: { healthcare: 480_000 } } },
          { countryId: "UK", spending: { byCategory: { healthcare: 160_000 } } },
        ] as never,
        ledgerBasePrices: BASE_100,
        fxRateForCountry: () => 1,
        ledgerCurrentYear: null,
        ledgerCommandEconomyEnabled: false,
        statesByCountry: new Map([
          ["US", new Map([["s1", 100]])],
          ["UK", new Map([["u1", 100]])],
        ]),
        stateToCountry: new Map([
          ["s1", "US"],
          ["u1", "UK"],
        ]),
        priorGlobalSupply: prior,
      },
      global,
      byCountry,
      byState,
      truncated
    );
    return { global, byCountry, truncated };
  };

  it("holds government purchases to the cap times last turn's supply, keeping shares", () => {
    const uncapped = run(undefined).global.get("healthcare_services")!.demand;
    // Last turn's supply is a tenth of what governments ask for.
    const supply = uncapped / 10;
    const { global, byCountry, truncated } = run(new Map([["healthcare_services", supply]]));
    const capped = global.get("healthcare_services")!.demand;
    expect(capped).toBeCloseTo(supply * GOVERNMENT_DEMAND_SUPPLY_CAP, 9);
    const us = byCountry.get("US")!.get("healthcare_services")!.demand;
    const uk = byCountry.get("UK")!.get("healthcare_services")!.demand;
    expect(us / uk).toBeCloseTo(3, 9);
    expect(truncated.get("healthcare_services")).toBeCloseTo(uncapped - capped, 6);
  });

  it("leaves a commodity with no recorded supply uncapped", () => {
    const uncapped = run(undefined).global.get("healthcare_services")!.demand;
    expect(
      run(new Map([["healthcare_services", 0]])).global.get("healthcare_services")!.demand
    ).toBeCloseTo(uncapped, 9);
  });

  it("bounds calibrated demand", () => {
    const f = governmentSupplyCapFactors(
      [{ commodity: "ordnance", units: 100 }],
      new Map([["ordnance", 10]]),
      () => 2
    );
    // cap = 10 x 1.5 / 2 = 7.5 of the 100 requested
    expect(f.get("ordnance")).toBeCloseTo(0.075, 9);
  });
});

describe("applyGovernmentDemand", () => {
  const BASE_100 = Object.fromEntries(COMMODITY_TYPES.map((c) => [c, 100])) as Record<
    CommodityType,
    number
  >;

  it("books healthcare spend to global, country, and regional state books", () => {
    const { global, byState } = blankLedgers();
    const byCountry = aggregateByCountry(byState, new Map());
    applyGovernmentDemand(
      {
        federalBudgets: [
          { countryId: "US", spending: { byCategory: { healthcare: 4800 } } },
        ] as never,
        ledgerBasePrices: BASE_100,
        fxRateForCountry: () => 1,
        ledgerCurrentYear: null,
        ledgerCommandEconomyEnabled: false,
        statesByCountry: new Map([["US", new Map([["s1", 100]])]]),
        stateToCountry: new Map([["s1", "US"]]),
      },
      global,
      byCountry,
      byState
    );
    expect(global.get("healthcare_services")!.demand).toBeGreaterThan(0);
    expect(byCountry.get("US")!.get("healthcare_services")!.demand).toBe(
      global.get("healthcare_services")!.demand
    );
    expect(byState.get("s1")!.get("healthcare_services")!.demand).toBeGreaterThan(0);
  });

  it("treats a zero-spend budget as no demand", () => {
    const { global, byState } = blankLedgers();
    const byCountry = aggregateByCountry(byState, new Map());
    applyGovernmentDemand(
      {
        federalBudgets: [{ countryId: "US", spending: { byCategory: {} } }] as never,
        ledgerBasePrices: BASE_100,
        fxRateForCountry: () => 1,
        ledgerCurrentYear: null,
        ledgerCommandEconomyEnabled: false,
        statesByCountry: new Map([["US", new Map([["s1", 100]])]]),
        stateToCountry: new Map([["s1", "US"]]),
      },
      global,
      byCountry,
      byState
    );
    expect(global.get("healthcare_services")!.demand).toBe(0);
  });
});

describe("applyDemandCalibration", () => {
  it("is inert for the modern era", () => {
    const { global, byState } = blankLedgers();
    global.get("food")!.demand = 42;
    const byCountry = aggregateByCountry(byState, new Map());
    applyDemandCalibration({ activePreset: "" }, global, byCountry, byState);
    expect(global.get("food")!.demand).toBe(42);
  });
});
