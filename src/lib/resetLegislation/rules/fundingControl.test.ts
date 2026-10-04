import { describe, expect, it } from "vitest";
import { enactedLawFundingControl, openingLawFundingControl } from "./fundingControl";

describe("law funding control", () => {
  it("locks the audited 1991 obligations by country", () => {
    expect(openingLawFundingControl({ country: "US", familyId: "L02", annualAllocation: 1 })).toBe(
      "required"
    );
    expect(openingLawFundingControl({ country: "UK", familyId: "L10", annualAllocation: 1 })).toBe(
      "required"
    );
    expect(openingLawFundingControl({ country: "JP", familyId: "L21", annualAllocation: 1 })).toBe(
      "required"
    );
  });

  it("does not turn ordinary opening programs into entitlements", () => {
    expect(openingLawFundingControl({ country: "US", familyId: "L10", annualAllocation: 1 })).toBe(
      "adjustable"
    );
    expect(openingLawFundingControl({ country: "JP", familyId: "L37", annualAllocation: 1 })).toBe(
      "adjustable"
    );
  });

  it("removes meaningless controls from zero-cost and specialized programs", () => {
    expect(openingLawFundingControl({ country: "UK", familyId: "L43", annualAllocation: 0 })).toBe(
      "no_separate_allocation"
    );
    expect(openingLawFundingControl({ country: "US", familyId: "L48", annualAllocation: 1 })).toBe(
      "externally_settled"
    );
  });

  it("classifies enacted options rather than assuming one rule for a mixed family", () => {
    expect(
      enactedLawFundingControl({ familyId: "L37", choice: "center", annualAllocation: 1 })
    ).toBe("required");
    expect(
      enactedLawFundingControl({ familyId: "L37", choice: "center_right", annualAllocation: 1 })
    ).toBe("adjustable");
    expect(
      enactedLawFundingControl({ familyId: "L50", choice: "far_left", annualAllocation: 1 })
    ).toBe("adjustable");
    expect(
      enactedLawFundingControl({ familyId: "L46", choice: "far_right", annualAllocation: 1 })
    ).toBe("required");
  });
});
