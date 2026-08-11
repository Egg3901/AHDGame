import { describe, expect, it } from "vitest";
import { LEGISLATION_COST_CLASS, COST_CLASS_OVERRIDES } from "./legislationCostCatalog";
import { legislationTypes } from "@/lib/seeds/reference/legislationTypes";

const byId = new Map(legislationTypes.map((t) => [t._id, t]));

describe("cost class catalog — coverage", () => {
  it("every seed type has a cost class (key-set equality)", () => {
    const seedIds = legislationTypes.map((t) => t._id).sort();
    const classIds = Object.keys(LEGISLATION_COST_CLASS)
      .filter((k) => !k.startsWith("x_") && !k.startsWith("eraB_")) // strip test-seeded ids
      .sort();
    expect(classIds).toEqual(seedIds);
  });

  it("every value is a valid CostClass", () => {
    for (const [id, v] of Object.entries(LEGISLATION_COST_CLASS)) {
      expect(["gdpFraction", "perCapita", "none"], id).toContain(v);
    }
  });

  it("tax-rate types are classed none (revenue-side, not a spending line)", () => {
    for (const t of legislationTypes) {
      const isTax = (t.policyOptions ?? []).some(
        (o) => (o as { rate?: number }).rate !== undefined
      );
      if (isTax) expect(LEGISLATION_COST_CLASS[t._id], t._id).toBe("none");
    }
  });

  it("every override id is a real seed type", () => {
    for (const id of Object.keys(COST_CLASS_OVERRIDES)) expect(byId.has(id), id).toBe(true);
  });

  it("materialized option fields match each type's class", () => {
    for (const t of legislationTypes) {
      const cls = LEGISLATION_COST_CLASS[t._id];
      for (const o of t.policyOptions ?? []) {
        const opt = o as { gdpCostFraction?: number; incomeCostFraction?: number };
        if (cls === "gdpFraction") expect(opt.incomeCostFraction, t._id).toBeUndefined();
        if (cls === "perCapita") expect(opt.gdpCostFraction, t._id).toBeUndefined();
        if (cls === "none") {
          expect(opt.gdpCostFraction, t._id).toBeUndefined();
          expect(opt.incomeCostFraction, t._id).toBeUndefined();
        }
      }
    }
  });

  it("every gdpFraction/perCapita type has at least one option with a positive fraction", () => {
    for (const t of legislationTypes) {
      const cls = LEGISLATION_COST_CLASS[t._id];
      if (cls !== "gdpFraction" && cls !== "perCapita") continue;
      if (!(t.policyOptions ?? []).length) continue;
      const anyPositive = (t.policyOptions ?? []).some((o) => {
        const opt = o as { gdpCostFraction?: number; incomeCostFraction?: number };
        return (opt.gdpCostFraction ?? 0) > 0 || (opt.incomeCostFraction ?? 0) > 0;
      });
      expect(anyPositive, t._id).toBe(true);
    }
  });
});
