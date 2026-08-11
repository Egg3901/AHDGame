import { describe, expect, it } from "vitest";
import { calculateMetricTarget } from "./policyEffects";
import type { StateMetricBaseline } from "@/lib/db/types/statePolicy";

// A baseline doc placing educationSpending at a realistic local-currency value.
const baselineDoc = {
  _id: "TST",
  baselines: { education: { educationSpending: 900_000 } },
} as unknown as StateMetricBaseline;

describe("policyEffects bounds — educationSpending ceiling (S1)", () => {
  it("preserves an above-100 educationSpending target (no [0,100] clamp)", () => {
    // With no active policies the target is the baseline; the default-[0,100]
    // clamp floored it to 100 before educationSpending got an explicit maxValue.
    const target = calculateMetricTarget(
      baselineDoc,
      "education",
      "educationSpending",
      [],
      new Map(),
      0
    );
    expect(target).toBeGreaterThan(100_000);
  });
});
