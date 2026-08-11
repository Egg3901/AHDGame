import { describe, it, expect } from "vitest";
import { enemyBand } from "./forecastFog";

describe("enemyBand", () => {
  it("buckets the enemy:own strength ratio", () => {
    expect(enemyBand(1000, 400)).toBe("Token resistance"); // 0.4
    expect(enemyBand(1000, 700)).toBe("Weaker force"); // 0.7
    expect(enemyBand(1000, 1000)).toBe("Evenly matched"); // 1.0
    expect(enemyBand(1000, 1500)).toBe("Stronger force"); // 1.5
    expect(enemyBand(1000, 5000)).toBe("Overwhelming force"); // 5.0
  });

  it("is inclusive at the Evenly-matched and Stronger boundaries", () => {
    expect(enemyBand(1000, 1200)).toBe("Evenly matched"); // r == 1.2
    expect(enemyBand(1000, 2000)).toBe("Stronger force"); // r == 2.0
  });

  it("reports an undefended front distinctly", () => {
    expect(enemyBand(1000, 0, { unopposed: true })).toBe("No forces detected");
  });

  it("never divides by zero", () => {
    expect(enemyBand(0, 0)).toBe("Token resistance");
  });
});
