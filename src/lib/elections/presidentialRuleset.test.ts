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

  it("v3 differs from v1 ONLY by its three intended structural flips; every other knob still matches", () => {
    // Two subsystems have landed their structural v3 flips: the calendar rework
    // (primaryCalendar -> "stretched") and the nomination rework
    // (conventionEnabled -> true, suspendTransferMode -> "affinity"). All three
    // are structural (which path a race takes, not magnitude), safe mid-race,
    // 1964+ spawns only. This guard pins those three as intended while asserting
    // EVERY OTHER v3 knob remains at v1 identity -- so an accidental flip of an
    // UNTOUCHED knob (momentum cap, transfer/endorsement magnitudes, surrogate
    // weights) still fails the test.
    const v1 = presidentialRulesetFor({ rulesetVersion: 1 });
    const v3 = presidentialRulesetFor({ rulesetVersion: 3 });

    // The three intended divergences.
    expect(v1.primaryCalendar).toBe("compressed");
    expect(v3.primaryCalendar).toBe("stretched");
    expect(v1.conventionEnabled).toBe(false);
    expect(v3.conventionEnabled).toBe(true);
    expect(v1.suspendTransferMode).toBe("flat");
    expect(v3.suspendTransferMode).toBe("affinity");

    // Everything else must still equal v1, knob by knob -- crucially the
    // magnitude knobs the nomination rework deliberately left at identity.
    const {
      version: _v1ver,
      primaryCalendar: _v1cal,
      conventionEnabled: _v1conv,
      suspendTransferMode: _v1mode,
      ...v1Rest
    } = v1;
    const {
      version: _v3ver,
      primaryCalendar: _v3cal,
      conventionEnabled: _v3conv,
      suspendTransferMode: _v3mode,
      ...v3Rest
    } = v3;
    expect(v3Rest).toEqual(v1Rest);
  });

  it("carries the nomination magnitude + momentum + surrogate knobs at identity values", () => {
    const r = presidentialRulesetFor({ rulesetVersion: 3 });
    // The structural knobs are intentionally flipped (see the guard above); the
    // magnitude knobs below are still at ship identity until calibrated at t384.
    expect(r.primaryMomentumCapPoints).toBe(0);
    expect(r.primaryMomentumDecay).toBe(0.5);
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
