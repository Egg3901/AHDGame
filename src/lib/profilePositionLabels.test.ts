import { describe, expect, it } from "vitest";
import { resolveProfilePositionLabels } from "./profilePositionLabels";

describe("resolveProfilePositionLabels", () => {
  it("shows leadership and an acting cabinet portfolio before the underlying office", () => {
    expect(
      resolveProfilePositionLabels({
        baseOfficeLabel: "Representative (CA, District 15)",
        hasBaseOffice: true,
        congressLeadershipRoles: ["speaker_of_the_house"],
        cabinetPositions: [
          {
            countryId: "US",
            positionId: "secretary_of_treasury",
            acting: true,
          },
        ],
      })
    ).toEqual([
      "Speaker of the House",
      "Acting Secretary of the Treasury",
      "Representative (CA, District 15)",
    ]);
  });

  it("shows all cabinet portfolios in roster order and omits a contradictory private-citizen label", () => {
    expect(
      resolveProfilePositionLabels({
        baseOfficeLabel: "Private Citizen",
        hasBaseOffice: false,
        gameYear: 1991,
        cabinetPositions: [
          {
            countryId: "UK",
            positionId: "chief_whip",
            acting: false,
          },
          {
            countryId: "UK",
            positionId: "foreign_secretary",
            acting: false,
          },
        ],
      })
    ).toEqual(["Foreign Secretary", "Parliamentary Secretary to the Treasury"]);
  });

  it("deduplicates repeated leadership and office labels", () => {
    expect(
      resolveProfilePositionLabels({
        baseOfficeLabel: "Speaker of the House",
        hasBaseOffice: true,
        congressLeadershipRoles: ["speaker_of_the_house", "speaker_of_the_house"],
      })
    ).toEqual(["Speaker of the House"]);
  });

  it("keeps the private-citizen label when no active role exists", () => {
    expect(
      resolveProfilePositionLabels({
        baseOfficeLabel: "Private Citizen",
        hasBaseOffice: false,
      })
    ).toEqual(["Private Citizen"]);
  });
});
