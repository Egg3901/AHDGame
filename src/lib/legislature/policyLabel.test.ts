import { describe, it, expect } from "vitest";
import { splitPolicyLabel } from "./policyLabel";

describe("splitPolicyLabel", () => {
  it("returns only a title when there is no ': ' separator", () => {
    expect(splitPolicyLabel("Direct Democracy Expansion Act")).toEqual({
      title: "Direct Democracy Expansion Act",
    });
  });

  it("splits on the first ': ' into title + description", () => {
    expect(
      splitPolicyLabel("Direct Democracy Expansion Act: Citizens' Assembly to referendum")
    ).toEqual({
      title: "Direct Democracy Expansion Act",
      description: "Citizens' Assembly to referendum",
    });
  });

  it("keeps later ': ' inside the description", () => {
    expect(splitPolicyLabel("Act: a: b")).toEqual({ title: "Act", description: "a: b" });
  });

  it("returns an empty object for undefined/empty input", () => {
    expect(splitPolicyLabel(undefined)).toEqual({});
    expect(splitPolicyLabel("")).toEqual({});
  });
});
