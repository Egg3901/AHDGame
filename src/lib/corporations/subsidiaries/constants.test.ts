import { describe, it, expect } from "vitest";
import {
  SPIN_OFF_BASE_COST_ANCHOR,
  SPIN_OFF_PER_SECTOR_COST_ANCHOR,
  spinOffCostAnchor,
} from "./constants";

describe("spinOffCostAnchor", () => {
  it("charges the base cost plus a per-sector fee for each sector moved", () => {
    expect(spinOffCostAnchor(1)).toBe(SPIN_OFF_BASE_COST_ANCHOR + SPIN_OFF_PER_SECTOR_COST_ANCHOR);
    expect(spinOffCostAnchor(3)).toBe(
      SPIN_OFF_BASE_COST_ANCHOR + 3 * SPIN_OFF_PER_SECTOR_COST_ANCHOR
    );
  });

  it("falls back to the base cost when no sectors are moved", () => {
    expect(spinOffCostAnchor(0)).toBe(SPIN_OFF_BASE_COST_ANCHOR);
  });

  it("never subtracts for a negative count", () => {
    expect(spinOffCostAnchor(-5)).toBe(SPIN_OFF_BASE_COST_ANCHOR);
  });
});
