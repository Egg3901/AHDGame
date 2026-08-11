import { describe, expect, it } from "vitest";
import { buildGovernmentTypeMap } from "./governmentTypeMap";

describe("buildGovernmentTypeMap", () => {
  it("seeds Western democracies from COUNTRY_CONFIGS", () => {
    const map = buildGovernmentTypeMap();
    expect(map.US).toBe("presidential");
    expect(map.UK).toBe("parliamentaryMonarchy");
    expect(map.DE).toBe("parliamentaryRepublic");
  });

  it("seeds one-party states as Eastern-bloc candidates", () => {
    const map = buildGovernmentTypeMap();
    expect(map.CN).toBe("onePartyState");
    expect(map.RU).toBe("onePartyState");
    expect(map.DD).toBe("onePartyState");
  });

  it("overlays live countryState.governmentType over static defaults", () => {
    const map = buildGovernmentTypeMap([{ _id: "CN", governmentType: "parliamentaryRepublic" }]);
    expect(map.CN).toBe("parliamentaryRepublic");
    // Untouched countries keep their static default
    expect(map.US).toBe("presidential");
  });
});
