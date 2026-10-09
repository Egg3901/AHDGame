import { describe, expect, it } from "vitest";
import { cryptoRng, pickWeighted, rollInt } from "./rng";

describe("casino rng", () => {
  it("draws from the real cryptographic source in [0, 1)", () => {
    for (let i = 0; i < 1000; i++) {
      const u = cryptoRng();
      expect(u).toBeGreaterThanOrEqual(0);
      expect(u).toBeLessThan(1);
    }
  });

  it("rolls inclusive integer ranges and weighted picks", () => {
    expect(rollInt(() => 0, 1, 6)).toBe(1);
    expect(rollInt(() => 0.9999, 1, 6)).toBe(6);
    expect(
      pickWeighted(
        () => 0.5,
        [
          { value: "a", weight: 1 },
          { value: "b", weight: 3 },
        ]
      )
    ).toBe("b");
  });
});
