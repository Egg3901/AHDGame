import { describe, expect, it } from "vitest";
import { aggregateNppOperatorObservations, buildNppOperatorObservation } from "./rules";

describe("NPP operator telemetry", () => {
  it("publishes the cash floor as the first binding gate while retaining policy outcomes", () => {
    const observation = buildNppOperatorObservation({
      passive: false,
      profitable: true,
      marginPct: 32,
      cashCrisis: true,
      entryReason: "cash_floor",
      dividendRate: 0,
      divestedSectors: 1,
      reinvestments: 0,
      cashHeadroomAnchor: -25,
    });

    expect(observation).toEqual({
      bindingGate: "cash_floor",
      budgetBand: "distress",
      dividendPolicy: "withheld",
      dividendRate: 0,
      divestedSectors: 1,
      reinvestments: 0,
      marginPct: 32,
      cashHeadroomAnchor: -25,
    });
  });

  it("uses net profitability before margin and entry gates", () => {
    expect(
      buildNppOperatorObservation({
        passive: false,
        profitable: false,
        marginPct: 20,
        cashCrisis: false,
        entryReason: "margin_below_floor",
        dividendRate: 0,
        divestedSectors: 0,
        reinvestments: 0,
        cashHeadroomAnchor: 100,
      }).bindingGate
    ).toBe("unprofitable");
  });

  it("aggregates a closed gate and policy vocabulary without corporation identifiers", () => {
    const observations = [
      buildNppOperatorObservation({
        passive: false,
        profitable: true,
        marginPct: 18,
        cashCrisis: false,
        entryReason: "entered",
        dividendRate: 3,
        divestedSectors: 0,
        reinvestments: 2,
        cashHeadroomAnchor: 50,
      }),
      buildNppOperatorObservation({
        passive: false,
        profitable: true,
        marginPct: 8,
        cashCrisis: false,
        entryReason: "margin_below_floor",
        dividendRate: 0,
        divestedSectors: 1,
        reinvestments: 0,
        cashHeadroomAnchor: 10,
      }),
    ];

    const report = aggregateNppOperatorObservations(observations);
    expect(report.corporationsObserved).toBe(2);
    expect(report.bindingGateCounts).toEqual({ entered: 1, margin_below_floor: 1 });
    expect(report.budgetBandCounts).toEqual({ healthy: 1, thin: 1 });
    expect(report.dividendPolicyCounts).toEqual({ paying: 1, withheld: 1 });
    expect(report.divestedSectors).toBe(1);
    expect(report.reinvestments).toBe(2);
    expect(report.marginPctSum).toBe(26);
    expect(report.cashHeadroomAnchorSum).toBe(60);
  });
});
