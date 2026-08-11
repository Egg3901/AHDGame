import { describe, expect, it } from "vitest";
import { ENGINE_BOUND, ENGINE_PATHS_BY_FAMILY, ENGINE_WEIGHT, engineTermFor } from "./engineTerm";
import { ADAPTER_TIER1 } from "@/lib/politicalLegislation/marginAdapter";

// `education.universalSchooling` is fed by literacyRate + educationSpending, so
// it exercises the many-to-one averaging as well as the sign.
const LITERATE = { "education.literacyRate": 99 };
const ILLITERATE = { "education.literacyRate": 55 };

describe("ENGINE_PATHS_BY_FAMILY", () => {
  it("is the exact inverse of ADAPTER_TIER1 — no path gained or lost", () => {
    // A hand-maintained second copy would drift; this asserts the derivation.
    const flattened = Object.entries(ENGINE_PATHS_BY_FAMILY).flatMap(([family, paths]) =>
      paths.map((p) => [p, family] as const)
    );
    expect(flattened).toHaveLength(Object.keys(ADAPTER_TIER1).length);
    for (const [path, family] of flattened) {
      expect(ADAPTER_TIER1[path]).toBe(family);
    }
  });

  it("keeps every legacy path that shares a family, not just the last one", () => {
    // The invert loop pushes; an assignment would silently keep one path per
    // family and quietly drop most of the engine's signal.
    const shared = Object.entries(ENGINE_PATHS_BY_FAMILY).filter(([, p]) => p.length > 1);
    expect(shared.length).toBeGreaterThan(0);
  });
});

describe("engineTermFor", () => {
  it("is zero for a family no engine path maps onto", () => {
    // Defense families are hand-authored (tier 4) — no ADAPTER_TIER1 rows.
    expect(engineTermFor("defense.armedForces", 50, LITERATE, "US")).toBe(0);
  });

  it("is zero when the engine produced nothing for this family", () => {
    expect(engineTermFor("education.universalSchooling", 50, {}, "US")).toBe(0);
    // A family whose only supplied path is unrelated is equally silent.
    expect(engineTermFor("education.universalSchooling", 50, { "order.safety": 70 }, "US")).toBe(0);
  });

  it("is POSITIVE when the engine's outcome beats the law-implied target", () => {
    expect(engineTermFor("education.universalSchooling", 20, LITERATE, "US")).toBeGreaterThan(0);
  });

  it("is NEGATIVE when the engine's outcome trails the law target", () => {
    // The point of the channel: defunding schools must drag the board DOWN even
    // while the law book still claims universal schooling.
    expect(engineTermFor("education.universalSchooling", 90, ILLITERATE, "US")).toBeLessThan(0);
  });

  it("never exceeds the bound in either direction", () => {
    expect(engineTermFor("education.universalSchooling", 0, LITERATE, "US")).toBeLessThanOrEqual(
      ENGINE_BOUND
    );
    expect(
      engineTermFor("education.universalSchooling", 100, ILLITERATE, "US")
    ).toBeGreaterThanOrEqual(-ENGINE_BOUND);
  });

  it("weights the gap rather than passing it through whole", () => {
    // Bisect for the target where the term vanishes rather than assuming where
    // the score lands: the clamp makes any fixed probe point fragile, and the
    // term is monotonically decreasing in lawTarget, so this converges.
    const term = (t: number) => engineTermFor("education.universalSchooling", t, ILLITERATE, "US");
    let lo = 0;
    let hi = 100;
    for (let i = 0; i < 60; i++) {
      const mid = (lo + hi) / 2;
      if (term(mid) > 0) lo = mid;
      else hi = mid;
    }
    const crossing = (lo + hi) / 2;
    expect(term(crossing)).toBeCloseTo(0, 6);
    // Just off the crossing the clamp is inactive, so the WEIGHT is what shows.
    expect(term(crossing - 4)).toBeCloseTo(4 * ENGINE_WEIGHT, 6);
    expect(term(crossing + 4)).toBeCloseTo(-4 * ENGINE_WEIGHT, 6);
  });

  it("averages the family's paths instead of letting one dominate", () => {
    const oneGood = engineTermFor(
      "education.universalSchooling",
      50,
      { "education.literacyRate": 99 },
      "US"
    );
    const oneGoodOneBad = engineTermFor(
      "education.universalSchooling",
      50,
      { "education.literacyRate": 99, "education.educationSpending": 0 },
      "US"
    );
    // Adding a bad sibling must pull the term down; if the map kept only one
    // path per family, or the loop overwrote instead of averaging, these match.
    expect(oneGoodOneBad).toBeLessThan(oneGood);
  });

  it("ignores non-finite node output rather than poisoning the average", () => {
    const clean = engineTermFor("education.universalSchooling", 50, LITERATE, "US");
    const dirty = engineTermFor(
      "education.universalSchooling",
      50,
      { ...LITERATE, "education.educationSpending": Number.NaN },
      "US"
    );
    expect(dirty).toBe(clean);
  });
});
