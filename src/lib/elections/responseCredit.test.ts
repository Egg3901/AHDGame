import { describe, it, expect } from "vitest";
import { hasRealBudgetCost, hasKeptWorsening } from "./responseCredit";
import type { EnactedLaw } from "@/lib/db/types/budget";

const law = (fields: Partial<EnactedLaw>) => fields as EnactedLaw;

describe("credit gate (a): real budget cost", () => {
  it("rejects a law with no cost anywhere", () => {
    expect(hasRealBudgetCost(law({ budgetCost: 0 }), undefined)).toBe(false);
    expect(hasRealBudgetCost(undefined, undefined)).toBe(false);
  });

  it("rejects a trivial cost", () => {
    expect(hasRealBudgetCost(law({ budgetCost: 0.1 }), undefined)).toBe(false);
    expect(hasRealBudgetCost(law({ gdpCostFraction: 0.0001 }), undefined)).toBe(false);
  });

  it("accepts each of the real cost signals", () => {
    expect(hasRealBudgetCost(law({ budgetCost: 2 }), undefined)).toBe(true);
    expect(hasRealBudgetCost(law({ gdpCostFraction: 0.01 }), undefined)).toBe(true);
    expect(hasRealBudgetCost(law({ incomeCostFraction: 0.01 }), undefined)).toBe(true);
    expect(hasRealBudgetCost(law({ gdpPerCapitaMultiplier: 0.07 }), undefined)).toBe(true);
    expect(hasRealBudgetCost(law({ annualCostPerCapita: 250 }), undefined)).toBe(true);
    expect(hasRealBudgetCost(law({ costModelV2: { gdpCostFraction: 0.004 } }), undefined)).toBe(
      true
    );
  });

  it("falls back to the bill-side cost snapshot", () => {
    expect(hasRealBudgetCost(undefined, 5_000_000)).toBe(true);
    expect(hasRealBudgetCost(law({ budgetCost: 0 }), 5_000_000)).toBe(true);
    expect(hasRealBudgetCost(undefined, 0)).toBe(false);
  });
});

describe("credit gate (c): revocation on continued worsening", () => {
  // helpfulSign -1: the metric should be falling (unemployment, poverty).
  const falling = [
    { turn: 100, value: 10 },
    { turn: 108, value: 9 },
    { turn: 116, value: 8 },
  ];
  const rising = [
    { turn: 100, value: 10 },
    { turn: 108, value: 11 },
    { turn: 116, value: 12 },
  ];

  it("revokes when the metric kept moving the wrong way", () => {
    expect(hasKeptWorsening(rising, 100, -1)).toBe(true);
  });

  it("keeps credit when the metric improved", () => {
    expect(hasKeptWorsening(falling, 100, -1)).toBe(false);
  });

  it("inverts for metrics that should be rising", () => {
    expect(hasKeptWorsening(falling, 100, 1)).toBe(true);
    expect(hasKeptWorsening(rising, 100, 1)).toBe(false);
  });

  it("treats a flat metric as neither improving nor worsening", () => {
    const flat = [
      { turn: 100, value: 10 },
      { turn: 116, value: 10.01 },
    ];
    expect(hasKeptWorsening(flat, 100, -1)).toBe(false);
  });

  it("does not revoke when history is too short to judge", () => {
    expect(hasKeptWorsening(undefined, 100, -1)).toBe(false);
    expect(hasKeptWorsening([{ turn: 100, value: 10 }], 100, -1)).toBe(false);
    // Both points inside the revocation window: no span long enough to compare.
    expect(
      hasKeptWorsening(
        [
          { turn: 100, value: 10 },
          { turn: 104, value: 12 },
        ],
        100,
        -1
      )
    ).toBe(false);
  });

  it("ignores readings from before the response landed", () => {
    // Pre-enactment collapse, post-enactment recovery: no revocation.
    const history = [
      { turn: 80, value: 5 },
      { turn: 100, value: 12 },
      { turn: 116, value: 9 },
    ];
    expect(hasKeptWorsening(history, 100, -1)).toBe(false);
  });
});
