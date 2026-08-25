import { describe, expect, it } from "vitest";
import {
  applyEndorsementOrgBoosts,
  endorsementCredibilityMultiplier,
} from "./endorsementActivation";

describe("endorsementActivation", () => {
  describe("applyEndorsementOrgBoosts", () => {
    const makeMap = () =>
      new Map<string, Map<string, number>>([
        [
          "PA",
          new Map([
            ["endorser", 80],
            ["endorsed", 20],
          ]),
        ],
      ]);

    it("is an exact no-op at fraction 0 (identity) — no keys created", () => {
      const stateOrg = new Map<string, Map<string, number>>([["PA", new Map([["endorser", 80]])]]);
      applyEndorsementOrgBoosts(
        stateOrg,
        [{ endorserCandidateId: "endorser", endorsedCandidateId: "endorsed" }],
        0
      );
      expect(stateOrg.get("PA")?.get("endorser")).toBe(80);
      // The endorsed candidate had no key and must not have been created.
      expect(stateOrg.get("PA")?.has("endorsed")).toBe(false);
    });

    it("is a no-op with no links", () => {
      const stateOrg = makeMap();
      applyEndorsementOrgBoosts(stateOrg, [], 0.25);
      expect(stateOrg.get("PA")?.get("endorsed")).toBe(20);
    });

    it("adds floor(endorserOrg * fraction) to the endorsee when fraction > 0", () => {
      const stateOrg = makeMap();
      applyEndorsementOrgBoosts(
        stateOrg,
        [{ endorserCandidateId: "endorser", endorsedCandidateId: "endorsed" }],
        0.25
      );
      // 80 * 0.25 = 20 added to the endorsee; endorser is not debited.
      expect(stateOrg.get("PA")?.get("endorsed")).toBe(40);
      expect(stateOrg.get("PA")?.get("endorser")).toBe(80);
    });
  });

  describe("endorsementCredibilityMultiplier", () => {
    it("returns exactly 1 at credibility 0 (identity)", () => {
      expect(endorsementCredibilityMultiplier(0, 0)).toBe(1);
      expect(endorsementCredibilityMultiplier(5, 0)).toBe(1);
    });

    it("returns 1 for a candidate holding no endorsements", () => {
      expect(endorsementCredibilityMultiplier(0, 0.02)).toBe(1);
    });

    it("grows with the endorsement count when credibility is positive", () => {
      expect(endorsementCredibilityMultiplier(3, 0.02)).toBeCloseTo(1.06, 6);
    });
  });
});
