import { describe, it, expect } from "vitest";
import { buildActiveBillFilter } from "../context";

/**
 * The fetch filter is the gate upstream of the whole NPP voting loop, so its shape is
 * asserted directly rather than through the context builder.
 */
describe("active_both bill fetch", () => {
  const branchFor = (currentTurn?: number) => {
    const filter = buildActiveBillFilter({ currentTurn, now: new Date() }) as {
      $or: Record<string, unknown>[];
    };
    const branch = filter.$or.find((b) => b.status === "active_both");
    expect(branch, "no active_both branch in the fetch filter").toBeTruthy();
    return branch as Record<string, unknown>;
  };

  it("ORs the two deadline pairs on the turn-keyed branch", () => {
    const branch = branchFor(100);
    // Nested $or of two clauses -- NOT two spreads (the second $or key would overwrite
    // the first) and NOT a spread of their .$or arrays (undefined on the date-only
    // branch, which throws).
    expect(Array.isArray(branch.$or)).toBe(true);
    expect((branch.$or as unknown[]).length).toBe(2);
  });

  it("still produces a usable branch with no currentTurn", () => {
    // stillOpen returns a FLAT object here, so a `.$or` spread would have thrown.
    const branch = branchFor(undefined);
    expect(Array.isArray(branch.$or)).toBe(true);
    expect((branch.$or as unknown[]).length).toBe(2);
  });

  it("leaves the four pre-existing branches untouched", () => {
    const filter = buildActiveBillFilter({ currentTurn: 100, now: new Date() }) as {
      $or: Record<string, unknown>[];
    };
    const statuses = filter.$or.map((b) => b.status);
    expect(statuses).toEqual([
      "active",
      "active_other",
      "veto_override",
      "override_shugiin",
      "active_both",
    ]);
  });
});
