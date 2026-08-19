import { describe, expect, it } from "vitest";
import {
  buildDemographicsRows,
  getNationalityLabel,
  getStartingClassLabel,
  resolveStartingCountryId,
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

describe("resolveStartingCountryId (ticket 1107)", () => {
  it("uses the character's own starting country, not the account's", () => {
    // The reporter's case: account first played US, this character was made in DD.
    expect(resolveStartingCountryId({ startingCountryId: "DD", countryId: "DD" })).toBe("DD");
  });

  it("keeps the starting country after the character emigrates", () => {
    expect(resolveStartingCountryId({ startingCountryId: "DD", countryId: "UK" })).toBe("DD");
  });

  it("falls back to the current country for characters predating the field", () => {
    expect(resolveStartingCountryId({ countryId: "DD" })).toBe("DD");
    expect(resolveStartingCountryId({ startingCountryId: null, countryId: "DD" })).toBe("DD");
  });

  it("returns null when neither is known", () => {
    expect(resolveStartingCountryId({})).toBeNull();
  });

  it("renders East Germany, not United States, in the demographics rows", () => {
    const rows = buildDemographicsRows(
      null,
      resolveStartingCountryId({ startingCountryId: "DD", countryId: "DD" }),
      "DD"
    );
    expect(rows.find((r) => r.label === "Starting Nationality")?.value).toBe("East Germany");
    expect(rows.find((r) => r.label === "Current Nationality")?.value).toBe("East Germany");
  });
});
