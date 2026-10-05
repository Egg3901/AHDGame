import { describe, expect, it } from "vitest";
import { nationalForceReadiness } from "./forceReadiness";

describe("national force readiness", () => {
  it("weights by seeded force power and includes supply, integrity, and forming units", () => {
    expect(
      nationalForceReadiness(
        [
          { basePower: 3, readiness: 80, integrity: 100, supply: 50 },
          { basePower: 1, readiness: 100, readyAtTurn: 2 },
        ],
        1
      )
    ).toBe(30);
    expect(
      nationalForceReadiness(
        [
          { basePower: 3, readiness: 80, integrity: 100, supply: 50 },
          { basePower: 1, readiness: 100, readyAtTurn: 2 },
        ],
        2
      )
    ).toBe(55);
  });

  it("does not manufacture readiness for a country with no force", () => {
    expect(nationalForceReadiness([], 1)).toBeNull();
    expect(() => nationalForceReadiness([{ basePower: 0, readiness: 80 }], 1)).toThrow();
    expect(() => nationalForceReadiness([{ basePower: 1, readiness: 101 }], 1)).toThrow();
  });
});
