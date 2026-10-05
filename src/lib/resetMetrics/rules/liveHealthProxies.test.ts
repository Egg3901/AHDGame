import { describe, expect, it } from "vitest";
import { liveHealthProxies } from "./liveHealthProxies";

const opening = {
  countryId: "US" as const,
  uninsuredPercent: 14,
  physicianRate: 300,
  preparedness: 60,
  openingPhysicianReference: 300,
  openingPreparednessReference: 60,
};

describe("live game-calibrated health proxies", () => {
  it("uses fixed opening references and preserves the eligibility ceiling", () => {
    expect(liveHealthProxies(opening)).toEqual({
      effectiveCoverage: 86,
      treatmentDelayIndex: 20,
    });
    const improved = liveHealthProxies({ ...opening, physicianRate: 360, preparedness: 72 });
    expect(improved?.effectiveCoverage).toBe(86);
    expect(improved?.treatmentDelayIndex).toBeLessThan(20);
  });

  it("models UK and Japan entitlement separately from provider reach", () => {
    expect(liveHealthProxies({ ...opening, countryId: "UK", uninsuredPercent: null })).toEqual({
      effectiveCoverage: 94,
      treatmentDelayIndex: 20,
    });
    expect(liveHealthProxies({ ...opening, countryId: "JP", uninsuredPercent: null })).toEqual({
      effectiveCoverage: 94,
      treatmentDelayIndex: 20,
    });
  });

  it("rejects invalid or missing inputs instead of inventing a healthy system", () => {
    expect(liveHealthProxies({ ...opening, uninsuredPercent: null })).toBeNull();
    expect(liveHealthProxies({ ...opening, physicianRate: 0 })).toBeNull();
    expect(liveHealthProxies({ ...opening, openingPreparednessReference: Number.NaN })).toBeNull();
  });
});
