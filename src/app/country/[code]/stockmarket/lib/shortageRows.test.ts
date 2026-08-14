import { describe, it, expect } from "vitest";
import { buildShortageRows } from "./shortageRows";
import type { CommodityData } from "../types";

function make(partial: Partial<CommodityData>): CommodityData {
  return {
    commodity: "x",
    label: "X",
    icon: "",
    colors: "",
    unit: "tons",
    basePrice: 100,
    globalPrice: 100,
    globalSupply: 100,
    globalDemand: 100,
    exchangeSupply: 0,
    exchangeDemand: 0,
    priceChange: 0,
    turn: 1,
    ...partial,
  };
}

describe("buildShortageRows", () => {
  it("sorts most-short (highest D/S) first, unpriced last", () => {
    const rows = buildShortageRows([
      make({ commodity: "balanced", globalSupply: 100, globalDemand: 100 }),
      make({ commodity: "short", globalSupply: 100, globalDemand: 400 }),
      make({ commodity: "mild", globalSupply: 100, globalDemand: 130 }),
      make({ commodity: "surplus", globalSupply: 400, globalDemand: 100 }),
      make({ commodity: "unpriced", globalSupply: 0, globalDemand: 0, globalPrice: 250 }),
    ]);
    // unpriced has a premium (250 vs 100) so it is kept, but sinks to the bottom
    expect(rows.map((r) => r.commodity)).toEqual([
      "short",
      "mild",
      "balanced",
      "surplus",
      "unpriced",
    ]);
  });

  it("classifies tone by D/S thresholds", () => {
    const tone = (supply: number, demand: number) =>
      buildShortageRows([
        make({ commodity: "c", globalSupply: supply, globalDemand: demand, globalPrice: 150 }),
      ])[0].tone;
    expect(tone(100, 200)).toBe("short-strong"); // 2.0 >= 1.75
    expect(tone(100, 175)).toBe("short-strong"); // boundary 1.75
    expect(tone(100, 130)).toBe("short-mild"); // 1.3 >= 1.15
    expect(tone(100, 115)).toBe("short-mild"); // boundary 1.15
    expect(tone(100, 100)).toBe("balanced"); // 1.0
    expect(tone(100, 85)).toBe("oversupplied"); // boundary 0.85
    expect(tone(400, 100)).toBe("oversupplied"); // 0.25
  });

  it("treats demand with zero supply as a maximal shortage (#3032)", () => {
    // Demand but no supply at this scope (a state with factories, no local mine):
    // the most acute shortage. dsRatio has no finite value, so the noSupply flag
    // carries the signal — short-strong, full-intensity, never dropped.
    const [a] = buildShortageRows([
      make({ commodity: "a", globalSupply: 0, globalDemand: 100, globalPrice: 150 }),
    ]);
    expect(a.dsRatio).toBeNull();
    expect(a.noSupply).toBe(true);
    expect(a.tone).toBe("short-strong");
    expect(a.intensity).toBe(1);
  });

  it("returns null D/S with no shortage when demand is non-positive", () => {
    // Supply with zero demand is not a shortage (nobody wants it).
    const [b] = buildShortageRows([
      make({ commodity: "b", globalSupply: 100, globalDemand: 0, globalPrice: 150 }),
    ]);
    expect(b.dsRatio).toBeNull();
    expect(b.noSupply).toBe(false);
    expect(b.tone).toBe("balanced");
  });

  it("floats zero-supply shortages above finite-ratio shortages (#3032)", () => {
    const rows = buildShortageRows([
      make({ commodity: "veryShort", globalSupply: 100, globalDemand: 1000 }), // D/S 10
      make({ commodity: "noSupply", globalSupply: 0, globalDemand: 100, globalPrice: 100 }),
    ]);
    expect(rows.map((r) => r.commodity)).toEqual(["noSupply", "veryShort"]);
  });

  it("intensity saturates at a 4x imbalance and is 0 for null", () => {
    const at4x = buildShortageRows([
      make({ commodity: "c", globalSupply: 100, globalDemand: 400 }),
    ])[0];
    const beyond = buildShortageRows([
      make({ commodity: "c", globalSupply: 100, globalDemand: 1000 }),
    ])[0];
    const nullRow = buildShortageRows([
      make({ commodity: "c", globalSupply: 0, globalDemand: 0, globalPrice: 150 }),
    ])[0];
    expect(at4x.intensity).toBeCloseTo(1, 5);
    expect(beyond.intensity).toBe(1); // clamped
    expect(nullRow.intensity).toBe(0);
  });

  it("computes premium vs base and drops no-signal rows", () => {
    const rows = buildShortageRows([
      make({
        commodity: "premium",
        globalSupply: 100,
        globalDemand: 100,
        basePrice: 100,
        globalPrice: 137,
      }),
      make({
        commodity: "nosignal",
        globalSupply: 0,
        globalDemand: 0,
        basePrice: 100,
        globalPrice: 100,
      }),
    ]);
    // balanced D/S but a real premium -> kept; flat unpriced -> dropped
    expect(rows.map((r) => r.commodity)).toEqual(["premium"]);
    // Realized premium, not raw: clamp(1.37^0.5, 0.7, 1.5) - 1 = +17.05%, not +37%.
    expect(rows[0]!.premiumPct).toBeCloseTo(17.05, 1);
  });

  it("shows the REALIZED premium a supplier earns, not the raw price gap (#3034)", () => {
    // Engine scales revenue by clamp((price/base)^0.5, 0.7, 1.5).
    const realized = (globalPrice: number) =>
      buildShortageRows([make({ commodity: "c", globalPrice, basePrice: 100 })])[0]!.premiumPct;
    expect(realized(196)).toBeCloseTo(40, 1); // raw +96% -> realized +40%
    expect(realized(400)).toBeCloseTo(50, 5); // raw +300% -> clamped at +50%
    expect(realized(100)).toBeCloseTo(0, 5); // at base -> no premium
    expect(realized(25)).toBeCloseTo(-30, 5); // deep glut -> clamped at -30%
  });
});

describe("buildShortageRows scope lens", () => {
  it("country scope resolves from nationalSupply/nationalDemand/nationalPrices", () => {
    const c = make({
      commodity: "rare_earth",
      // global looks balanced, but the US is badly short
      globalSupply: 100,
      globalDemand: 100,
      globalPrice: 100,
      basePrice: 100,
      nationalSupply: { US: 50, DE: 200 },
      nationalDemand: { US: 200, DE: 100 },
      nationalPrices: { US: 180, DE: 90 },
    });
    const [us] = buildShortageRows([c], { level: "country", countryId: "US" });
    expect(us.dsRatio).toBeCloseTo(4, 5); // 200/50
    expect(us.tone).toBe("short-strong");
    expect(us.premiumPct).toBeCloseTo(34.16, 1); // realized: clamp(1.8^0.5,.7,1.5)-1
    const [de] = buildShortageRows([c], { level: "country", countryId: "DE" });
    expect(de.dsRatio).toBeCloseTo(0.5, 5); // 100/200
    expect(de.tone).toBe("oversupplied");
  });

  it("state scope resolves from stateSupply/stateDemand/statePrices", () => {
    const c = make({
      commodity: "oil",
      globalSupply: 100,
      globalDemand: 100,
      basePrice: 100,
      stateSupply: { TX: 100, CA: 100 },
      stateDemand: { TX: 130, CA: 100 },
      statePrices: { TX: 120, CA: 100 },
    });
    const [tx] = buildShortageRows([c], { level: "state", stateId: "TX" });
    expect(tx.dsRatio).toBeCloseTo(1.3, 5);
    expect(tx.tone).toBe("short-mild");
    expect(tx.premiumPct).toBeCloseTo(9.54, 1); // realized: clamp(1.2^0.5,.7,1.5)-1
  });

  it("missing scope data yields a null ratio (row sinks) and uses base price", () => {
    const short = make({
      commodity: "short",
      nationalSupply: { US: 50 },
      nationalDemand: { US: 200 },
      nationalPrices: { US: 150 },
    });
    // no national maps for this commodity at all -> no signal at country scope
    const empty = make({ commodity: "empty", globalPrice: 100, basePrice: 100 });
    const rows = buildShortageRows([empty, short], { level: "country", countryId: "US" });
    // `empty` has no US data and no premium (price == base) -> dropped entirely
    expect(rows.map((r) => r.commodity)).toEqual(["short"]);
    expect(rows[0]!.dsRatio).toBeCloseTo(4, 5);
  });

  it("defaults to global scope when no scope is passed", () => {
    const c = make({
      commodity: "c",
      globalSupply: 100,
      globalDemand: 400,
      nationalSupply: { US: 100 },
      nationalDemand: { US: 100 },
    });
    expect(buildShortageRows([c])[0]!.dsRatio).toBeCloseTo(4, 5); // global, not US
  });
});

describe("buildShortageRows reachable lens (ticket #1077)", () => {
  // The live turn-97 oil case: the world reads oversupplied, but the surplus is
  // Soviet oil the US is embargoed from, so the market a US seller faces is short.
  const oil = make({
    commodity: "oil",
    unit: "barrels",
    basePrice: 80,
    globalPrice: 80,
    globalSupply: 435_642,
    globalDemand: 357_532,
    nationalPrices: { US: 80 },
    reachableBooks: {
      US: {
        supply: 30_658,
        // Clearing demand is pinned to supply because imports fill the residual.
        demand: 30_658,
        domesticDemand: 55_804,
        imports: 25_146,
        exports: 0,
        blockedSupply: 164_002,
        untradedSupply: 0,
      },
    },
  });

  it("reads a shortage where the global lens reads a glut", () => {
    const [world] = buildShortageRows([oil], { level: "global" });
    expect(world.tone).toBe("oversupplied");

    const [us] = buildShortageRows([oil], { level: "reachable", countryId: "US" });
    expect(us.dsRatio).toBeCloseTo(1.82, 2);
    expect(us.tone).toBe("short-strong");
  });

  it("ranks on displaceable demand, not the import-pinned clearing book", () => {
    // The clearing book reads demand == supply for every net importer, which
    // would render this market exactly "balanced" and hide the opportunity.
    const [us] = buildShortageRows([oil], { level: "reachable", countryId: "US" });
    expect(us.demand).toBe(55_804);
    expect(us.tone).not.toBe("balanced");
  });

  it("discloses walled-off supply without folding it into the ratio", () => {
    const [us] = buildShortageRows([oil], { level: "reachable", countryId: "US" });
    expect(us.blockedSupply).toBe(164_002);
    expect(us.untradedSupply).toBe(0);
    // The excluded supply must not move supply, demand or the ratio.
    expect(us.supply).toBe(30_658);
    expect(us.dsRatio).toBeCloseTo(55_804 / 30_658, 6);
  });

  it("keeps a walled-off row visible even with no signal of its own", () => {
    // Nothing produced or demanded locally, but 5M units exist that this
    // country cannot touch. Silently dropping the row hides exactly the fact
    // the player needs.
    const walled = make({
      commodity: "steel",
      basePrice: 100,
      globalPrice: 100,
      reachableBooks: {
        US: {
          supply: 0,
          demand: 0,
          domesticDemand: 0,
          imports: 0,
          exports: 0,
          blockedSupply: 0,
          untradedSupply: 5_000_000,
        },
      },
    });
    const rows = buildShortageRows([walled], { level: "reachable", countryId: "US" });
    expect(rows).toHaveLength(1);
    expect(rows[0].untradedSupply).toBe(5_000_000);
  });

  it("drops a country with no book instead of inventing a market for it", () => {
    // No book, no local price, nothing walled off: there is genuinely nothing
    // to say, so the row is omitted rather than rendered as a dead 0/0 market.
    const rows = buildShortageRows(
      [make({ commodity: "food", basePrice: 100, globalPrice: 140 })],
      {
        level: "reachable",
        countryId: "ZZ",
      }
    );
    expect(rows).toHaveLength(0);
  });

  it("other scopes never report walled-off supply", () => {
    const [row] = buildShortageRows([oil], { level: "global" });
    expect(row.blockedSupply).toBe(0);
    expect(row.untradedSupply).toBe(0);
  });
});
