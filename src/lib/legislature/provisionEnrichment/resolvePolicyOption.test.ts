import { describe, it, expect } from "vitest";
import type { LegislationType } from "@/lib/db/types";
import { resolveProvisionPolicyOption } from "./resolvePolicyOption";

const lt = {
  _id: "x",
  policyOptions: [
    { id: "a", name: "A", effectDirection: -1, economic: -2, social: 0 },
    { id: "b", name: "B", effectDirection: 0, economic: 0, social: 0 },
    { id: "c", name: "C", effectDirection: 1, economic: 2, social: 0 },
  ],
} as unknown as LegislationType;

describe("resolveProvisionPolicyOption", () => {
  it("matches on exact policyOptionId and reports its index", () => {
    expect(resolveProvisionPolicyOption(lt, { policyOptionId: "c", effectDirection: 1 })).toEqual({
      option: lt.policyOptions![2],
      index: 2,
    });
  });

  it("falls back to an explicit economic/social axis match", () => {
    expect(
      resolveProvisionPolicyOption(lt, { effectDirection: 0, economic: -2, social: 0 })
    ).toEqual({ option: lt.policyOptions![0], index: 0 });
  });

  it("treats the other axis as 0 when only one axis is explicit", () => {
    // Legacy provisions stamped a literal 0; new ones omit the field. Both must
    // land on the same option.
    expect(resolveProvisionPolicyOption(lt, { effectDirection: 0, economic: 0 })).toEqual({
      option: lt.policyOptions![1],
      index: 1,
    });
  });

  it("skips the axis match entirely when the provision carries no axes", () => {
    // Without this guard a directional provision with no economic/social would
    // collapse onto the 0/0 option — the centre of the ladder — instead of the
    // directional one. The two pre-merge copies disagreed here: billEnrichment
    // guarded, billProposal did not. The guarded behaviour is correct.
    expect(resolveProvisionPolicyOption(lt, { effectDirection: 1 })).toEqual({
      option: lt.policyOptions![2],
      index: 2,
    });
  });

  it("matches on direction only when exactly one option has that direction", () => {
    const single = {
      _id: "y",
      policyOptions: [
        { id: "p", name: "P", effectDirection: 1, economic: 3, social: 1 },
        { id: "q", name: "Q", effectDirection: -1, economic: -3, social: -1 },
      ],
    } as unknown as LegislationType;
    expect(resolveProvisionPolicyOption(single, { effectDirection: 1 })).toEqual({
      option: single.policyOptions![0],
      index: 0,
    });
  });

  it("returns null when the direction is ambiguous", () => {
    const ambiguous = {
      _id: "z",
      policyOptions: [
        { id: "p", name: "P", effectDirection: 1, economic: 3, social: 0 },
        { id: "q", name: "Q", effectDirection: 1, economic: 1, social: 0 },
      ],
    } as unknown as LegislationType;
    expect(resolveProvisionPolicyOption(ambiguous, { effectDirection: 1 })).toBeNull();
  });

  it("returns null when the legislation type has no options", () => {
    expect(resolveProvisionPolicyOption(null, { effectDirection: 1 })).toBeNull();
  });

  it("returns null for a synthetic tax-slider option id", () => {
    // Slider provisions carry "rate:38", which matches no seeded option.
    // Without an explicit short-circuit the axis fallback would resolve this to
    // option `b` (a provision with no economic/social reads as 0/0), silently
    // attaching an unrelated law's label to a slider bill. The short-circuit is
    // what makes the snapshot pass safe to run after stampTaxSliderProvisions.
    expect(
      resolveProvisionPolicyOption(lt, { policyOptionId: "rate:38", effectDirection: 1 })
    ).toBeNull();
  });
});
