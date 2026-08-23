import { describe, it, expect } from "vitest";
import type { CommodityType } from "@/lib/constants/commodities";
import type { CountryId } from "@/lib/constants/countries";
import {
  runSourcingPass,
  BUYER_TOLERANCE_SLACK,
  FREIGHT_PRICE_TEU_PER_UNIT_HOP,
  FREIGHT_TEU_PER_UNIT_HOP,
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
    nationalPricesFor: () => ({ US: 95, UK: 80 }),
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

  it("prices a one-hop bulk haul independently from its freight-capacity load", () => {
    // Production t322: median-state iron was 4.92/unit and freight was
    // 221.25/TEU. The 0.04 TEU capacity weight must remain, but using it as the
    // price weight charges 8.85/unit and rejects even a one-hop route against
    // the 35% buyer ceiling. The original 0.004 price weight charges 0.885 and
    // lets the route clear while still consuming 4 TEU of network capacity.
    const ironPrice = 4.92;
    const freightPrice = 221.25;
    const units = 100;
    const r = runSourcingPass(
      makeInputs({
        states: [
          { stateId: "A1", countryId: "US" as CountryId },
          { stateId: "A2", countryId: "US" as CountryId },
        ],
        byState: new Map([
          [
            "A1",
            new Map([
              ["iron", { supply: 0, demand: units }],
              ["freight", { supply: 100, demand: 0 }],
            ]) as Map<CommodityType, Balance>,
          ],
          [
            "A2",
            new Map([
              ["iron", { supply: units, demand: 0 }],
              ["freight", { supply: 100, demand: 0 }],
            ]) as Map<CommodityType, Balance>,
          ],
        ]),
        byCountry: new Map([["US", new Map([["iron", { supply: units, demand: units }]])]]),
        statePricesFor: () => ({ A1: ironPrice, A2: ironPrice }),
        nationalPricesFor: () => ({ US: ironPrice }),
        basePriceFor: () => ironPrice,
        freightPrice,
      })
    );

    const flow = r.flows.find((candidate) => candidate.commodity === "iron");
    expect(flow?.units).toBeCloseTo(units);
    expect(flow?.shippingPerUnit).toBe(0.89);
    expect(flow?.freightTeuConsumed).toBeCloseTo(units * FREIGHT_TEU_PER_UNIT_HOP.bulk);
    const iron = r.summaries.find((summary) => summary.commodity === "iron")!;
    expect(iron.toleranceBoundUnits).toBe(0);
  });

  it("buys from the cheapest landed seller, not the cheapest ask", () => {
    // At freightPrice 1000 the sea leg dominates (bulk 0.004 price weight/unit/hop):
    // UK landed 80+24=104 > A2 landed 90+4=94, so domestic wins despite
    // the foreign seller's lower ask.
    const r = runSourcingPass(makeInputs());
    const flows = coalFlow(r);
    expect(flows[0].originType).toBe("state");
    expect(flows[0].originId).toBe("A2");
    expect(flows[0].landedPrice).toBeCloseTo(90 + 1000 * FREIGHT_PRICE_TEU_PER_UNIT_HOP.bulk);
    expect(flows[0].units).toBeCloseTo(100);
  });

  it("prefer foreign when sea shipping is cheap enough, then tariffs flip it", () => {
    // freightPrice 100: UK landed 60+2.4=62.4 < A2 90+0.4=90.4.
    const cheapSea = makeInputs({
      freightPrice: 100,
      nationalPricesFor: () => ({ US: 95, UK: 60 }),
    });
    const cheap = coalFlow(runSourcingPass(cheapSea))[0];
    expect(cheap.originId).toBe("UK");
    expect(cheap.landedPrice).toBeCloseTo(
      60 + 100 * FREIGHT_PRICE_TEU_PER_UNIT_HOP.bulk * SEA_FREIGHT_HOP_EQUIV
    );

    // 60% tariff: UK 60×1.6 + 2.4 = 98.4 > A2's 90.4.
    const taxed = runSourcingPass(
      makeInputs({
        freightPrice: 100,
        nationalPricesFor: () => ({ US: 95, UK: 60 }),
        tariffRatePct: () => 60,
      })
    );
    const taxedFlows = coalFlow(taxed);
    expect(taxedFlows[0].originId).toBe("A2");
    expect(taxedFlows).toHaveLength(1);
    expect(taxed.summaries.find((s) => s.commodity === "coal")!.tariffPaid).toBe(0);
  });

  it("books tariff paid on import flows", () => {
    // freightPrice 100 + 10% tariff: UK landed 60 + 6 + 2.4 = 68.4 < 90.4.
    const r = runSourcingPass(
      makeInputs({
        freightPrice: 100,
        nationalPricesFor: () => ({ US: 95, UK: 60 }),
        tariffRatePct: () => 10,
      })
    );
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

  it("caps interstate shipping at the origin state's shared freight capacity", () => {
    // A2 freight supply 0.2, shared by every hauled cargo class.
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
    const nominal = freightSupply / FREIGHT_TEU_PER_UNIT_HOP.bulk;
    const shippable = nominal * (1 + FREIGHT_CONGESTION_OVERFLOW);
    const coal = r.summaries.find((s) => s.commodity === "coal")!;
    expect(coal.interStateUnits).toBeCloseTo(shippable);
    expect(coal.congestionUnits).toBeCloseTo(nominal * FREIGHT_CONGESTION_OVERFLOW);
    expect(coal.congestionSurchargePaid).toBeGreaterThan(0);
    expect(coal.capacityBoundUnits).toBeGreaterThan(0);
    expect(coal.unmetUnits).toBeCloseTo(100 - shippable);
    // Network load ledger records the consumption on the ORIGIN state.
    expect(r.freightTeuByState.get("A2")!.bulk).toBeCloseTo(
      freightSupply * (1 + FREIGHT_CONGESTION_OVERFLOW)
    );
  });

  it("lets special cargo use freight capacity that bulk cargo left idle", () => {
    const freightSupply = 10;
    const r = runSourcingPass(
      makeInputs({
        freightPrice: 100,
        byState: new Map([
          [
            "A1",
            new Map([["rare_earth", { supply: 0, demand: 1000 }]]) as Map<CommodityType, Balance>,
          ],
          [
            "A2",
            new Map([
              ["rare_earth", { supply: 1000, demand: 0 }],
              ["freight", { supply: freightSupply, demand: 0 }],
            ]) as Map<CommodityType, Balance>,
          ],
        ]),
        states: [
          { stateId: "A1", countryId: "US" as CountryId },
          { stateId: "A2", countryId: "US" as CountryId },
        ],
        byCountry: new Map([["US", new Map([["rare_earth", { supply: 1000, demand: 1000 }]])]]),
        // Normal haul is just inside tolerance; congested haul is outside it,
        // so this measures nominal fleet use without overflow muddying the cap.
        statePricesFor: () => ({ A1: 75.1, A2: 100 }),
      })
    );

    expect(r.freightTeuByState.get("A2")!.special).toBeCloseTo(freightSupply);
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
    // A2 at ask 90, shippingPerUnit = 1000 × 0.004 × 1 hop = 4.
    const r = runSourcingPass(makeInputs());
    const a1 = r.landedPremiumByDestState.get("A1")!.get("coal")!;
    expect(a1.metUnits).toBeCloseTo(100);
    expect(a1.extraCost).toBeCloseTo(100 * 4);
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
    // 60 units local (free) + 40 interstate at shippingPerUnit 4.
    expect(a1.metUnits).toBeCloseTo(100);
    expect(a1.extraCost).toBeCloseTo(40 * 4);
  });

  it("importAggregatesByCountry: sums import value and tariff paid by buyer country", () => {
    const r = runSourcingPass(
      makeInputs({
        freightPrice: 100,
        nationalPricesFor: () => ({ US: 95, UK: 60 }),
        tariffRatePct: () => 10,
      })
    );
    const usAgg = r.importAggregatesByCountry.get("US")!;
    expect(usAgg.importValue).toBeCloseTo(100 * 60);
    expect(usAgg.tariffPaid).toBeCloseTo(100 * 60 * 0.1);
  });

  it("importAggregatesByCountry: no entry for a buyer country with no import flows", () => {
    const r = runSourcingPass(makeInputs());
    expect(r.importAggregatesByCountry.has("US")).toBe(false);
  });

  it("unplacedSupplyByState: reports the spare no buyer anywhere took", () => {
    // A2 makes 200 coal, A1 wants 100 and takes all of it; nobody else buys.
    const r = runSourcingPass(makeInputs());
    const unplaced = r.unplacedSupplyByState.get("coal")!;
    expect(unplaced.get("A2")).toBeCloseTo(100);
    // A1 produced nothing, so it has nothing it failed to place. A state that
    // consumed its own output is likewise clean.
    expect(unplaced.get("A1")).toBeCloseTo(0);
  });

  it("unplacedSupplyByState: a seller walled off by capacity keeps its stock", () => {
    // A2 can only haul a sliver, so most of its 200 units stay put. This is the
    // t225 seam: the country book says the coal sold, the network says it never
    // moved.
    const r = runSourcingPass(
      makeInputs({
        byState: new Map([
          ["A1", new Map([["coal", { supply: 0, demand: 100 }]]) as Map<CommodityType, Balance>],
          [
            "A2",
            new Map([
              ["coal", { supply: 200, demand: 0 }],
              ["freight", { supply: 0.2, demand: 0 }],
            ]) as Map<CommodityType, Balance>,
          ],
        ]),
        states: [
          { stateId: "A1", countryId: "US" as CountryId },
          { stateId: "A2", countryId: "US" as CountryId },
        ],
        byCountry: new Map([["US", new Map([["coal", { supply: 200, demand: 100 }]])]]),
        statePricesFor: () => ({ A1: 200, A2: 90, B1: 80 }),
      })
    );
    const coal = r.summaries.find((s) => s.commodity === "coal")!;
    const unplaced = r.unplacedSupplyByState.get("coal")!.get("A2")!;
    // Everything the network could not move is unplaced, exactly.
    expect(unplaced).toBeCloseTo(200 - coal.interStateUnits);
    expect(unplaced).toBeGreaterThan(190);
  });

  it("deliveryLimitedSupplyByState: spare standing against unmet demand is a delivery failure", () => {
    // A2 can haul only a sliver of its 200 units, so A1 ends the pass still
    // short. Spare and unmet demand coexisting IS the seam: those goods were
    // wanted and could not get there.
    const r = runSourcingPass(
      makeInputs({
        byState: new Map([
          ["A1", new Map([["coal", { supply: 0, demand: 100 }]]) as Map<CommodityType, Balance>],
          [
            "A2",
            new Map([
              ["coal", { supply: 200, demand: 0 }],
              ["freight", { supply: 0.2, demand: 0 }],
            ]) as Map<CommodityType, Balance>,
          ],
        ]),
        states: [
          { stateId: "A1", countryId: "US" as CountryId },
          { stateId: "A2", countryId: "US" as CountryId },
        ],
        byCountry: new Map([["US", new Map([["coal", { supply: 200, demand: 100 }]])]]),
        statePricesFor: () => ({ A1: 200, A2: 90, B1: 80 }),
      })
    );
    const coal = r.summaries.find((s) => s.commodity === "coal")!;
    const deliveryLimited = r.deliveryLimitedSupplyByState.get("coal")!.get("A2")!;
    const unplaced = r.unplacedSupplyByState.get("coal")!.get("A2")!;
    // One seller state, so the uniform share resolves to min(spare, unmet).
    expect(deliveryLimited).toBeCloseTo(Math.min(unplaced, coal.unmetUnits));
    expect(deliveryLimited).toBeGreaterThan(0);
    // The rest of the spare had no buyer at all and is not blamed on freight.
    expect(deliveryLimited).toBeLessThan(unplaced);
  });

  it("deliveryLimitedSupplyByState: a pure glut is zero, even though placement falls", () => {
    // Every buyer is satisfied and A2 still holds 100 units. Nobody wanted
    // them, so no amount of freight would have helped and the player must not
    // be told otherwise.
    const r = runSourcingPass(makeInputs());
    const coal = r.summaries.find((s) => s.commodity === "coal")!;
    expect(coal.unmetUnits).toBe(0);
    expect(r.unplacedSupplyByState.get("coal")!.get("A2")).toBeCloseTo(100);
    expect(r.deliveryLimitedSupplyByState.get("coal")!.get("A2")).toBe(0);
  });

  it("deliveryLimitedSupplyByState: attributes only the spare somebody wanted", () => {
    // Tolerance locks every seller out, so nothing ships. A1 wants 100 and A2
    // holds 200: half of what A2 could not place was wanted by someone, the
    // other half was never wanted at all.
    const r = runSourcingPass(
      makeInputs({
        statePricesFor: () => ({ A1: 100, A2: 100 * (1 + BUYER_TOLERANCE_SLACK) + 50 }),
        nationalPricesFor: () => ({ UK: 100 * (1 + BUYER_TOLERANCE_SLACK) + 50 }),
      })
    );
    const unplaced = r.unplacedSupplyByState.get("coal")!.get("A2")!;
    expect(unplaced).toBeCloseTo(200);
    expect(r.deliveryLimitedSupplyByState.get("coal")!.get("A2")).toBeCloseTo(100);
  });

  it("deliveryLimitedSupplyByState: saturates at the spare on hand", () => {
    // Demand of 500 against 200 of unshippable spare. The share caps at 1: a
    // seller can only ever fail to deliver what it actually holds.
    const r = runSourcingPass(
      makeInputs({
        byState: new Map([
          ["A1", new Map([["coal", { supply: 0, demand: 500 }]]) as Map<CommodityType, Balance>],
          ["A2", new Map([["coal", { supply: 200, demand: 0 }]]) as Map<CommodityType, Balance>],
        ]),
        states: [
          { stateId: "A1", countryId: "US" as CountryId },
          { stateId: "A2", countryId: "US" as CountryId },
        ],
        byCountry: new Map([["US", new Map([["coal", { supply: 200, demand: 500 }]])]]),
        statePricesFor: () => ({ A1: 100, A2: 100 * (1 + BUYER_TOLERANCE_SLACK) + 50 }),
        nationalPricesFor: () => ({ UK: 100 * (1 + BUYER_TOLERANCE_SLACK) + 50 }),
      })
    );
    const unplaced = r.unplacedSupplyByState.get("coal")!.get("A2")!;
    expect(unplaced).toBeCloseTo(200);
    expect(r.deliveryLimitedSupplyByState.get("coal")!.get("A2")).toBeCloseTo(200);
  });

  it("unplacedSupplyByState: grid losses make the flow ledger unable to answer this", () => {
    // A2 dispatches more than A1 receives, so `flows` (delivered units) cannot
    // reconstruct what left the seller. The seller's own spare can.
    const r = runSourcingPass(
      makeInputs({
        byState: new Map([
          ["A1", new Map([["energy", { supply: 0, demand: 100 }]]) as Map<CommodityType, Balance>],
          ["A2", new Map([["energy", { supply: 500, demand: 0 }]]) as Map<CommodityType, Balance>],
        ]),
        states: [
          { stateId: "A1", countryId: "US" as CountryId },
          { stateId: "A2", countryId: "US" as CountryId },
        ],
        byCountry: new Map([["US", new Map([["energy", { supply: 500, demand: 100 }]])]]),
        statePricesFor: () => ({ A1: 100, A2: 90 }),
        nationalPricesFor: () => ({ US: 95 }),
      })
    );
    const dispatched = 100 / (1 - GRID_LOSS_PER_HOP);
    const delivered = r.flows
      .filter((f) => f.commodity === "energy")
      .reduce((s, f) => s + f.units, 0);
    expect(delivered).toBeCloseTo(100);
    expect(r.unplacedSupplyByState.get("energy")!.get("A2")).toBeCloseTo(500 - dispatched);
    // The difference is real: 500 - delivered would over-credit the seller.
    expect(r.unplacedSupplyByState.get("energy")!.get("A2")).toBeLessThan(500 - delivered);
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
