import { describe, expect, it } from "vitest";
import { isStaggeredTurn, staggerPhase } from "./staggerPhase";

describe("staggerPhase", () => {
  const ids = Array.from({ length: 2400 }, (_, i) => `6ac3cb${i.toString(16).padStart(18, "0")}`);

  it("is stable and inside the period", () => {
    for (const id of ids.slice(0, 50)) {
      const phase = staggerPhase(id, 24);
      expect(phase).toBe(staggerPhase(id, 24));
      expect(phase).toBeGreaterThanOrEqual(0);
      expect(phase).toBeLessThan(24);
    }
  });

  it("spreads subjects close to evenly across the period", () => {
    const counts = new Array(24).fill(0);
    for (const id of ids) counts[staggerPhase(id, 24)]++;
    // 100 expected per slot; allow generous noise.
    for (const n of counts) expect(n).toBeGreaterThan(60);
  });

  it("gives every subject exactly one turn per period", () => {
    for (const id of ids.slice(0, 20)) {
      const turns = Array.from({ length: 24 }, (_, i) => 49 + i).filter((turn) =>
        isStaggeredTurn(id, turn, 24)
      );
      expect(turns).toHaveLength(1);
    }
    expect(isStaggeredTurn(ids[0], 0, 4)).toBe(false);
  });
});
