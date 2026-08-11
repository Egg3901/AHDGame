import { describe, expect, it } from "vitest";
import {
  buildDemographicsRows,
  getNationalityLabel,
  getStartingClassLabel,
} from "./profileDemographics";

describe("profileDemographics", () => {
  it("maps wealth to starting class labels", () => {
    expect(getStartingClassLabel("low")).toBe("Working Class");
    expect(getStartingClassLabel("middle")).toBe("Middle Class");
    expect(getStartingClassLabel("high")).toBe("Upper Class");
  });

  it("formats supported nationalities with name", () => {
    expect(getNationalityLabel("US")).toBe("United States");
    expect(getNationalityLabel("UK")).toBe("United Kingdom");
  });

  it("builds demographics rows for the profile card", () => {
    const rows = buildDemographicsRows(
      {
        gender: "nonbinary",
        wealth: "middle",
        race: "asian",
        education: "graduate",
      },
      "US",
      "UK"
    );

    expect(rows).toEqual([
      { label: "Gender", value: "Non-binary" },
      { label: "Starting Class", value: "Middle Class" },
      { label: "Ethnicity", value: "Asian" },
      { label: "Education", value: "Graduate Degree" },
      { label: "Starting Nationality", value: "United States" },
      { label: "Current Nationality", value: "United Kingdom" },
    ]);
  });
});
