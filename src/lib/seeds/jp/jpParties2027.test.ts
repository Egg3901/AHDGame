import { describe, it, expect } from "vitest";
import { jpParties } from "./jpParties";
import { isPartyValidForPreset } from "@/lib/seeds/ensureDefaultParties";

// The six continuing parties that contest the Oct 2024 Shugiin and July 2025
// Sangiin elections and remain seated into 2027. JCP carries no
// validForPresets list (preset-agnostic) so it is valid everywhere.
const CONTINUING = [
  "Liberal Democratic Party",
  "Constitutional Democratic Party",
  "Komeito",
  "Japanese Communist Party",
  "Nippon Ishin no Kai",
  "Democratic Party for the People",
];

describe("jpParties 2027 roster", () => {
  it("seeds exactly the six continuing parties for 2027-default", () => {
    const roster = jpParties
      .filter((p) => isPartyValidForPreset(p, "2027-default"))
      .map((p) => p.name);
    expect(new Set(roster)).toEqual(new Set(CONTINUING));
  });

  it("each 2027-valid gated party lists 2027-default explicitly", () => {
    for (const party of jpParties.filter((p) => CONTINUING.includes(p.name))) {
      if (party.validForPresets) {
        expect(party.validForPresets, party.name).toContain("2027-default");
      }
    }
  });

  it("keeps era parties out of 2027 (no JSP, DSP, RYO, JDP)", () => {
    const roster = jpParties
      .filter((p) => isPartyValidForPreset(p, "2027-default"))
      .map((p) => p.name);
    for (const name of [
      "Japan Socialist Party",
      "Democratic Socialist Party",
      "Liberal Party",
      "Japan Democratic Party",
    ]) {
      expect(roster).not.toContain(name);
    }
  });
});
