import { describe, it, expect } from "vitest";
import { METRIC_AXIS_AFFINITY, axisAffinityFor } from "./metricAxisAffinity";

describe("metric axis affinity (P6d)", () => {
  it("all affinities are within [-1, 1]", () => {
    for (const [id, a] of Object.entries(METRIC_AXIS_AFFINITY)) {
      expect(Math.abs(a.econ), `${id}.econ`).toBeLessThanOrEqual(1);
      expect(Math.abs(a.social), `${id}.social`).toBeLessThanOrEqual(1);
    }
  });

  it("economic-right metrics lean econ +1", () => {
    for (const id of [
      "gdpGrowth",
      "economicFreedom",
      "regulatoryBurden",
      "debtToGdp",
      "firearmRights",
    ]) {
      expect(axisAffinityFor(id), id).toEqual({ econ: 1, social: 0 });
    }
  });

  it("economic-left metrics lean econ -1", () => {
    for (const id of ["povertyRate", "childPoverty", "incomeInequality", "unemploymentRate"]) {
      expect(axisAffinityFor(id), id).toEqual({ econ: -1, social: 0 });
    }
  });

  it("authoritarian-social metrics lean social +1", () => {
    // crimeRate carries the order/safety signal; stateMediaControl and
    // incarcerationRate are lower-is-better libertarian goods (moved to -1 in
    // #2897 — they were mis-signed +1, punishing an auth-right governor's base).
    for (const id of ["nationalPride", "militaryReadiness", "crimeRate", "borderSecurity"]) {
      expect(axisAffinityFor(id), id).toEqual({ econ: 0, social: 1 });
    }
  });

  it("libertarian-social metrics lean social -1", () => {
    for (const id of ["civilLiberties", "pressFreedom", "stateMediaControl", "incarcerationRate"]) {
      expect(axisAffinityFor(id), id).toEqual({ econ: 0, social: -1 });
    }
  });

  it("universal goods (unlisted) are neutral {0,0}", () => {
    for (const id of ["testPerformance", "lifeExpectancy", "roadCondition", "literacyRate"]) {
      expect(axisAffinityFor(id), id).toEqual({ econ: 0, social: 0 });
    }
  });
});
