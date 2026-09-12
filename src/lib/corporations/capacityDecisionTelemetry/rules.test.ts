import { describe, expect, it } from "vitest";
import { aggregateCapacityDecisions, capacityDecisionBucketKey } from "./rules";

describe("capacity decision telemetry rules", () => {
  it("uses only non-identifying dimensions in the bucket key", () => {
    expect(capacityDecisionBucketKey({ actor: "player", stage: "order", outcome: "placed" })).toBe(
      "player:order:placed"
    );
  });

  it("aggregates quote inputs without retaining an actor or corporation id", () => {
    const result = aggregateCapacityDecisions([
      {
        actor: "player",
        stage: "quote",
        outcome: "quoted",
        marketSharePct: 70,
        competitorCount: 2,
        rawDominanceMultiplier: 1.5,
        dominanceDensityFactor: 0.75,
        dominanceMultiplier: 1.375,
        unitPriceAnchor: 12,
        cashHeadroomAnchor: 900,
        requestedUnits: 10,
      },
      {
        actor: "player",
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
      },
    ]);

    expect(result["player:quote:quoted"]).toEqual({
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
});
