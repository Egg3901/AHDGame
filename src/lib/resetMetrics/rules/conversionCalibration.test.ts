import { describe, expect, it } from "vitest";
import { inheritedCalibrationRegion, inheritedCalibrationCountry } from "./conversionCalibration";
describe("inherited conversion metric calibration", () => {
  it.each(["SCO", "WAL"])("retains %s's UK regional life and income reference", (country) => {
    expect(inheritedCalibrationRegion(country, "capital")).toEqual({
      countryId: "UK",
      regionId: country,
    });
    expect(inheritedCalibrationCountry(country)).toBe("UK");
  });
  it("keeps NIR's regional calibration under Ireland", () => {
    expect(inheritedCalibrationRegion("IE", "NIR")).toEqual({ countryId: "UK", regionId: "NIR" });
    expect(inheritedCalibrationCountry("IE")).toBe("IE");
  });
  it("preserves all other territory calibrations", () => {
    expect(inheritedCalibrationRegion("IE", "DUB")).toEqual({ countryId: "IE", regionId: "DUB" });
    expect(inheritedCalibrationRegion("UK", "NIR")).toEqual({ countryId: "UK", regionId: "NIR" });
  });
});
