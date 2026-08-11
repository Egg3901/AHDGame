import { describe, expect, it } from "vitest";
import { resolveCabinetOfficeNavEntry } from "./cabinetOfficeNavEntry";

describe("resolveCabinetOfficeNavEntry", () => {
  it("returns null when the viewer holds no cabinet seat", () => {
    expect(resolveCabinetOfficeNavEntry(null)).toBeNull();
    expect(resolveCabinetOfficeNavEntry(undefined)).toBeNull();
  });

  it("resolves a US cabinet seat against the US position list", () => {
    const entry = resolveCabinetOfficeNavEntry({
      positionId: "secretary_of_state",
      countryId: "US",
    });
    expect(entry).toEqual({
      positionId: "secretary_of_state",
      positionName: "Secretary of State",
      countryCode: "us",
    });
  });

  it("resolves a parliamentary cabinet seat against that country's position list", () => {
    const entry = resolveCabinetOfficeNavEntry({
      positionId: "chancellor",
      countryId: "UK",
    });
    expect(entry).toEqual({
      positionId: "chancellor",
      positionName: "Chancellor of the Exchequer",
      countryCode: "uk",
    });
  });

  it("returns null for a position id the country's list does not know", () => {
    expect(
      resolveCabinetOfficeNavEntry({ positionId: "minister_of_silly_walks", countryId: "UK" })
    ).toBeNull();
  });

  it("returns null for a country with no cabinet position list", () => {
    expect(resolveCabinetOfficeNavEntry({ positionId: "chancellor", countryId: "BR" })).toBeNull();
  });
});
