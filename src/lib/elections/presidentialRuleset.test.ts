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

  it("v2 is still fully identical to v1 (its seam shipped as pure infrastructure)", () => {
    const { version: v1v, ...v1 } = presidentialRulesetFor({ rulesetVersion: 1 });
    const { version: v2v, ...v2 } = presidentialRulesetFor({ rulesetVersion: 2 });
    expect([v1v, v2v]).toEqual([1, 2]);
    expect(v2).toEqual(v1);
  });

  it("v3 differs from v1 ONLY by the intended primaryCalendar flip; every other knob still matches", () => {
    // The calendar-rework subsystem flips exactly one v3 knob: primaryCalendar
    // -> "stretched" (structural, safe mid-race, 1964+ spawns only). This guard
    // pins that flip as intended while asserting EVERY OTHER v3 knob remains at
    // v1 identity -- so an accidental flip of an UNTOUCHED knob (momentum cap,
    // convention, transfers, surrogate weights) still fails the test.
    const v1 = presidentialRulesetFor({ rulesetVersion: 1 });
    const v3 = presidentialRulesetFor({ rulesetVersion: 3 });

    // The one intended divergence.
    expect(v1.primaryCalendar).toBe("compressed");
    expect(v3.primaryCalendar).toBe("stretched");

    // Everything else must still equal v1, knob by knob.
    const { version: _v1ver, primaryCalendar: _v1cal, ...v1Rest } = v1;
    const { version: _v3ver, primaryCalendar: _v3cal, ...v3Rest } = v3;
    expect(v3Rest).toEqual(v1Rest);
  });

  it("carries the momentum + nomination + surrogate knobs at identity values (only calendar flipped)", () => {
    const r = presidentialRulesetFor({ rulesetVersion: 3 });
    // primaryCalendar is intentionally "stretched" now (see the guard above);
    // the magnitude/structural knobs below are still at ship identity.
    expect(r.primaryMomentumCapPoints).toBe(0);
    expect(r.primaryMomentumDecay).toBe(0.5);
    expect(r.conventionEnabled).toBe(false);
    expect(r.suspendTransferMode).toBe("flat");
    expect(r.suspendTransferMaxFraction).toBe(0.25);
    expect(r.endorsementOrgFraction).toBe(0);
    expect(r.endorsementCoalitionCredibility).toBe(0);
    expect(r.vpSurrogateActionCap).toBe(2);
    expect(r.vpTravelPresenceWeight).toBe(1);
  });

  it("the running-mate surrogate knobs are identical across v1, v2, and v3", () => {
    // The surrogate mechanic wires to these knobs but ships at identity in this
    // PR: magnitude tuning happens later (t384). Pin cross-version equality so a
    // stray tuning edit to one version is caught.
    const v1 = presidentialRulesetFor({ rulesetVersion: 1 });
    const v2 = presidentialRulesetFor({ rulesetVersion: 2 });
    const v3 = presidentialRulesetFor({ rulesetVersion: 3 });
    expect(v1.vpSurrogateActionCap).toBe(2);
    expect(v2.vpSurrogateActionCap).toBe(2);
    expect(v3.vpSurrogateActionCap).toBe(2);
    expect(v1.vpTravelPresenceWeight).toBe(1);
    expect(v2.vpTravelPresenceWeight).toBe(1);
    expect(v3.vpTravelPresenceWeight).toBe(1);
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
