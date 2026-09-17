import { describe, expect, it } from "vitest";
import {
  FOUNDING_GATE_PRECEDENCE,
  REINVEST_GATE_PRECEDENCE,
  aggregateCapacityDecisions,
  capacityDecisionBucketKey,
  firstRejectingGate,
  summarizeCapacityDecisionBuckets,
  type CapacityDecisionObservation,
} from "./rules";

function observation(
  overrides: Partial<CapacityDecisionObservation> = {}
): CapacityDecisionObservation {
  return {
    actor: "player",
    cohort: "player-managed",
    stage: "order",
    outcome: "placed",
    marketSharePct: 70,
    competitorCount: 2,
    rawDominanceMultiplier: 1.5,
    dominanceDensityFactor: 0.75,
    dominanceMultiplier: 1.375,
    unitPriceAnchor: 12,
    cashHeadroomAnchor: 900,
    requestedUnits: 10,
    ...overrides,
  };
}

describe("capacity decision telemetry rules", () => {
  it("keys buckets by actor, cohort, stage, and outcome — never an id", () => {
    expect(
      capacityDecisionBucketKey({
        actor: "player",
        cohort: "player-managed",
        stage: "order",
        outcome: "placed",
      })
    ).toBe("player:player-managed:order:placed");
    expect(
      capacityDecisionBucketKey({
        actor: "npp",
        cohort: "npp-managed",
        stage: "order",
        outcome: "insufficient_cash",
      })
    ).toBe("npp:npp-managed:order:insufficient_cash");
  });

  it("aggregates quote inputs without retaining an actor or corporation id", () => {
    const result = aggregateCapacityDecisions([
      observation({ stage: "quote", outcome: "quoted" }),
      observation({
        stage: "quote",
        outcome: "quoted",
        marketSharePct: 50,
        competitorCount: 4,
        rawDominanceMultiplier: 1,
        dominanceDensityFactor: 1,
        dominanceMultiplier: 1,
        unitPriceAnchor: 8,
        cashHeadroomAnchor: -100,
        requestedUnits: 20,
      }),
    ]);

    expect(result["player:player-managed:quote:quoted"]).toEqual({
      observations: 2,
      marketSharePctSum: 120,
      competitorCountSum: 6,
      rawDominanceMultiplierSum: 2.5,
      dominanceDensityFactorSum: 1.75,
      dominanceMultiplierSum: 2.375,
      unitPriceAnchorSum: 20,
      cashHeadroomAnchorSum: 800,
      requestedUnitsSum: 30,
    });
  });

  it("splits player and NPP paths into separate buckets", () => {
    const result = aggregateCapacityDecisions([
      observation({ actor: "player", cohort: "player-managed" }),
      observation({ actor: "npp", cohort: "npp-managed", outcome: "mothballed" }),
    ]);
    expect(Object.keys(result).sort()).toEqual([
      "npp:npp-managed:order:mothballed",
      "player:player-managed:order:placed",
    ]);
  });

  it("summarizes denominators and per-bucket shares", () => {
    const buckets = aggregateCapacityDecisions([
      observation({ outcome: "placed" }),
      observation({ outcome: "placed" }),
      observation({ outcome: "insufficient_cash", requestedUnits: 5 }),
    ]);
    const summary = summarizeCapacityDecisionBuckets(buckets);
    expect(summary.denominators).toEqual({ observations: 3, requestedUnits: 25 });
    expect(summary.buckets["player:player-managed:order:placed"]?.observationShare).toBeCloseTo(
      2 / 3,
      10
    );
    expect(
      summary.buckets["player:player-managed:order:insufficient_cash"]?.observationShare
    ).toBeCloseTo(1 / 3, 10);
  });

  it("summarizes an empty funnel as zero denominators and no buckets", () => {
    expect(summarizeCapacityDecisionBuckets({})).toEqual({
      denominators: { observations: 0, requestedUnits: 0 },
      buckets: {},
    });
  });

  it("selects the first founding gate in precedence order", () => {
    // Cash would also reject, but profitability is evaluated first.
    expect(
      firstRejectingGate(FOUNDING_GATE_PRECEDENCE, {
        unprofitable: true,
        insufficient_cash: true,
      })
    ).toBe("unprofitable");
    // Affordability outranks nothing below it; the deferral wins over cash.
    expect(
      firstRejectingGate(FOUNDING_GATE_PRECEDENCE, {
        credit_requested: true,
        insufficient_cash: true,
      })
    ).toBe("credit_requested");
    // A candidate that passes every gate proceeds (null = placed).
    expect(
      firstRejectingGate(FOUNDING_GATE_PRECEDENCE, {
        strategy_disallowed: false,
        unprofitable: false,
      })
    ).toBeNull();
    expect(firstRejectingGate(FOUNDING_GATE_PRECEDENCE, {})).toBeNull();
  });

  it("selects the first reinvestment gate in precedence order", () => {
    // Demand evidence is evaluated before the state-controlled exclusion.
    expect(
      firstRejectingGate(REINVEST_GATE_PRECEDENCE, {
        fill_below_min: true,
        state_controlled: true,
      })
    ).toBe("fill_below_min");
    // Sizing runs before affordability.
    expect(
      firstRejectingGate(REINVEST_GATE_PRECEDENCE, {
        below_minimum_order: true,
        insufficient_cash: true,
      })
    ).toBe("below_minimum_order");
    expect(firstRejectingGate(REINVEST_GATE_PRECEDENCE, {})).toBeNull();
  });
});
