import { describe, it, expect } from "vitest";
import {
  eligibleRaceOfficeKeys,
  validRaces,
  raceToOfficeType,
  raceToElectionTypes,
  getChamberName,
} from "./races";
import { COUNTRY_CONFIGS, COUNTRY_ORDER, type CountryId } from "@/lib/constants/countries";

describe("predict races (data-driven from COUNTRY_CONFIGS)", () => {
  it("returns the national elected chamber office keys per country", () => {
    // Order follows officeTypes declaration order in the config.
    expect(validRaces("US")).toEqual(["senate", "house"]);
    expect(validRaces("UK")).toEqual(["commons"]);
    expect(validRaces("DE")).toEqual(["bundestag"]);
    expect(validRaces("JP")).toEqual(["shugiin", "sangiin"]);
    // Previously broken — these countries returned [] under the hardcoded map.
    expect(validRaces("IE")).toEqual(["dail"]);
    expect(validRaces("BR")).toEqual(["senate", "chamber"]);
    expect(validRaces("CN")).toEqual(["npcDelegate"]);
    expect(validRaces("NG")).toEqual(["senate", "house"]);
  });

  it("excludes sub-national chambers (state senate, Landtag, councils, provincial congress)", () => {
    expect(validRaces("US")).not.toContain("stateSenate");
    expect(validRaces("DE")).not.toContain("landtag");
    expect(validRaces("UK")).not.toContain("regionalCouncil");
    expect(validRaces("IE")).not.toContain("localCouncil");
    expect(validRaces("CN")).not.toContain("peoplesCongress");
  });

  it("excludes appointed upper chambers (UK Lords, DE Bundesrat) and non-chamber offices", () => {
    expect(validRaces("UK")).not.toContain("lords");
    expect(validRaces("DE")).not.toContain("bundesrat");
    expect(validRaces("US")).not.toContain("president");
    expect(validRaces("US")).not.toContain("governor");
    expect(validRaces("US")).not.toContain("centralBankChair");
  });

  it("every supported country has at least one predictable race", () => {
    for (const id of COUNTRY_ORDER) {
      expect(validRaces(id).length).toBeGreaterThan(0);
    }
  });

  it("eligibleRaceOfficeKeys matches validRaces for a known CountryId", () => {
    expect(eligibleRaceOfficeKeys("BR")).toEqual(validRaces("BR"));
  });

  it("raceToOfficeType returns the office key for valid races, null otherwise", () => {
    expect(raceToOfficeType("IE", "dail")).toBe("dail");
    expect(raceToOfficeType("CN", "npcDelegate")).toBe("npcDelegate");
    expect(raceToOfficeType("IE", "house")).toBeNull();
    expect(raceToOfficeType("ZZ", "dail")).toBeNull();
  });

  it("raceToElectionTypes includes the snap variant only for snap-enabled lower chambers", () => {
    // IE Dáil permits snaps and its office key equals the lower-chamber key.
    expect(raceToElectionTypes("IE", "dail")).toEqual(["dail", "snap_dail"]);
    // UK Commons permits snaps.
    expect(raceToElectionTypes("UK", "commons")).toEqual(["commons", "snap_commons"]);
    // CN NPC does not permit snaps.
    expect(raceToElectionTypes("CN", "npcDelegate")).toEqual(["npcDelegate"]);
    // US Senate is an upper chamber — never a snap.
    expect(raceToElectionTypes("US", "senate")).toEqual(["senate"]);
    expect(raceToElectionTypes("IE", "house")).toBeNull();
  });

  it("getChamberName resolves the display name via the office's chamberKey", () => {
    // CN race key (npcDelegate) differs from its chamber key (npc).
    expect(getChamberName("CN", "npcDelegate", COUNTRY_CONFIGS.CN)).toBe(
      COUNTRY_CONFIGS.CN.legislature.lowerChamber.name
    );
    expect(getChamberName("IE", "dail", COUNTRY_CONFIGS.IE)).toBe(
      COUNTRY_CONFIGS.IE.legislature.lowerChamber.name
    );
    expect(getChamberName("US", "senate", COUNTRY_CONFIGS.US)).toBe(
      COUNTRY_CONFIGS.US.legislature.upperChamber?.name
    );
  });
});

// Type-level guard: every CountryId is reachable through validRaces without throwing.
it("validRaces does not throw for any CountryId", () => {
  for (const id of Object.keys(COUNTRY_CONFIGS) as CountryId[]) {
    expect(() => validRaces(id)).not.toThrow();
  }
});

/*
 * Pins the race keys the Discord bot's /predict `race` choices must offer for
 * the Cold War countries. RU's Soviet of Nationalities counts because it is a
 * contested upper chamber (`elected: true`); its republic-level deputies are
 * excluded as sub-national. DD is unicameral, so only the Volkskammer.
 */
describe("validRaces for the Cold War countries", () => {
  it("offers both Supreme Soviet chambers for RU", () => {
    expect(validRaces("RU")).toEqual(["supremeSovietDeputy", "nationalitiesDeputy"]);
  });

  it("offers the Volkskammer for DD", () => {
    expect(validRaces("DD")).toEqual(["volkskammerDeputy"]);
  });
});
