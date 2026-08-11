import { describe, expect, it } from "vitest";
import { calculateNppWhipSuccessChance, statecraftWhipBonus } from "./whipSuccess";

describe("statecraftWhipBonus", () => {
  it("is 0 at the neutral pivot and signed at the extremes", () => {
    expect(statecraftWhipBonus(5.5)).toBe(0);
    expect(statecraftWhipBonus(undefined)).toBe(0);
    expect(statecraftWhipBonus(10)).toBeGreaterThan(0);
    expect(statecraftWhipBonus(1)).toBeLessThan(0);
  });

  it("raises a whip's success chance when applied", () => {
    const npp = { personality: { loyalty: 50, ambition: 50, stubbornness: 50 } };
    const base = calculateNppWhipSuccessChance(npp, "hard");
    const boosted = calculateNppWhipSuccessChance(npp, "hard", statecraftWhipBonus(10));
    expect(boosted.finalChance).toBeGreaterThan(base.finalChance);
  });
});

describe("calculateNppWhipSuccessChance", () => {
  it("keeps hard whips meaningfully stronger than soft whips", () => {
    const npp = {
      personality: { loyalty: 50, ambition: 50, stubbornness: 50 },
    };

    const soft = calculateNppWhipSuccessChance(npp, "soft");
    const hard = calculateNppWhipSuccessChance(npp, "hard");

    expect(soft.finalChance).toBe(70);
    expect(hard.finalChance).toBe(79);
  });

  it("rewards loyalty and punishes stubbornness while staying generous", () => {
    const compliant = calculateNppWhipSuccessChance(
      {
        personality: { loyalty: 80, ambition: 50, stubbornness: 20 },
      },
      "hard"
    );
    const resistant = calculateNppWhipSuccessChance(
      {
        personality: { loyalty: 20, ambition: 50, stubbornness: 90 },
      },
      "hard"
    );

    expect(compliant.finalChance).toBeGreaterThanOrEqual(90);
    expect(resistant.finalChance).toBeGreaterThanOrEqual(40);
    expect(compliant.finalChance).toBeGreaterThan(resistant.finalChance);
  });
});
