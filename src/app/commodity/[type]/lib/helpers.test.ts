import { describe, expect, it } from "vitest";
import { formatUnits } from "./helpers";

describe("formatUnits", () => {
  it("steps electricity through SI prefixes instead of stacking suffixes", () => {
    expect(formatUnits(1_900_000, "MWh")).toBe("1.9 TWh");
    expect(formatUnits(10_500_000, "MWh")).toBe("10.5 TWh");
    expect(formatUnits(347_100, "MWh")).toBe("347 GWh");
    expect(formatUnits(72_300, "MWh")).toBe("72.3 GWh");
    expect(formatUnits(785, "MWh")).toBe("785 MWh");
    expect(formatUnits(0, "MWh")).toBe("0.0 MWh");
  });

  it("keeps magnitude suffixes for count units", () => {
    expect(formatUnits(1_900_000, "tons")).toBe("1.9M tons");
    expect(formatUnits(2_500_000_000, "bbl")).toBe("2.5B bbl");
    expect(formatUnits(4_200, "units")).toBe("4.2K units");
  });

  it("formats negatives with a sign instead of falling through to raw digits", () => {
    expect(formatUnits(-1_300_000, "MWh")).toBe("-1.3 TWh");
    expect(formatUnits(-26_800, "tons")).toBe("-26.8K tons");
  });
});
