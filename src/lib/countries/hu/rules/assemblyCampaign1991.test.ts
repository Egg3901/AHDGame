import { describe, expect, it } from "vitest";
import { hu1991PrimaryAdvanceLimit } from "./assemblyCampaign1991";

describe("Hungarian native Assembly campaign primary continuity", () => {
  it("keeps all modern regional actors available for district and list nominations", () => {
    expect(
      hu1991PrimaryAdvanceLimit(
        {
          countryId: "HU",
          electionType: "nationalAssembly",
          hungarianModernAssembly: { ruleVersion: "mixed-2011-v1" },
        },
        7
      )
    ).toBe(7);
  });
  it.each(["RO", "US"])("does not override another country's %s primary", (countryId) => {
    expect(
      hu1991PrimaryAdvanceLimit(
        {
          countryId,
          electionType: "nationalAssembly",
          hungarianModernAssembly: { ruleVersion: "mixed-2011-v1" },
        },
        7
      )
    ).toBeNull();
  });
  it("does not override an unbound Hungarian race", () => {
    expect(
      hu1991PrimaryAdvanceLimit({ countryId: "HU", electionType: "nationalAssembly" }, 7)
    ).toBeNull();
  });
});
