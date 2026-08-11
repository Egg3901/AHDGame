import { describe, it, expect } from "vitest";
import { getNaturalDisasterTemplateKeys, selectDisasterTemplate } from "./selectDisasterTemplate";

describe("natural disaster template selection", () => {
  it("returns the full regional disaster pool (natural + infrastructure)", () => {
    expect(getNaturalDisasterTemplateKeys().sort()).toEqual(
      [
        "avalanche",
        "bridge_collapse",
        "drought_famine",
        "dust_storm",
        "earthquake",
        "extreme_heat",
        "flood",
        "forest_pest_outbreak",
        "hailstorm",
        "hurricane",
        "industrial_accident",
        "king_tide_flooding",
        "landslide",
        "port_closure",
        "tornado",
        "tsunami",
        "volcanic_eruption",
        "wildfire",
        "winter_storm",
      ].sort()
    );
  });
  it("selects deterministically by seed within the eligible set", () => {
    const keys = getNaturalDisasterTemplateKeys();
    const picked = selectDisasterTemplate(0);
    expect(keys).toContain(picked.key);
    expect(selectDisasterTemplate(0).key).toBe(picked.key);
  });
});
