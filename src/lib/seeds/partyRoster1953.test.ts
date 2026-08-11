/**
 * Regression lock for 1953-default party rosters across the countries swept
 * for era anachronisms (HU/RO/DE/JP/ES/TR/SE/BR).
 *
 * Asserts the exact abbreviation set that `isPartyValidForPreset` admits for
 * `1953-default`, and that known post-1953 successors are gated out.
 */
import { describe, expect, it } from "vitest";
import { isPartyValidForPreset } from "@/lib/seeds/ensureDefaultParties";
import { huParties } from "@/lib/seeds/hu/huParties";
import { roParties } from "@/lib/seeds/ro/roParties";
import { deParties } from "@/lib/seeds/de/deParties";
import { jpParties } from "@/lib/seeds/jp/jpParties";
import { esParties } from "@/lib/seeds/es/esParties";
import { trParties } from "@/lib/seeds/tr/trParties";
import { seParties } from "@/lib/seeds/se/seParties";
import { brParties } from "@/lib/seeds/br/brParties";
import { getCountryConfig } from "@/lib/constants/countries";
import type { PartySeed } from "@/lib/seeds/reference/politicalParties";

const PRESET = "1953-default";

const abbrs = (parties: PartySeed[]) =>
  parties
    .filter((p) => isPartyValidForPreset(p, PRESET))
    .map((p) => p.abbreviation)
    .sort();

describe("1953-default party roster era gating", () => {
  it("HU: MDP only (MSZMP is 1956+)", () => {
    expect(abbrs(huParties)).toEqual(["MDP"]);
    expect(huParties.find((p) => p.abbreviation === "MSZMP")!.validForPresets).toEqual([
      "1979-default",
    ]);
  });

  it("RO: PMR only (PCR name is 1965+)", () => {
    expect(abbrs(roParties)).toEqual(["PMR"]);
    expect(roParties.find((p) => p.abbreviation === "PCR")!.validForPresets).toEqual([
      "1979-default",
    ]);
  });

  it("DE: excludes Greens/Linke/AfD/PDS; includes SPD/CDU/CSU/FDP + DP + GB/BHE", () => {
    expect(abbrs(deParties)).toEqual(["CDU", "CSU", "DP", "FDP", "GB/BHE", "SPD"]);
    expect(deParties.find((p) => p.abbreviation === "GRN")!.validForPresets).not.toContain(PRESET);
  });

  it("JP: pre-LDP roster (Liberal + Democratic + JSP + JCP); no LDP/Komeito", () => {
    expect(abbrs(jpParties)).toEqual(["JCP", "JDP", "JSP", "RYO"]);
    expect(jpParties.find((p) => p.abbreviation === "LDP")!.validForPresets).not.toContain(PRESET);
    expect(jpParties.find((p) => p.abbreviation === "KMT")!.validForPresets).not.toContain(PRESET);
  });

  it("ES: FET only (Movimiento); no post-1977 Transition parties", () => {
    expect(abbrs(esParties)).toEqual(["FET"]);
    for (const abbr of ["UCD", "PSOE", "PCE", "AP", "CiU"]) {
      expect(esParties.find((p) => p.abbreviation === abbr)!.validForPresets).not.toContain(PRESET);
    }
  });

  it("TR: DP + CHP; AP (1961) gated out", () => {
    expect(abbrs(trParties)).toEqual(["CHP", "DP"]);
    expect(trParties.find((p) => p.abbreviation === "AP")!.validForPresets).toEqual([
      "1979-default",
    ]);
  });

  it("SE: period names (Högerpartiet, Bondeförbundet, SKP); no Moderaterna/Centerpartiet", () => {
    expect(abbrs(seParties)).toEqual(["BF", "FP", "H", "SAP", "SKP"]);
    // M and C carry forward into 1991-default too (same party, continuous).
    expect(seParties.find((p) => p.abbreviation === "M")!.validForPresets).toEqual([
      "1979-default",
      "1991-default",
    ]);
    expect(seParties.find((p) => p.abbreviation === "C")!.validForPresets).toEqual([
      "1979-default",
      "1991-default",
    ]);
  });

  it("BR: Vargas-era PSD/UDN/PTB only; PT (1980) gated out", () => {
    expect(abbrs(brParties)).toEqual(["PSD", "PTB", "UDN"]);
    expect(brParties.find((p) => p.abbreviation === "PT")!.validForPresets).not.toContain(PRESET);
  });
});

describe("1953-default majorPartyIds era overlays", () => {
  it("TR majors are DP + CHP (not AP)", () => {
    expect(getCountryConfig("TR", PRESET).majorPartyIds).toEqual(["tr_dp", "tr_chp"]);
    expect(getCountryConfig("TR", "1979-default").majorPartyIds).toEqual(["tr_ap", "tr_chp"]);
  });

  it("SE majors are SAP + Högerpartiet (not Moderaterna)", () => {
    expect(getCountryConfig("SE", PRESET).majorPartyIds).toEqual(["se_sap", "se_h"]);
    expect(getCountryConfig("SE", "1979-default").majorPartyIds).toEqual(["se_sap", "se_m"]);
  });

  it("ES major is FET only", () => {
    expect(getCountryConfig("ES", PRESET).majorPartyIds).toEqual(["es_fet"]);
  });

  it("JP majors are Liberal Party + JSP (not LDP/CDP)", () => {
    expect(getCountryConfig("JP", PRESET).majorPartyIds).toEqual(["ryo", "jsp"]);
  });

  it("HU/RO majors use era-correct ruling-party abbreviations", () => {
    expect(getCountryConfig("HU", PRESET).majorPartyIds).toEqual(["mdp"]);
    expect(getCountryConfig("RO", PRESET).majorPartyIds).toEqual(["pmr"]);
    expect(getCountryConfig("HU", "1979-default").majorPartyIds).toEqual(["mszmp"]);
    expect(getCountryConfig("RO", "1979-default").majorPartyIds).toEqual(["pcr"]);
  });
});
