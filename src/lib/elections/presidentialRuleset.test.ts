import { describe, expect, it } from "vitest";
import {
  CURRENT_PRESIDENTIAL_RULESET_VERSION,
  presidentialRulesetFor,
} from "./presidentialRuleset";
import {
  campaignStrengthVoteMultiplier,
  CAMPAIGN_STRENGTH_MAX_BONUS,
} from "@/lib/campaigns/campaignStrength";

describe("presidential ruleset seam (rules freeze)", () => {
  it("unstamped races resolve to v1: the rules they opened under", () => {
    expect(presidentialRulesetFor(undefined).version).toBe(1);
    expect(presidentialRulesetFor(null).version).toBe(1);
    expect(presidentialRulesetFor({}).version).toBe(1);
  });

  it("stamped races keep their stamped version", () => {
    expect(presidentialRulesetFor({ rulesetVersion: 1 }).version).toBe(1);
    expect(presidentialRulesetFor({ rulesetVersion: 2 }).version).toBe(2);
  });

  it("an unknown future stamp falls back to the newest known ruleset", () => {
    expect(presidentialRulesetFor({ rulesetVersion: 99 }).version).toBe(
      CURRENT_PRESIDENTIAL_RULESET_VERSION
    );
  });

  it("v2 is currently byte-identical to v1: the seam ships with zero behavior change", () => {
    const { version: v1v, ...v1 } = presidentialRulesetFor({ rulesetVersion: 1 });
    const { version: v2v, ...v2 } = presidentialRulesetFor({ rulesetVersion: 2 });
    expect(v1v).toBe(1);
    expect(v2v).toBe(2);
    expect(v2).toEqual(v1);
  });

  it("the strength multiplier honors a ruleset-supplied cap and defaults to the live constant", () => {
    const strength = 1_000_000; // deep in the asymptote
    expect(campaignStrengthVoteMultiplier(strength)).toBeCloseTo(
      1 + CAMPAIGN_STRENGTH_MAX_BONUS,
      3
    );
    expect(campaignStrengthVoteMultiplier(strength, 0.25)).toBeCloseTo(1.25, 3);
    expect(campaignStrengthVoteMultiplier(0, 0.25)).toBe(1);
  });
});
