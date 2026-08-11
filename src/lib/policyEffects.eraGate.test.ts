import { describe, expect, it } from "vitest";
import { computeTickRates, type ActivePolicy, type LegislationTypeMap } from "./policyEffects";

// Minimal legType map: one policy option with an additive tick on a windowed metric.
const legTypeMap = new Map([
  [
    "x_broadband_law",
    {
      _id: "x_broadband_law",
      policyOptions: [
        {
          id: "opt0",
          effectDirection: 1,
          metricEffects: [
            { category: "infrastructure", metricId: "broadbandAccess", ratePerTurn: 0.05 },
          ],
        },
      ],
    },
  ],
]) as unknown as LegislationTypeMap;

const policies = [
  {
    legislationTypeId: "x_broadband_law",
    policyOptionId: "opt0",
    effectDirection: 1,
    scopeMultiplier: 1,
  },
] as unknown as ActivePolicy[];

describe("computeTickRates era gate", () => {
  it("drops the tick when broadband is pre-window for the country", () => {
    // broadbandAccess windows 1998; at 1990 the tick must be gated out.
    const rates = computeTickRates(policies, legTypeMap, "US", 1990);
    expect(rates.infrastructure?.broadbandAccess ?? 0).toBe(0);
  });
  it("keeps the tick post-window", () => {
    const rates = computeTickRates(policies, legTypeMap, "US", 2005);
    expect(rates.infrastructure?.broadbandAccess).toBeCloseTo(0.05);
  });
  it("keeps the tick when year is null (legacy)", () => {
    const rates = computeTickRates(policies, legTypeMap, "US", null);
    expect(rates.infrastructure?.broadbandAccess).toBeCloseTo(0.05);
  });
  it("keeps the tick when country/year omitted (legacy callers)", () => {
    const rates = computeTickRates(policies, legTypeMap);
    expect(rates.infrastructure?.broadbandAccess).toBeCloseTo(0.05);
  });
});
