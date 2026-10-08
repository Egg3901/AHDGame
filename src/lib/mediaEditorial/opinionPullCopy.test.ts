import { describe, expect, it } from "vitest";
import { describeMediaPull } from "./opinionPullCopy";

describe("describeMediaPull", () => {
  it("is null with no slanted newsroom", () => {
    expect(describeMediaPull(null)).toBeNull();
    expect(describeMediaPull({ economic: 0, social: 0, strength: 0 })).toBeNull();
  });
  it("states the lean and the per day rate", () => {
    const line = describeMediaPull({
      economic: 0.005,
      social: -0.0025,
      slantEconomic: 3,
      slantSocial: -2,
      strength: 0.8,
    });
    expect(line).toBe(
      "Local newsrooms lean Econ +3.0, Soc -2.0. They are pulling opinion toward it by about Econ +0.12, Soc -0.06 per day."
    );
    expect(line).not.toMatch(new RegExp("[\u2013\u2014]"));
  });
  it("says so when opinion already sits at the slant", () => {
    expect(
      describeMediaPull({ economic: 0, social: 0, slantEconomic: 1, slantSocial: 1, strength: 1 })
    ).toContain("already sits");
  });
});
