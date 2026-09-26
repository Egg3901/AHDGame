import { describe, expect, it } from "vitest";
import { navigationVariantForAssignment } from "./navigationVariant";

describe("navigationVariantForAssignment", () => {
  it("shows the new navigation only for the test assignment", () => {
    expect(navigationVariantForAssignment("test")).toBe("b");
    expect(navigationVariantForAssignment("b")).toBe("b");
    expect(navigationVariantForAssignment("control")).toBe("a");
    expect(navigationVariantForAssignment(undefined)).toBe("a");
    expect(navigationVariantForAssignment(false)).toBe("a");
  });
});
