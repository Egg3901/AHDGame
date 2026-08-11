import { describe, it, expect } from "vitest";
import { applyFog } from "./fogOfWar";

describe("applyFog", () => {
  it("applies variance within range", () => {
    const results = new Set<number>();

    // Run 100 times to get distribution
    for (let i = 0; i < 100; i++) {
      const foggy = applyFog(5, 3, 10);
      results.add(foggy);

      // Should be within ±3
      expect(foggy).toBeGreaterThanOrEqual(2);
      expect(foggy).toBeLessThanOrEqual(8);
    }

    // Should have some variety (at least 3 different values)
    expect(results.size).toBeGreaterThan(2);
  });

  it("clamps negative results to 0", () => {
    for (let i = 0; i < 100; i++) {
      const foggy = applyFog(1, 3, 5);
      expect(foggy).toBeGreaterThanOrEqual(0);
    }
  });

  it("clamps values that would exceed the category max", () => {
    // Actual level 5 with ±3 variance could land at 8, but max is 5
    for (let i = 0; i < 100; i++) {
      const foggy = applyFog(5, 3, 5);
      expect(foggy).toBeLessThanOrEqual(5);
      expect(foggy).toBeGreaterThanOrEqual(2);
    }
  });

  it("handles zero variance (exact value)", () => {
    expect(applyFog(10, 0, 10)).toBe(10);
  });
});
