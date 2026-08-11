import { describe, expect, it } from "vitest";
import { calculateShiftImpacts } from "@/lib/archetypeAffinities";
import { legislationTypes } from "@/lib/seeds/reference/legislationTypes";

/**
 * Regression: archetype-approval shift direction must follow the curated per-option
 * position scores (economic+social), NOT the raw array index. Tax brackets are authored
 * right→left (index 0 = 0% / most market-friendly), so an index-based shift runs opposite
 * the affinity convention and flips every sign (the "libertarians approve a 50% income
 * tax" bug). Passing optionScores corrects it; non-tax left→right sets are unchanged in sign.
 */

function scoresFor(typeId: string): number[] {
  const lt = legislationTypes.find((t) => t._id === typeId)!;
  return (lt.policyOptions ?? []).map((o) => (o.economic ?? 0) + (o.social ?? 0));
}

describe("calculateShiftImpacts — score-based direction (tax, right→left ordered)", () => {
  const scores = scoresFor("us_federal_income_tax_rate"); // index 0 = 0% (right) … 10 = 50% (left)

  it("proposing a 50% top rate (far-left) is read as a LEFTWARD shift", () => {
    // current 25% (index 5, center) → proposed 50% (index 10, far-left).
    const impacts = calculateShiftImpacts("tax", 5, 10, undefined, scores);
    // Anti-tax archetypes DISAPPROVE; pro-redistribution archetypes APPROVE.
    expect(impacts.libertarians).toBeLessThan(0);
    expect(impacts.small_business).toBeLessThan(0);
    expect(impacts.rural_traditionalists).toBeLessThan(0);
    expect(impacts.public_sector).toBeGreaterThan(0);
    expect(impacts.union_trades).toBeGreaterThan(0);
    expect(impacts.college_liberals).toBeGreaterThan(0);
  });

  it("documents the OLD index-based bug (flipped) when scores are omitted", () => {
    const buggy = calculateShiftImpacts("tax", 5, 10); // legacy index path
    expect(buggy.libertarians).toBeGreaterThan(0); // wrong: "approve" a 50% tax
    expect(buggy.public_sector).toBeLessThan(0); // wrong: "oppose" funding government
  });
});

describe("calculateShiftImpacts — non-tax left→right sets keep their sign", () => {
  it("minimum wage (index 0 = left) yields the same signs with or without scores", () => {
    const scores = scoresFor("us_minimum_wage"); // index 0 = $25 living wage (left)
    // current center (index 3) → proposed $25 (index 0, far-left).
    const withScores = calculateShiftImpacts("economic", 3, 0, undefined, scores);
    const legacy = calculateShiftImpacts("economic", 3, 0);
    // The fix must never FLIP a left→right-ordered type's sign (magnitude/rounding-to-zero
    // differences are fine; an opposite non-zero sign is not).
    const keys = new Set([...Object.keys(withScores), ...Object.keys(legacy)]);
    for (const k of keys) {
      const a = withScores[k] ?? 0;
      const b = legacy[k] ?? 0;
      if (a !== 0 && b !== 0) {
        expect(Math.sign(a), `flipped sign for ${k}`).toBe(Math.sign(b));
      }
    }
    // And the direction is sane: a big minimum-wage hike pleases unions, not small business.
    expect(withScores.union_trades).toBeGreaterThan(0);
    expect(withScores.small_business).toBeLessThan(0);
  });
});
