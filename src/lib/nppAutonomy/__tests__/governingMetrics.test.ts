import { describe, it, expect } from "vitest";
import { domainHealthFromMetrics } from "../governingMetrics";

describe("domainHealthFromMetrics (pure)", () => {
  it("maps national metrics to domain health, supporting {value} and raw shapes", () => {
    const health = domainHealthFromMetrics({
      economic: { gdpGrowth: { value: 55 }, povertyRate: 30 },
      healthcare: { healthcareAccess: 70 },
    });
    expect(health.economic_growth).toBe(55);
    expect(health.poverty).toBe(30);
    expect(health.healthcare).toBe(70);
  });

  it("takes the worst (min) metric when several map to one domain", () => {
    const health = domainHealthFromMetrics({
      healthcare: { healthcareAccess: 70, lifeExpectancy: 40, infantMortality: 90 },
    });
    expect(health.healthcare).toBe(40); // weakest metric defines the domain
  });

  it("ignores non-numeric / unmapped values and tolerates an empty doc", () => {
    expect(domainHealthFromMetrics(null)).toEqual({});
    expect(domainHealthFromMetrics({ economic: { gdpGrowth: "n/a" } })).toEqual({});
  });
});
