import { describe, it, expect } from "vitest";
import type { CommodityType } from "@/lib/constants/commodities";
import type { CountryId } from "@/lib/constants/countries";
import {
  runSourcingPass,
  BUYER_TOLERANCE_SLACK,
  FREIGHT_TEU_PER_UNIT_HOP,
  FREIGHT_CLASS_CAPACITY_SHARE,
  FREIGHT_CLASS_SHARE_FLOOR,
  adaptiveClassShares,
  SEA_FREIGHT_HOP_EQUIV,
  type SourcingInputs,
  FREIGHT_CONGESTION_OVERFLOW,
  GRID_LOSS_PER_HOP,
  GRID_WHEELING_PER_HOP_FRACTION,
} from "./sourcing";
import { FREIGHT_CLASS_BY_COMMODITY } from "./freightClass";
import { COMMODITY_TYPES } from "@/lib/constants/commodities";

type Balance = { supply: number; demand: number };

/** Two-state country A (A1, A2, 1 hop apart) + one-state country B. */
function makeInputs(overrides: Partial<SourcingInputs> = {}): SourcingInputs {
  const empty = (): Map<CommodityType, Balance> => new Map();
  const bal = (entries: Partial<Record<CommodityType, Balance>>): Map<CommodityType, Balance> => {
    const m = empty();
    for (const [c, b] of Object.entries(entries)) m.set(c as CommodityType, b as Balance);
    return m;
  };
  return {
    states: [
      { stateId: "A1", countryId: "US" as CountryId },
      { stateId: "A2", countryId: "US" as CountryId },
      { stateId: "B1", countryId: "UK" as CountryId },
    ],
    byState: new Map([
      ["A1", bal({ coal: { supply: 0, demand: 100 }, freight: { supply: 1000, demand: 0 } })],
      ["A2", bal({ coal: { supply: 200, demand: 0 }, freight: { supply: 1000, demand: 0 } })],
      ["B1", bal({ coal: { supply: 0, demand: 0 } })],
    ]),
    byCountry: new Map([
      ["US", bal({ coal: { supply: 200, demand: 100 } })],
      ["UK", bal({ coal: { supply: 500, demand: 0 } })],
    ]),
    statePricesFor: () => ({ A1: 100, A2: 90, B1: 80 }),
    nationalPricesFor: () => ({ US: 95, UK: 60 }),
    basePriceFor: () => 100,
    freightPrice: 1000,
    hops: (_c, from, to) => (from === to ? 0 : from[0] === to[0] ? 1 : null),
    tariffRatePct: () => 0,
    isBlocked: () => false,
    ...overrides,
  };
}

const coalFlow = (r: ReturnType<typeof runSourcingPass>) =>
  r.flows.filter((f) => f.commodity === "coal");

describe("freight classes", () => {
  it("every commodity has an explicit class entry", () => {
    for (const c of COMMODITY_TYPES) {
      expect(FREIGHT_CLASS_BY_COMMODITY[c] !== undefined, c).toBe(true);
    }
  });
});

describe("runSourcingPass", () => {
  it("fills intra-state demand free before sourcing interstate", () => {
    const r = runSourcingPass(
      makeInputs({
        byState: new Map([
          [
            "A1",
            new Map([
              ["coal", { supply: 60, demand: 100 }],
              ["freight", { supply: 1000, demand: 0 }],
            ]) as Map<CommodityType, Balance>,
          ],
          [
            "A2",
            new Map([
              ["coal", { supply: 200, demand: 0 }],
              ["freight", { supply: 1000, demand: 0 }],
            ]) as Map<CommodityType, Balance>,
          ],
        ]),
        states: [
          { stateId: "A1", countryId: "US" as CountryId },
          { stateId: "A2", countryId: "US" as CountryId },
        ],
        byCountry: new Map([["US", new Map([["coal", { supply: 260, demand: 100 }]])]]),
      })
    );
    const coal = r.summaries.find((s) => s.commodity === "coal")!;
    expect(coal.intraStateUnits).toBeCloseTo(60);
    expect(coal.interStateUnits).toBeCloseTo(40);
    // Only the interstate residual appears as a flow, and it costs shipping.
    const flows = coalFlow(r);
    expect(flows).toHaveLength(1);
    expect(flows[0].originId).toBe("A2");
    expect(flows[0].units).toBeCloseTo(40);
    expect(flows[0].hops).toBe(1);
    expect(flows[0].shippingPerUnit).toBeGreaterThan(0);
  });

  it("buys from the cheapest landed seller, not the cheapest ask", () => {
    // At freightPrice 1000 the sea leg dominates (bulk 0.04 TEU/unit/hop):
    // UK landed 60+240=300 > A2 landed 90+40=130 — domestic wins despite higher ask.
    const r = runSourcingPass(makeInputs());
    const flows = coalFlow(r);
    expect(flows[0].originType).toBe("state");
    expect(flows[0].originId).toBe("A2");
    expect(flows[0].landedPrice).toBeCloseTo(90 + 1000 * FREIGHT_TEU_PER_UNIT_HOP.bulk * 1);
    expect(flows[0].units).toBeCloseTo(100);
  });

  it("prefer foreign when sea shipping is cheap enough, then tariffs flip it", () => {
    // freightPrice 100: UK landed 60+24=84 < A2 90+4=94.
    const cheapSea = makeInputs({ freightPrice: 100 });
    const cheap = coalFlow(runSourcingPass(cheapSea))[0];
    expect(cheap.originId).toBe("UK");
    expect(cheap.landedPrice).toBeCloseTo(
      60 + 100 * FREIGHT_TEU_PER_UNIT_HOP.bulk * SEA_FREIGHT_HOP_EQUIV
    );

    // 60% tariff: UK 60×1.6 + 24 = 120 > A2's 94.
    const taxed = runSourcingPass(makeInputs({ freightPrice: 100, tariffRatePct: () => 60 }));
    const taxedFlows = coalFlow(taxed);
    expect(taxedFlows[0].originId).toBe("A2");
    expect(taxedFlows).toHaveLength(1);
    expect(taxed.summaries.find((s) => s.commodity === "coal")!.tariffPaid).toBe(0);
  });

  it("books tariff paid on import flows", () => {
    // freightPrice 100 + 10% tariff: UK landed 66 + 24 = 90 < 94, still wins.
    const r = runSourcingPass(makeInputs({ freightPrice: 100, tariffRatePct: () => 10 }));
    const flow = coalFlow(r)[0];
    expect(flow.originId).toBe("UK");
    expect(flow.tariffRatePct).toBe(10);
    expect(flow.tariffPaid).toBeCloseTo(100 * 60 * 0.1);
    const coal = r.summaries.find((s) => s.commodity === "coal")!;
    expect(coal.tariffPaid).toBeCloseTo(600);
  });

  it("excludes embargoed exporters entirely", () => {
    const r = runSourcingPass(
      makeInputs({ isBlocked: (_c, exporter) => exporter === ("UK" as CountryId) })
    );
    const flows = coalFlow(r);
    expect(flows.every((f) => f.originId !== "UK")).toBe(true);
    expect(flows[0].originId).toBe("A2");
  });

  it("leaves demand unmet when every seller is above the tolerance ceiling", () => {
    // Buyer price 100 → ceiling 100 × (1 + slack). Push asks far above it.
    const r = runSourcingPass(
      makeInputs({
        statePricesFor: () => ({ A1: 100, A2: 100 * (1 + BUYER_TOLERANCE_SLACK) + 50 }),
        nationalPricesFor: () => ({ UK: 100 * (1 + BUYER_TOLERANCE_SLACK) + 50 }),
      })
    );
    const coal = r.summaries.find((s) => s.commodity === "coal")!;
    expect(coalFlow(r)).toHaveLength(0);
    expect(coal.unmetUnits).toBeCloseTo(100);
    expect(coal.toleranceBoundUnits).toBeCloseTo(100);
  });

  it("caps interstate shipping at the origin state's per-class freight capacity", () => {
    // A2 freight supply 0.2 → bulk cap 0.2 × share; 1 hop × TEU/unit.
    const freightSupply = 0.2;
    const r = runSourcingPass(
      makeInputs({
        byState: new Map([
          ["A1", new Map([["coal", { supply: 0, demand: 100 }]]) as Map<CommodityType, Balance>],
          [
            "A2",
            new Map([
              ["coal", { supply: 200, demand: 0 }],
              ["freight", { supply: freightSupply, demand: 0 }],
            ]) as Map<CommodityType, Balance>,
          ],
        ]),
        states: [
          { stateId: "A1", countryId: "US" as CountryId },
          { stateId: "A2", countryId: "US" as CountryId },
        ],
        byCountry: new Map([["US", new Map([["coal", { supply: 200, demand: 100 }]])]]),
        // Buyer pays well above the landed price, so the congestion surcharge
        // still clears its tolerance ceiling and overflow is allowed.
        statePricesFor: () => ({ A1: 200, A2: 90, B1: 80 }),
      })
    );
    // Congestion, not a wall: with headroom under the buyer's tolerance the
    // network hauls past nominal capacity at a surcharge on the overflow units.
    const nominal =
      (freightSupply * FREIGHT_CLASS_CAPACITY_SHARE.bulk) / FREIGHT_TEU_PER_UNIT_HOP.bulk;
    const shippable = nominal * (1 + FREIGHT_CONGESTION_OVERFLOW);
    const coal = r.summaries.find((s) => s.commodity === "coal")!;
    expect(coal.interStateUnits).toBeCloseTo(shippable);
    expect(coal.congestionUnits).toBeCloseTo(nominal * FREIGHT_CONGESTION_OVERFLOW);
    expect(coal.congestionSurchargePaid).toBeGreaterThan(0);
    expect(coal.capacityBoundUnits).toBeGreaterThan(0);
    expect(coal.unmetUnits).toBeCloseTo(100 - shippable);
    // Network load ledger records the consumption on the ORIGIN state.
    expect(r.freightTeuByState.get("A2")!.bulk).toBeCloseTo(
      freightSupply * FREIGHT_CLASS_CAPACITY_SHARE.bulk * (1 + FREIGHT_CONGESTION_OVERFLOW)
    );
  });

  it("is deterministic: identical inputs give identical flows", () => {
    const a = runSourcingPass(makeInputs());
    const b = runSourcingPass(makeInputs());
    expect(JSON.stringify(a.flows)).toBe(JSON.stringify(b.flows));
  });

  it("never mutates the input balances", () => {
    const inputs = makeInputs();
    const before = JSON.stringify([...inputs.byState.get("A2")!.entries()]);
    runSourcingPass(inputs);
    expect(JSON.stringify([...inputs.byState.get("A2")!.entries()])).toBe(before);
  });

  it("landedPremiumByDestState: interstate fill carries shipping as extra cost", () => {
    // Same as "buys from the cheapest landed seller": A1 buys 100 units from
    // A2 at ask 90, shippingPerUnit = 1000 × 0.04 × 1 hop = 40.
    const r = runSourcingPass(makeInputs());
    const a1 = r.landedPremiumByDestState.get("A1")!.get("coal")!;
    expect(a1.metUnits).toBeCloseTo(100);
    expect(a1.extraCost).toBeCloseTo(100 * 40);
    // Sellers/pure-domestic states never buy, so they carry no accumulator.
    expect(r.landedPremiumByDestState.get("A2")?.get("coal")).toBeUndefined();
  });

  it("landedPremiumByDestState: local fill contributes met units at zero extra cost", () => {
    const r = runSourcingPass(
      makeInputs({
        byState: new Map([
          [
            "A1",
            new Map([
              ["coal", { supply: 60, demand: 100 }],
              ["freight", { supply: 1000, demand: 0 }],
            ]) as Map<CommodityType, Balance>,
          ],
          [
            "A2",
            new Map([
              ["coal", { supply: 200, demand: 0 }],
              ["freight", { supply: 1000, demand: 0 }],
            ]) as Map<CommodityType, Balance>,
          ],
        ]),
        states: [
          { stateId: "A1", countryId: "US" as CountryId },
          { stateId: "A2", countryId: "US" as CountryId },
        ],
        byCountry: new Map([["US", new Map([["coal", { supply: 260, demand: 100 }]])]]),
      })
    );
    const a1 = r.landedPremiumByDestState.get("A1")!.get("coal")!;
    // 60 units local (free) + 40 interstate at shippingPerUnit 40.
    expect(a1.metUnits).toBeCloseTo(100);
    expect(a1.extraCost).toBeCloseTo(40 * 40);
  });

  it("importAggregatesByCountry: sums import value and tariff paid by buyer country", () => {
    const r = runSourcingPass(makeInputs({ freightPrice: 100, tariffRatePct: () => 10 }));
    const usAgg = r.importAggregatesByCountry.get("US")!;
    expect(usAgg.importValue).toBeCloseTo(100 * 60);
    expect(usAgg.tariffPaid).toBeCloseTo(100 * 60 * 0.1);
  });

  it("importAggregatesByCountry: no entry for a buyer country with no import flows", () => {
    const r = runSourcingPass(makeInputs());
    expect(r.importAggregatesByCountry.has("US")).toBe(false);
  });
});

describe("adaptiveClassShares", () => {
  it("falls back to the static split with no prior load", () => {
    expect(adaptiveClassShares(undefined)).toEqual(FREIGHT_CLASS_CAPACITY_SHARE);
    expect(adaptiveClassShares({ bulk: 0, special: 0, grid: 0 })).toEqual(
      FREIGHT_CLASS_CAPACITY_SHARE
    );
  });

  it("follows the measured mix (NY t202: ~90% special demand got 30% capacity)", () => {
    const shares = adaptiveClassShares({ bulk: 328, special: 2958, grid: 0 });
    expect(shares.special).toBeCloseTo(1 - FREIGHT_CLASS_SHARE_FLOOR, 5);
    expect(shares.bulk).toBeCloseTo(FREIGHT_CLASS_SHARE_FLOOR, 5);
  });

  it("floors both classes so neither is starved by a one-turn skew", () => {
    const allBulk = adaptiveClassShares({ bulk: 1000, special: 0, grid: 0 });
    expect(allBulk.special).toBeCloseTo(FREIGHT_CLASS_SHARE_FLOOR, 5);
    const even = adaptiveClassShares({ bulk: 500, special: 500, grid: 0 });
    expect(even.bulk).toBeCloseTo(0.5, 5);
    expect(even.special).toBeCloseTo(0.5, 5);
  });

  it("the pass sizes per-state capacity from the prior loads", () => {
    // A2 hauled special-heavy last turn; with the static 30% share its special
    // capacity would be 300 TEU, adaptive gives it 80% of 1000.
    const heavy = new Map([["A2", { bulk: 100, special: 900, grid: 0 }]]);
    const withPrior = runSourcingPass(
      makeInputs({
        freightPrice: 10,
        priorClassLoads: heavy,
        byState: new Map([
          [
            "A1",
            (() => {
              const m = new Map();
              m.set("rare_earth", { supply: 0, demand: 5000 });
              return m;
            })(),
          ],
          [
            "A2",
            (() => {
              const m = new Map();
              m.set("rare_earth", { supply: 6000, demand: 0 });
              m.set("freight", { supply: 1000, demand: 0 });
              return m;
            })(),
          ],
          ["B1", new Map()],
        ]),
        byCountry: new Map([
          [
            "US",
            (() => {
              const m = new Map();
              m.set("rare_earth", { supply: 6000, demand: 5000 });
              return m;
            })(),
          ],
          ["UK", new Map()],
        ]),
      })
    );
    const noPrior = runSourcingPass(
      makeInputs({
        freightPrice: 10,
        byState: new Map([
          [
            "A1",
            (() => {
              const m = new Map();
              m.set("rare_earth", { supply: 0, demand: 5000 });
              return m;
            })(),
          ],
          [
            "A2",
            (() => {
              const m = new Map();
              m.set("rare_earth", { supply: 6000, demand: 0 });
              m.set("freight", { supply: 1000, demand: 0 });
              return m;
            })(),
          ],
          ["B1", new Map()],
        ]),
        byCountry: new Map([
          [
            "US",
            (() => {
              const m = new Map();
              m.set("rare_earth", { supply: 6000, demand: 5000 });
              return m;
            })(),
          ],
          ["UK", new Map()],
        ]),
      })
    );
    const shipped = (r: ReturnType<typeof runSourcingPass>) =>
      r.flows
        .filter((f) => f.commodity === "rare_earth" && f.originId === "A2")
        .reduce((s, f) => s + f.units, 0);
    // rare_earth is special class: adaptive split moves more of A2's fleet to
    // special trailers, so more units reach A1 before capacity binds.
    expect(shipped(withPrior)).toBeGreaterThan(shipped(noPrior));
  });
});

describe("grid class (energy and natural gas)", () => {
  const gridInputs = (overrides: Partial<SourcingInputs> = {}) =>
    makeInputs({
      byState: new Map([
        ["A1", new Map([["energy", { supply: 0, demand: 100 }]]) as Map<CommodityType, Balance>],
        [
          "A2",
          new Map([
            ["energy", { supply: 500, demand: 0 }],
            // No freight supply at all: a grid haul must not need any.
            ["freight", { supply: 0, demand: 0 }],
          ]) as Map<CommodityType, Balance>,
        ],
      ]),
      states: [
        { stateId: "A1", countryId: "US" as CountryId },
        { stateId: "A2", countryId: "US" as CountryId },
      ],
      byCountry: new Map([["US", new Map([["energy", { supply: 500, demand: 100 }]])]]),
      statePricesFor: () => ({ A1: 100, A2: 90 }),
      nationalPricesFor: () => ({ US: 95 }),
      ...overrides,
    });

  it("moves energy between states, which the null class never could", () => {
    const r = runSourcingPass(gridInputs());
    const energy = r.summaries.find((s) => s.commodity === "energy")!;
    expect(energy.interStateUnits).toBeGreaterThan(0);
    expect(r.flows.some((f) => f.commodity === "energy" && f.destStateId === "A1")).toBe(true);
  });

  it("spends no haulage capacity, so a state with zero freight still wheels power", () => {
    const r = runSourcingPass(gridInputs());
    expect(r.freightTeuByState.get("A2")?.grid ?? 0).toBe(0);
    const energy = r.summaries.find((s) => s.commodity === "energy")!;
    expect(energy.capacityBoundUnits).toBe(0);
    expect(
      r.flows.filter((f) => f.commodity === "energy").every((f) => f.freightTeuConsumed === 0)
    ).toBe(true);
  });

  it("loses a share of every dispatched unit to transmission, per hop", () => {
    const r = runSourcingPass(gridInputs());
    const energy = r.summaries.find((s) => s.commodity === "energy")!;
    // One hop: the buyer's 100 units of demand need 100 / (1 - loss) dispatched.
    expect(energy.gridLossUnits).toBeCloseTo(100 / (1 - GRID_LOSS_PER_HOP) - 100, 2);
    expect(energy.interStateUnits).toBeCloseTo(100);
  });

  it("prices distance as wheeling off the ask, not off the freight market", () => {
    const cheapFreight = runSourcingPass(gridInputs({ freightPrice: 1 }));
    const dearFreight = runSourcingPass(gridInputs({ freightPrice: 100000 }));
    const leg = (r: ReturnType<typeof runSourcingPass>) =>
      r.flows.find((f) => f.commodity === "energy")!.shippingPerUnit;
    // A freight-price spike has no business moving the cost of electricity.
    expect(leg(cheapFreight)).toBeCloseTo(leg(dearFreight));
    expect(leg(cheapFreight)).toBeCloseTo(90 * GRID_WHEELING_PER_HOP_FRACTION);
  });
});
