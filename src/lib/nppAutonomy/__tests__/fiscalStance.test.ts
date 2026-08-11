import { describe, it, expect } from "vitest";
import { computeFiscalStance } from "../fiscalStance";
import type { GoverningAgendaItem } from "../governingAgenda";

const reformer = { ambition: 80, stubbornness: 20, loyalty: 50 }; // high spend appetite
const steward = { ambition: 20, stubbornness: 80, loyalty: 50 }; // frugal

const growthAgenda: GoverningAgendaItem[] = [
  { domain: "economic_growth", target: 65, direction: "raise", priority: 1 },
  { domain: "employment", target: 65, direction: "raise", priority: 0.8 },
];

describe("computeFiscalStance", () => {
  it("goes austere under hot inflation and high debt", () => {
    const s = computeFiscalStance({
      agenda: [],
      inflationRate: 9,
      debtToGdpRatio: 1.6,
      personality: steward,
      currentTurn: 10,
    });
    expect(s.stance).toBe("austere");
    expect(s.direction).toBe(1); // tighten
    expect(s.intensity).toBeGreaterThan(0);
  });

  it("goes expansionary when growth/employment goals dominate and macro is calm", () => {
    const s = computeFiscalStance({
      agenda: growthAgenda,
      inflationRate: 1.5,
      debtToGdpRatio: 0.5,
      personality: reformer,
      currentTurn: 10,
    });
    expect(s.stance).toBe("expansionary");
    expect(s.direction).toBe(-1); // loosen / spend
  });

  it("stays neutral in the quiet middle", () => {
    // debtToGdpRatio 0.5 sits comfortably inside the AAA band (debt.ts:
    // getDebtThreshold's 0-0.6 tier carries zero rating penalty) - genuinely
    // calm, unlike the old test's 0.9 (already the A tier, which now
    // correctly registers as real (if mild) distress; see the
    // DEBT_DISTRESS_WEIGHT recalibration in fiscalStance.ts).
    const s = computeFiscalStance({
      agenda: [{ domain: "healthcare", target: 65, direction: "raise", priority: 0.2 }],
      inflationRate: 2.5,
      debtToGdpRatio: 0.5,
      personality: { ambition: 40, stubbornness: 40, loyalty: 50 }, // technocrat, appetite 1.0
      currentTurn: 10,
    });
    expect(s.stance).toBe("neutral");
    expect(s.direction).toBe(0);
  });

  it("80-100% debt/GDP (credit-rating A tier) now registers as real distress - the old flat DEBT_HIGH=1.0 line let this pass as calm", () => {
    const calm = computeFiscalStance({
      agenda: [],
      inflationRate: 2.0,
      debtToGdpRatio: 0.5,
      personality: { ambition: 40, stubbornness: 40, loyalty: 50 },
      currentTurn: 10,
    });
    const distressed = computeFiscalStance({
      agenda: [],
      inflationRate: 2.0,
      debtToGdpRatio: 0.9, // A tier: gdpPenalty 0.1 (debt.ts)
      personality: { ambition: 40, stubbornness: 40, loyalty: 50 },
      currentTurn: 10,
    });
    expect(calm.stance).toBe("neutral");
    expect(distressed.stance).not.toBe("expansionary");
  });

  it("a country's own high target inflation (YU-shaped, 15%) is not itself a crisis; a real overshoot above ITS OWN target still is", () => {
    const atOwnTarget = computeFiscalStance({
      agenda: [],
      inflationRate: 15,
      targetInflationRate: 15,
      debtToGdpRatio: 0,
      personality: { ambition: 40, stubbornness: 40, loyalty: 50 },
      currentTurn: 10,
    });
    const overshootingOwnTarget = computeFiscalStance({
      agenda: [],
      inflationRate: 25,
      targetInflationRate: 15,
      debtToGdpRatio: 0,
      personality: { ambition: 40, stubbornness: 40, loyalty: 50 },
      currentTurn: 10,
    });
    expect(atOwnTarget.stance).toBe("neutral");
    expect(overshootingOwnTarget.stance).toBe("austere");
  });
});
