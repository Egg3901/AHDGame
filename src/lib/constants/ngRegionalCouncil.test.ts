import { describe, it, expect } from "vitest";
import { NG_REGIONAL_COUNCIL_SEATS } from "./states";
import { COUNTRY_CONFIGS } from "./countries";

describe("NG State House of Assembly", () => {
  it("seats total 990 across the six zones", () => {
    const total = Object.values(NG_REGIONAL_COUNCIL_SEATS).reduce((a, b) => a + b, 0);
    expect(total).toBe(990);
    expect(Object.keys(NG_REGIONAL_COUNCIL_SEATS).sort()).toEqual([
      "NORTH_CENTRAL",
      "NORTH_EAST",
      "NORTH_WEST",
      "SOUTH_EAST",
      "SOUTH_SOUTH",
      "SOUTH_WEST",
    ]);
  });

  it("NG has a regionalCouncil officeType declared before governor", () => {
    const keys = COUNTRY_CONFIGS.NG.officeTypes.map((o) => o.key);
    expect(keys).toContain("regionalCouncil");
    expect(keys.indexOf("regionalCouncil")).toBeLessThan(keys.indexOf("governor"));
  });
});
