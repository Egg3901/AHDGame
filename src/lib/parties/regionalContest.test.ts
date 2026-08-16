import { describe, expect, it } from "vitest";
import {
  canPartyContestState,
  UK_REGIONAL_PARTY_HOMES_BY_ABBR,
  UK_REGIONAL_PARTY_SLUGS,
} from "./regionalContest";

describe("canPartyContestState", () => {
  it("lets UK-wide parties contest every region", () => {
    expect(canPartyContestState({ countryId: "UK", abbreviation: "LAB", stateId: "LON" })).toBe(
      true
    );
    expect(canPartyContestState({ countryId: "UK", abbreviation: "CON", stateId: "SCO" })).toBe(
      true
    );
    expect(canPartyContestState({ countryId: "UK", abbreviation: "LIB", stateId: "NIR" })).toBe(
      true
    );
  });

  it("keeps SNP in Scotland and out of London", () => {
    expect(canPartyContestState({ countryId: "UK", abbreviation: "SNP", stateId: "SCO" })).toBe(
      true
    );
    expect(canPartyContestState({ countryId: "UK", abbreviation: "SNP", stateId: "LON" })).toBe(
      false
    );
    expect(canPartyContestState({ countryId: "UK", slug: "uk_snp", stateId: "SEE" })).toBe(false);
  });

  it("keeps Plaid Cymru in Wales and the NI parties in Northern Ireland", () => {
    expect(canPartyContestState({ countryId: "UK", abbreviation: "PC", stateId: "WAL" })).toBe(
      true
    );
    expect(canPartyContestState({ countryId: "UK", abbreviation: "PC", stateId: "SCO" })).toBe(
      false
    );
    expect(canPartyContestState({ countryId: "UK", abbreviation: "DUP", stateId: "NIR" })).toBe(
      true
    );
    expect(canPartyContestState({ countryId: "UK", abbreviation: "SF", stateId: "LON" })).toBe(
      false
    );
    expect(canPartyContestState({ countryId: "UK", abbreviation: "UUP", stateId: "WAL" })).toBe(
      false
    );
  });

  it("does not restrict non-UK countries or national races with no state", () => {
    expect(canPartyContestState({ countryId: "US", abbreviation: "SNP", stateId: "CA" })).toBe(
      true
    );
    expect(canPartyContestState({ countryId: "UK", abbreviation: "SNP" })).toBe(true);
    expect(canPartyContestState({ countryId: "UK", stateId: "LON" })).toBe(true);
  });

  it("covers every regional slug in the seed sweep list", () => {
    expect([...UK_REGIONAL_PARTY_SLUGS].sort()).toEqual([
      "uk_dup",
      "uk_plaid",
      "uk_sf",
      "uk_snp",
      "uk_uup",
    ]);
    expect(Object.keys(UK_REGIONAL_PARTY_HOMES_BY_ABBR).sort()).toEqual([
      "DUP",
      "PC",
      "SF",
      "SNP",
      "UUP",
    ]);
  });
});
