import { describe, expect, it } from "vitest";

import {
  getCabinetWhipChamber,
  getConfidenceWhipChamber,
  getWhippableChambers,
  isCabinetNominationInCountry,
  isConfidenceVoteInCountry,
  isWhippableChamber,
} from "@/lib/partyWhips/constraints";
import { getSubNationalLegislatureKey } from "@/lib/constants/countries";

describe("party whip constraints", () => {
  it("uses the lower chamber for confidence votes", () => {
    expect(getConfidenceWhipChamber("US")).toBe("house");
    expect(getConfidenceWhipChamber("UK")).toBe("commons");
    expect(getConfidenceWhipChamber("DE")).toBe("bundestag");
    expect(getConfidenceWhipChamber("IE")).toBe("dail");
  });

  it("uses the confirmation chamber for cabinet nominations", () => {
    expect(getCabinetWhipChamber("US")).toBe("senate");
    expect(getCabinetWhipChamber("UK")).toBe("commons");
    expect(getCabinetWhipChamber("DE")).toBe("bundestag");
  });

  it("accepts country-specific chamber keys for whip requests", () => {
    expect(getWhippableChambers("DE")).toContain("bundestag");
    expect(getWhippableChambers("DE")).toContain("landtag");
    expect(isWhippableChamber("DE", "bundestag")).toBe(true);
    expect(isWhippableChamber("UK", "lords")).toBe(true);
    expect(isWhippableChamber("IE", "dail")).toBe(true);
    expect(isWhippableChamber("DE", "commons")).toBe(false);
  });

  // The state-party whip POST gates on isWhippableChamber(countryId, chamber).
  // Every country with a modeled sub-national legislature must accept its own
  // sub-national chamber key — otherwise state-legislature whips 400. The US
  // (stateSenate, via the fallback) is the case this branch was added to fix.
  it.each([
    ["US", "stateSenate"],
    ["UK", "regionalCouncil"],
    ["DE", "landtag"],
    ["JP", "regionalCouncil"],
    ["IE", "localCouncil"],
    ["CN", "peoplesCongress"],
  ] as const)("%s accepts its sub-national chamber (%s) as whippable", (country, expectedKey) => {
    const subKey = getSubNationalLegislatureKey(country);
    expect(subKey).toBe(expectedKey);
    expect(getWhippableChambers(country)).toContain(subKey);
    expect(isWhippableChamber(country, subKey)).toBe(true);
  });

  it("rejects cross-country confidence votes", () => {
    expect(isConfidenceVoteInCountry({ countryId: "US" }, "UK")).toBe(false);
    expect(isConfidenceVoteInCountry({ countryId: "UK" }, "UK")).toBe(true);
  });

  it("rejects cross-country cabinet nominations", () => {
    expect(isCabinetNominationInCountry({ countryId: "US" }, "UK")).toBe(false);
    expect(isCabinetNominationInCountry({ countryId: "US" }, "US")).toBe(true);
  });
});
