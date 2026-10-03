import { describe, expect, it } from "vitest";
import { formatSlateLabel, formatSlateRaceTitle } from "./slateFormatting";

describe("formatSlateRaceTitle", () => {
  it("names a by-election by its game label, not its storage key (ticket 1379)", () => {
    expect(formatSlateRaceTitle({ electionType: "special_commons" })).toBe("Commons By-Election");
    expect(formatSlateRaceTitle({ electionType: "special_governor" })).toBe("Governor By-Election");
  });

  it("keeps regular races and their class suffix as before", () => {
    expect(formatSlateRaceTitle({ electionType: "commons" })).toBe("Commons Race");
    expect(formatSlateRaceTitle({ electionType: "regionalCouncil" })).toBe("Regional Council Race");
    expect(formatSlateRaceTitle({ electionType: "senate", senateClass: 2 })).toBe(
      "Senate Race · Class II"
    );
    expect(
      formatSlateRaceTitle({ electionType: "senate", senateClass: null, chamberClass: 3 })
    ).toBe("Senate Race · Class III");
  });
});

describe("formatSlateLabel", () => {
  it("title-cases storage keys", () => {
    expect(formatSlateLabel("special_commons")).toBe("Special Commons");
    expect(formatSlateLabel(null)).toBe("-");
  });
});
