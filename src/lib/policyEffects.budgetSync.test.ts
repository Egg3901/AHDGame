import { describe, expect, it } from "vitest";
import { computeTickRates } from "./policyEffects";
import type { ActivePolicy, LegislationTypeMap } from "./policyEffects";
import type { LegislationType } from "@/lib/db/types/legislation";

/**
 * Budget-sync chokepoint: budgetBalance / debtToGdp / schuldenbremseHeadroom are
 * COMPUTED metrics — a pure readout of the real treasury, owned by the budget
 * mirror (metricEngine). The policy layer must never write to them; a law moves
 * the budget only by changing its real tax/spending channel, which the mirror
 * reads. So computeTickRates (which feeds both per-turn application AND the
 * effect tooltips) must ignore any metricEffect on a mirror-controlled metric.
 */
describe("policyEffects budget-sync chokepoint", () => {
  it("computeTickRates ignores metricEffects on mirror-controlled fiscal metrics", () => {
    const legType = {
      _id: "x",
      policyOptions: [
        {
          id: "opt1",
          metricEffects: [
            { category: "governance", metricId: "budgetBalance", ratePerTurn: -0.5 },
            { category: "governance", metricId: "debtToGdp", ratePerTurn: 0.4 },
            { category: "governance", metricId: "schuldenbremseHeadroom", ratePerTurn: -0.2 },
            { category: "economic", metricId: "gdpGrowth", ratePerTurn: 0.3 },
          ],
        },
      ],
    } as unknown as LegislationType;
    const legMap: LegislationTypeMap = new Map([["x", legType]]);
    const policies = [
      { legislationTypeId: "x", policyOptionId: "opt1", scopeMultiplier: 1 },
    ] as unknown as ActivePolicy[];

    const rates = computeTickRates(policies, legMap);

    // Non-fiscal effect flows through unchanged.
    expect(rates.economic?.gdpGrowth).toBe(0.3);
    // The three computed fiscal metrics are skipped entirely.
    expect(rates.governance?.budgetBalance).toBeUndefined();
    expect(rates.governance?.debtToGdp).toBeUndefined();
    expect(rates.governance?.schuldenbremseHeadroom).toBeUndefined();
  });
});
