import { describe, expect, it } from "vitest";
import {
  NPP_DECISION_CONSTRAINT_LEG,
  NPP_DECISION_CONSTRAINT_PRECEDENCE,
  aggregateNppOperatorObservations,
  buildNppOperatorObservation,
  resolveNppDecisionConstraint,
  type NppDecisionConstraint,
  type NppDecisionLeg,
} from "./rules";

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
      bindingConstraint: null,
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
    expect(report.constraintCounts).toEqual({});
    expect(report.budgetBandCounts).toEqual({ healthy: 1, thin: 1 });
    expect(report.dividendPolicyCounts).toEqual({ paying: 1, withheld: 1 });
    expect(report.divestedSectors).toBe(1);
    expect(report.reinvestments).toBe(2);
    expect(report.marginPctSum).toBe(26);
    expect(report.cashHeadroomAnchorSum).toBe(60);
  });
});

describe("NPP decision-leg constraint funnel", () => {
  it("resolves the FIRST rejecting leg in precedence order", () => {
    // A corp can trip several legs in one turn; the earliest in precedence wins.
    expect(
      resolveNppDecisionConstraint({
        dividend_margin_below_min: true,
        budget_unprofitable: true,
        divest_core_protected: true,
      })
    ).toBe("divest_core_protected");
    expect(
      resolveNppDecisionConstraint({
        dividend_cash_floor: true,
        budget_thin_margin: true,
        growth_unaffordable: true,
      })
    ).toBe("growth_unaffordable");
  });

  it("orders a blocking divest above every downstream leg", () => {
    const flags: Partial<Record<NppDecisionConstraint, boolean>> = {
      divest_core_protected: true,
      divest_no_other_income: true,
      divested: true,
    };
    expect(resolveNppDecisionConstraint(flags)).toBe("divest_core_protected");
  });

  it("orders the blocked shed above a completed shed", () => {
    expect(resolveNppDecisionConstraint({ divest_no_other_income: true, divested: true })).toBe(
      "divest_no_other_income"
    );
    expect(resolveNppDecisionConstraint({ divested: true })).toBe("divested");
  });

  it("returns null when no leg bound — the corp is free to reinvest", () => {
    expect(resolveNppDecisionConstraint({})).toBeNull();
    expect(
      resolveNppDecisionConstraint({
        divest_core_protected: false,
        dividend_cash_floor: false,
      })
    ).toBeNull();
  });

  it("carries the resolved constraint onto the observation and the aggregate", () => {
    const observation = buildNppOperatorObservation({
      passive: false,
      profitable: true,
      marginPct: 30,
      cashCrisis: false,
      entryReason: "no_enterable_market",
      dividendRate: 0,
      divestedSectors: 0,
      reinvestments: 0,
      cashHeadroomAnchor: 100,
      constraintFlags: { budget_thin_margin: true, dividend_cash_floor: true },
    });
    expect(observation.bindingConstraint).toBe("budget_thin_margin");

    const report = aggregateNppOperatorObservations([observation]);
    expect(report.constraintCounts).toEqual({ budget_thin_margin: 1 });
  });

  it("keeps the precedence list and the leg map in lockstep and exhaustive", () => {
    const precedence = new Set<string>(NPP_DECISION_CONSTRAINT_PRECEDENCE);
    // Every gate in the map is reachable through the precedence list...
    for (const gate of Object.keys(NPP_DECISION_CONSTRAINT_LEG) as NppDecisionConstraint[]) {
      expect(precedence.has(gate)).toBe(true);
    }
    // ...and the precedence list carries no gate outside the map.
    for (const gate of NPP_DECISION_CONSTRAINT_PRECEDENCE) {
      expect(NPP_DECISION_CONSTRAINT_LEG[gate]).toBeDefined();
    }
    // Precedence is grouped by leg in the brain's evaluation order.
    const legOrder: NppDecisionLeg[] = NPP_DECISION_CONSTRAINT_PRECEDENCE.map(
      (gate) => NPP_DECISION_CONSTRAINT_LEG[gate]
    );
    const firstIndex = (leg: NppDecisionLeg) => legOrder.indexOf(leg);
    expect(firstIndex("divest")).toBeLessThan(firstIndex("growth"));
    expect(firstIndex("growth")).toBeLessThan(firstIndex("budget"));
    expect(firstIndex("budget")).toBeLessThan(firstIndex("dividend"));
  });
});
