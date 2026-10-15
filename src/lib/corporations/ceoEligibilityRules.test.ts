import { describe, expect, it } from "vitest";
import { characterCeoResidencyFailure } from "./ceoEligibilityRules";

describe("characterCeoResidencyFailure", () => {
  const corporation = { headquartersState: "US_TX", countryId: "US" };

  it("requires a private-corporation CEO to live in its HQ state and country", () => {
    expect(characterCeoResidencyFailure({ homeState: "JP_TK", countryId: "JP" }, corporation)).toBe(
      "headquarters-state"
    );
    expect(characterCeoResidencyFailure({ homeState: "US_TX", countryId: "JP" }, corporation)).toBe(
      "country"
    );
    expect(characterCeoResidencyFailure({ homeState: "US_TX", countryId: "US" }, corporation)).toBe(
      null
    );
  });

  it("allows a national-corporation CEO anywhere in the same country", () => {
    expect(
      characterCeoResidencyFailure({ homeState: "US_CA", countryId: "US" }, corporation, {
        countryWide: true,
      })
    ).toBeNull();
    expect(
      characterCeoResidencyFailure({ homeState: "JP_TK", countryId: "JP" }, corporation, {
        countryWide: true,
      })
    ).toBe("country");
  });

  it("rejects missing residency data for private corporations", () => {
    expect(characterCeoResidencyFailure({}, corporation)).toBe("headquarters-state");
    expect(characterCeoResidencyFailure({}, {})).toBe("headquarters-state");
  });
});
