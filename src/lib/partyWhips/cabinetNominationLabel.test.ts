import { describe, expect, it } from "vitest";
import { cabinetNominationLabel } from "./cabinetNominationLabel";

describe("cabinetNominationLabel", () => {
  it("names the seat a US cabinet nominee was put forward for", () => {
    expect(
      cabinetNominationLabel("US", {
        positionId: "secretary_of_treasury",
        nomineeCharacterName: "Jane Doe",
      })
    ).toBe("Cabinet: Jane Doe for Secretary of the Treasury");
  });

  it("names vice presidential nominations", () => {
    expect(
      cabinetNominationLabel("US", {
        positionId: "vicePresident",
        nomineeCharacterName: "Jane Doe",
      })
    ).toBe("Cabinet: Jane Doe for Vice President");
  });

  it("falls back to the nominee alone for an unknown seat", () => {
    expect(
      cabinetNominationLabel("US", { positionId: "no_such_seat", nomineeCharacterName: "Jane Doe" })
    ).toBe("Cabinet: Jane Doe");
  });
});
