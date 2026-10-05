import { describe, it, expect } from "vitest";
import { getLeanLabel, getLeanColor, partyHex, appealBand, appealFill } from "./pollHelpers";
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

describe("pollHelpers party and appeal helpers", () => {
  it("prefers the stored party color, then the legacy color, then neutral", () => {
    expect(partyHex({ "7": "#123456" }, "7")).toBe("#123456");
    expect(partyHex(undefined, "democrat")).toBe("#3b82f6");
    expect(partyHex({}, "99")).toBe("#9CA3AF");
    expect(partyHex({}, null)).toBe("#9CA3AF");
  });
  it("bands appeal like the color scale", () => {
    expect(appealBand(40)).toBe("Strong");
    expect(appealBand(25)).toBe("Moderate");
    expect(appealBand(12)).toBe("Weak");
    expect(appealBand(3)).toBe("Very weak");
    expect(appealFill(40)).toBe("bg-green-500");
  });
});
