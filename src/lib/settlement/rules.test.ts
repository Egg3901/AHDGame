import { describe, expect, it } from "vitest";
import {
  DRIFT_K_PCT,
  DRIFT_NOISE_SPAN,
  HUNDREDTHS,
  SETTLEMENT_DEFAULT_RULES,
  SETTLEMENT_RULE_KEYS,
  driftBandLabel,
  settlementRulesFor,
} from "@/lib/constants/settlementCrisis";

/**
 * The three switches come from the source design's "Rules" section, which
 * declares them and never consumes them. Two default ON, which is why they live
 * on the crisis document rather than in the feature-gates panel — that panel
 * reads every boolean `=== true`, so a missing field there means "off" and
 * would invert both.
 */
describe("settlementRulesFor", () => {
  it("carries the source design's defaults for a crisis with no rules block", () => {
    expect(settlementRulesFor({})).toEqual({
      openLog: true,
      driftRevealed: false,
      escalationEnabled: true,
    });
  });

  it("treats an explicitly null block as absent", () => {
    expect(settlementRulesFor({ rules: null })).toEqual(SETTLEMENT_DEFAULT_RULES);
  });

  it("falls back PER KEY, so a partial admin write keeps the other two", () => {
    // An admin `$set` of one switch writes one field. Merging wholesale would
    // silently reset the other two to their defaults.
    expect(settlementRulesFor({ rules: { escalationEnabled: false } })).toEqual({
      openLog: true,
      driftRevealed: false,
      escalationEnabled: false,
    });
  });

  it("honours an explicit false on a switch that defaults true", () => {
    expect(settlementRulesFor({ rules: { openLog: false } }).openLog).toBe(false);
  });

  it("honours an explicit true on a switch that defaults false", () => {
    expect(settlementRulesFor({ rules: { driftRevealed: true } }).driftRevealed).toBe(true);
  });

  it("lists exactly the keys the defaults define, so the admin route cannot drift", () => {
    expect([...SETTLEMENT_RULE_KEYS].sort()).toEqual(Object.keys(SETTLEMENT_DEFAULT_RULES).sort());
  });
});

describe("driftBandLabel", () => {
  it("quotes the real band, not a copy of it", () => {
    const label = driftBandLabel();
    expect(label).toContain((DRIFT_NOISE_SPAN / HUNDREDTHS).toFixed(1));
    expect(label).toContain((DRIFT_K_PCT / 100).toFixed(2));
  });
});
