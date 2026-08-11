import { describe, it, expect } from "vitest";
import {
  deriveChairAlignment,
  oppositeAlignment,
  chairAlignmentPolicy,
  NEUTRAL_CHAIR_POLICY,
} from "./chairAlignment";
import {
  computeNppChairRateTarget,
  computeNppChairRateStep,
} from "@/lib/nppAutonomy/nppChairAutoRate";
import type { NPPPersonality } from "@/lib/db/types/npp";

function p(ambition: number, stubbornness: number): NPPPersonality {
  return { ambition, stubbornness, loyalty: 50 };
}

describe("chairAlignment helpers", () => {
  it("flips alignment", () => {
    expect(oppositeAlignment("hawk")).toBe("dove");
    expect(oppositeAlignment("dove")).toBe("hawk");
  });

  it("derives hawk for the stubborn, dove for the ambitious", () => {
    expect(deriveChairAlignment(p(20, 80))).toBe("hawk");
    expect(deriveChairAlignment(p(80, 20))).toBe("dove");
  });

  it("falls back to neutral policy for missing alignment", () => {
    expect(chairAlignmentPolicy(undefined)).toBe(NEUTRAL_CHAIR_POLICY);
    expect(chairAlignmentPolicy(null)).toBe(NEUTRAL_CHAIR_POLICY);
  });
});

describe("alignment biases the Taylor rule", () => {
  const base = { neutralRate: 4, inflationRate: 6, targetInflation: 2, gdpGrowth: 2 };

  it("a hawk targets a higher rate than a dove when inflation runs hot", () => {
    const hawk = computeNppChairRateTarget({ ...base, alignment: "hawk" });
    const dove = computeNppChairRateTarget({ ...base, alignment: "dove" });
    const neutral = computeNppChairRateTarget(base);
    expect(hawk).toBeGreaterThan(neutral);
    expect(dove).toBeLessThan(neutral);
  });

  it("omitting alignment preserves legacy (neutral) behavior", () => {
    expect(computeNppChairRateTarget(base)).toBeCloseTo(
      computeNppChairRateTarget({ ...base, alignment: null }),
      9
    );
  });

  it("a hawk hikes harder and cuts more gently than a dove", () => {
    // small gaps so the bias is visible before the clamp binds
    const hawkHike = computeNppChairRateStep({ currentRate: 2, targetRate: 3, alignment: "hawk" });
    const doveHike = computeNppChairRateStep({ currentRate: 2, targetRate: 3, alignment: "dove" });
    expect(hawkHike).toBeGreaterThan(doveHike);

    const hawkCut = computeNppChairRateStep({ currentRate: 4, targetRate: 3, alignment: "hawk" });
    const doveCut = computeNppChairRateStep({ currentRate: 4, targetRate: 3, alignment: "dove" });
    // cuts are negative; the dove cuts more aggressively (more negative)
    expect(doveCut).toBeLessThan(hawkCut);
  });

  it("keeps steps within the existing clamp bounds", () => {
    const bigHike = computeNppChairRateStep({ currentRate: 0, targetRate: 100, alignment: "hawk" });
    const bigCut = computeNppChairRateStep({ currentRate: 100, targetRate: 0, alignment: "dove" });
    expect(bigHike).toBeLessThanOrEqual(0.75);
    expect(bigCut).toBeGreaterThanOrEqual(-1.75);
  });
});
