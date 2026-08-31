import { describe, expect, it } from "vitest";

import { isSeasonRecapEnabled } from "./featureFlag";

describe("isSeasonRecapEnabled", () => {
  it("is fail-closed: only an explicit true enables the recap", () => {
    expect(isSeasonRecapEnabled({ seasonRecapEnabled: true })).toBe(true);
    expect(isSeasonRecapEnabled({ seasonRecapEnabled: false })).toBe(false);
    expect(isSeasonRecapEnabled({})).toBe(false);
    expect(isSeasonRecapEnabled({ seasonRecapEnabled: null })).toBe(false);
  });

  it("treats a missing gameState as disabled rather than throwing", () => {
    // resetGameWorld / maintenance / client-nav all pass a findOne result
    // straight in, which is null when the singleton is absent.
    expect(isSeasonRecapEnabled(null)).toBe(false);
    expect(isSeasonRecapEnabled(undefined)).toBe(false);
    expect(isSeasonRecapEnabled()).toBe(false);
  });

  it("returns a boolean, not a promise", () => {
    // The predicate is sync on purpose: an async gate read bare in an `if`
    // is always truthy, which would silently enable the recap everywhere.
    expect(typeof isSeasonRecapEnabled({ seasonRecapEnabled: false })).toBe("boolean");
  });
});
