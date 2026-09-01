import { describe, expect, it } from "vitest";
import { impeachmentStageChamberKey } from "./impeachmentTally";

/**
 * Whips address chambers by KEY, while the sibling helper returns an office
 * type. The two coincide for the US but not everywhere, so a whip derived from
 * the office type would silently target the wrong chamber.
 */
describe("impeachmentStageChamberKey", () => {
  it("puts a presidential case in the lower chamber while it is impeaching", () => {
    expect(
      impeachmentStageChamberKey({ targetOffice: "president", stage: "house", countryId: "US" })
    ).toBe("house");
  });

  it("moves a presidential case to the upper chamber for the trial", () => {
    expect(
      impeachmentStageChamberKey({ targetOffice: "president", stage: "senate", countryId: "US" })
    ).toBe("senate");
  });

  it("tries a governor in the state legislature", () => {
    expect(
      impeachmentStageChamberKey({ targetOffice: "governor", stage: "senate", countryId: "US" })
    ).toBe("stateSenate");
  });

  it("gives a governor case no House stage", () => {
    // Governor cases are filed straight at the conviction stage; a House-stage
    // governor case is not a state the lifecycle can produce.
    expect(
      impeachmentStageChamberKey({ targetOffice: "governor", stage: "house", countryId: "US" })
    ).toBeNull();
  });

  it("returns null once the case is resolved", () => {
    for (const stage of ["convicted", "acquitted", "dismissed", "cancelled"]) {
      expect(
        impeachmentStageChamberKey({ targetOffice: "president", stage, countryId: "US" })
      ).toBeNull();
    }
  });
});
