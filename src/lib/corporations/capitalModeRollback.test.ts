import { describe, it, expect } from "vitest";
import {
  CAPITAL_MODE_ROLLBACK_UNSET_FIELDS,
  restoreCapitalModeFromShadow,
  summarizeCapitalModeRollback,
} from "./capitalModeRollback";

describe("restoreCapitalModeFromShadow", () => {
  it("reverts revenue to the shadow", () => {
    const { mutation, skipReason } = restoreCapitalModeFromShadow({
      revenue: 1_450_000, // plants-derived, drifted
      legacyRevenueShadow: 1_200_000, // what capital mode would have written
    });
    expect(skipReason).toBeNull();
    expect(mutation?.set).toEqual({ revenue: 1_200_000 });
  });

  it("clears the shadow and every plants-only field, but never capitalStock", () => {
    const { mutation } = restoreCapitalModeFromShadow({ revenue: 5, legacyRevenueShadow: 9 });
    expect(mutation?.unset).toEqual(CAPITAL_MODE_ROLLBACK_UNSET_FIELDS);
    expect(mutation?.unset).toContain("legacyRevenueShadow");
    expect(mutation?.unset).toContain("buildQueue");
    expect(mutation?.unset).toContain("constructionInProgressAnchor");
    // capitalStock is capital mode's own field — clearing it would erase the
    // capacity the rollback is returning to.
    expect(mutation?.unset).not.toContain("capitalStock");
  });

  it("skips a sector with no restore point rather than guessing", () => {
    const r = restoreCapitalModeFromShadow({ revenue: 1_000_000 });
    expect(r.mutation).toBeNull();
    expect(r.skipReason).toBe("no-shadow");
  });

  it("treats a corrupt shadow as absent", () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, -1]) {
      expect(
        restoreCapitalModeFromShadow({ revenue: 1, legacyRevenueShadow: bad }).skipReason
      ).toBe("no-shadow");
    }
  });

  it("is a no-op when revenue already equals the shadow (e.g. the flip turn)", () => {
    const r = restoreCapitalModeFromShadow({ revenue: 800_000, legacyRevenueShadow: 800_000 });
    expect(r.mutation).toBeNull();
    expect(r.skipReason).toBe("already-equal");
  });

  it("is idempotent: applying the mutation makes the second run a no-op", () => {
    const doc: { revenue: number; legacyRevenueShadow?: number } = {
      revenue: 1_450_000,
      legacyRevenueShadow: 1_200_000,
    };
    const first = restoreCapitalModeFromShadow(doc);
    expect(first.mutation).not.toBeNull();
    // Apply: set revenue, unset the shadow (what the script does).
    doc.revenue = first.mutation!.set.revenue;
    delete doc.legacyRevenueShadow;
    expect(restoreCapitalModeFromShadow(doc).mutation).toBeNull();
  });

  it("summarizes a batch by outcome", () => {
    expect(
      summarizeCapitalModeRollback([
        { revenue: 10, legacyRevenueShadow: 5 },
        { revenue: 10, legacyRevenueShadow: 10 },
        { revenue: 10 },
        { revenue: 20, legacyRevenueShadow: 7 },
      ])
    ).toEqual({ scanned: 4, restored: 2, noShadow: 1, alreadyEqual: 1 });
  });
});
