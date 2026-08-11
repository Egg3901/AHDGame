import { describe, it, expect } from "vitest";
import { getPartyRoleLabel } from "./partyRoleLabels";

describe("getPartyRoleLabel", () => {
  it("returns the default English label for a country with no overrides (US)", () => {
    expect(getPartyRoleLabel("US", "chair")).toBe("National Chair");
    expect(getPartyRoleLabel("US", "viceChair")).toBe("National Vice Chair");
    expect(getPartyRoleLabel("US", "treasurer")).toBe("National Treasurer");
    expect(getPartyRoleLabel("US", "committee")).toBe("National Committee");
  });

  it("returns CN overrides for chair/viceChair/committee", () => {
    expect(getPartyRoleLabel("CN", "chair")).toBe("General Secretary");
    expect(getPartyRoleLabel("CN", "viceChair")).toBe("Deputy General Secretary");
    expect(getPartyRoleLabel("CN", "committee")).toBe("Secretariat");
  });

  it("falls back to default for CN keys with no override (treasurer)", () => {
    expect(getPartyRoleLabel("CN", "treasurer")).toBe("National Treasurer");
  });

  it("is case-insensitive on the country id (route [code] is lowercase)", () => {
    expect(getPartyRoleLabel("cn", "chair")).toBe("General Secretary");
    expect(getPartyRoleLabel("us", "chair")).toBe("National Chair");
  });

  it("falls back to default labels for an unknown country id", () => {
    expect(getPartyRoleLabel("ZZ", "chair")).toBe("National Chair");
    expect(getPartyRoleLabel("", "committee")).toBe("National Committee");
  });
});
