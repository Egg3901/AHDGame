import { describe, it, expect } from "vitest";
import { getJointSittingOfficeTypes } from "@/lib/legislature/chamberOfficeType";

/**
 * The chamber set a concurrent vote opens.
 *
 * MUST be getJointSittingOfficeTypes, never legislature.bicameral: it gates on an
 * upper chamber that actually has electable members, which is the property that
 * matters here.
 */
describe("concurrent-vote chamber resolution", () => {
  it("returns ONE chamber for Germany under 1953-default", () => {
    // The preset MUST be pinned. DE's base config is bicameral: false, so a
    // bicameral-keyed implementation ALSO returns 1 for era-neutral DE -- an
    // era-neutral assertion passes on the broken build and proves nothing.
    // 1953-default is the only preset where the two candidate rules disagree:
    // the override flips bicameral to true over an appointed Bundesrat that has
    // no upperElectionSystem.
    expect(getJointSittingOfficeTypes("DE", "1953-default")).toHaveLength(1);
  });

  it("returns two chambers for the US", () => {
    expect(getJointSittingOfficeTypes("US", "1953-default")).toHaveLength(2);
  });

  it("is preset-sensitive for Turkey", () => {
    // TR's base defines an upperElectionSystem; the 1953 override sets it undefined.
    // This is the case that fails if a stage resolves its config without a preset.
    const y1953 = getJointSittingOfficeTypes("TR", "1953-default").length;
    const y1979 = getJointSittingOfficeTypes("TR", "1979-default").length;
    expect(y1953).not.toBe(y1979);
  });

  it("returns ONE chamber for the UK, whose Lords do not vote", () => {
    expect(getJointSittingOfficeTypes("UK", "1953-default")).toHaveLength(1);
  });
});
