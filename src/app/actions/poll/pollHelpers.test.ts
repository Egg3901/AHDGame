import { describe, it, expect } from "vitest";
import { getLeanLabel, getLeanColor } from "./pollHelpers";
import { getEconomicPositionName, positionBucketColorClass } from "@/lib/utils/politics";

describe("pollHelpers lean helpers delegate to the ruler", () => {
  it("label matches the candidate scale", () => {
    expect(getLeanLabel(-0.76)).toBe(getEconomicPositionName(-0.76));
    expect(getLeanLabel(2)).toBe("Lean Right");
  });
  it("colour matches the bucket", () => {
    expect(getLeanColor(-0.76)).toBe(positionBucketColorClass(-0.76, "economic"));
  });
});
