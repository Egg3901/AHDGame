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
    expect(presidentialRulesetFor({ rulesetVersion: 3 }).version).toBe(3);
  });

  it("an unknown future stamp falls back to the newest known ruleset", () => {
    expect(presidentialRulesetFor({ rulesetVersion: 99 }).version).toBe(
      CURRENT_PRESIDENTIAL_RULESET_VERSION
    );
  });

  it("CURRENT is v3 (the presidential-rework version)", () => {
    expect(CURRENT_PRESIDENTIAL_RULESET_VERSION).toBe(3);
  });

  it("v1, v2, and v3 are all behaviorally identical at ship (rules-freeze guarantee)", () => {
    // The rework seam and its full knob set land as pure infrastructure: a
    // 1964 race spawned under v3 must behave exactly like the live 1960 race
    // until a subsystem PR flips an individual v3 knob. This test is the guard
    // against a knob being flipped without intent -- if it fails, a v3 default
    // diverged from identity and the change must be deliberate.
    const { version: v1v, ...v1 } = presidentialRulesetFor({ rulesetVersion: 1 });
    const { version: v2v, ...v2 } = presidentialRulesetFor({ rulesetVersion: 2 });
    const { version: v3v, ...v3 } = presidentialRulesetFor({ rulesetVersion: 3 });
    expect([v1v, v2v, v3v]).toEqual([1, 2, 3]);
    expect(v2).toEqual(v1);
    expect(v3).toEqual(v1);
  });

  it("carries the full rework knob set at identity values", () => {
    const r = presidentialRulesetFor({ rulesetVersion: 3 });
    expect(r.primaryCalendar).toBe("compressed");
    expect(r.primaryMomentumCapPoints).toBe(0);
    expect(r.conventionEnabled).toBe(false);
    expect(r.suspendTransferMode).toBe("flat");
    expect(r.suspendTransferMaxFraction).toBe(0.25);
    expect(r.endorsementOrgFraction).toBe(0);
    expect(r.endorsementCoalitionCredibility).toBe(0);
    expect(r.vpSurrogateActionCap).toBe(2);
    expect(r.vpTravelPresenceWeight).toBe(1);
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
