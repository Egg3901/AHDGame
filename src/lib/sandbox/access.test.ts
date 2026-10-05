import { describe, expect, it } from "vitest";
import { hasSandboxAccess } from "./access";

describe("hasSandboxAccess", () => {
  it("lets a granted non-supporter in while the flag is on", () => {
    expect(hasSandboxAccess({ testerAccessEnabled: true, testerGranted: true })).toBe(true);
  });

  it("denies a granted non-supporter while the flag is off", () => {
    expect(hasSandboxAccess({ testerAccessEnabled: false, testerGranted: true })).toBe(false);
    expect(hasSandboxAccess({ testerGranted: true })).toBe(false);
  });

  it("denies an ungranted non-supporter even with the flag on", () => {
    expect(hasSandboxAccess({ testerAccessEnabled: true, testerGranted: false })).toBe(false);
  });

  it("keeps supporters, staff in regardless of the flag or grant", () => {
    const supporter = { patreonTier: "supporter-plus", isPatronActive: true };
    expect(hasSandboxAccess(supporter)).toBe(true);
    expect(hasSandboxAccess({ patreonTier: "supporter-plus-plus", isPatronActive: true })).toBe(
      true
    );
    expect(hasSandboxAccess({ isAdmin: true })).toBe(true);
    expect(hasSandboxAccess({ isModerator: true })).toBe(true);
  });

  it("does not treat lapsed or lower-tier patrons as supporters", () => {
    expect(hasSandboxAccess({ patreonTier: "supporter-plus", isPatronActive: false })).toBe(false);
    expect(hasSandboxAccess({ patreonTier: "supporter", isPatronActive: true })).toBe(false);
  });
});
