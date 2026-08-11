import { describe, expect, it } from "vitest";
import { getCountryLayer1Model, buildModelRegionDemographics } from "./index";

const NG_ZONES = [
  "NORTH_WEST",
  "NORTH_EAST",
  "NORTH_CENTRAL",
  "SOUTH_WEST",
  "SOUTH_SOUTH",
  "SOUTH_EAST",
];

describe("NG Layer-1 model", () => {
  it("returns a model for the 2019 and 1991 eras", () => {
    expect(getCountryLayer1Model("NG", "2019")).toBeTruthy();
    expect(getCountryLayer1Model("NG", "1991")).toBeTruthy();
  });

  it("builds region demographics for all 6 geopolitical zones", () => {
    const model = getCountryLayer1Model("NG", "2019");
    expect(model).toBeTruthy();
    const regions = buildModelRegionDemographics(model!);
    expect(regions.length).toBe(6);
    for (const zone of NG_ZONES) {
      expect(
        regions.some((r) => r._id === zone),
        `zone ${zone}`
      ).toBe(true);
    }
  });
});
