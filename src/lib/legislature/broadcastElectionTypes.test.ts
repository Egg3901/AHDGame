import { describe, it, expect } from "vitest";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { getBroadcastElectionTypes } from "./broadcastElectionTypes";

/** Pinned expectations — see spec section A4. NOT derived from the old
 *  ELECTION_TYPES array, which is not a valid oracle. */
const EXPECTED_2019: Record<string, string[]> = {
  US: ["president", "senate", "house", "stateSenate", "governor"],
  UK: ["commons", "regionalCouncil"],
  JP: ["sangiin", "shugiin", "regionalCouncil"],
  DE: ["bundestag", "landtag", "ministerPresident"],
  IE: ["uachtaran", "dail", "localCouncil"],
  BR: ["president", "senate", "chamber"],
  CN: ["npcDelegate", "peoplesCongress"],
  NG: ["president", "senate", "house"],
  HU: ["assemblyDelegate"],
  PL: ["sejmDeputy"],
  RO: ["assemblyDeputy"],
  YU: ["assemblyDelegate"],
  BG: ["assemblyDeputy"],
  CS: ["assemblyDeputy"],
  RU: ["nationalitiesDeputy", "supremeSovietDeputy", "republicSupremeSoviet"],
  FR: ["president", "senator", "deputy"],
  IT: ["senator", "deputy"],
  ES: ["senator", "deputy"],
  SE: ["member"],
  TR: ["senator", "deputy"],
  GR: ["deputy"],
  AT: ["deputy"],
  FI: ["deputy"],
  DD: ["volkskammerDeputy"],
  SCO: ["holyrood", "regionalCouncil"],
  WAL: ["senedd", "regionalCouncil"],
  BLR: ["sovietDeputy"],
  BAL: ["sovietDeputy"],
};

/** Countries whose chamber model is era-conditional. */
const EXPECTED_1953: Record<string, string[]> = {
  FR: ["senator", "deputy"], // Fourth Republic — no directly-elected president
  ES: ["procurador"], // Francoist Cortes
  TR: ["deputy"], // unicameral in 1953
};

const HEAD_OF_GOV_KEYS = [
  "primeMinister",
  "chancellor",
  "taoiseach",
  "premier",
  "caudillo",
  "generalSecretary",
  "firstSecretary",
];

describe("getBroadcastElectionTypes", () => {
  it("derives the pinned table for every country under 2019-default", () => {
    for (const [countryId, expected] of Object.entries(EXPECTED_2019)) {
      const ids = getBroadcastElectionTypes(countryId as CountryId, "2019-default").map(
        (t) => t.id
      );
      expect(ids, `country ${countryId}`).toEqual(expected);
    }
  });

  it("is preset-aware for era-conditional countries", () => {
    for (const [countryId, expected] of Object.entries(EXPECTED_1953)) {
      const ids = getBroadcastElectionTypes(countryId as CountryId, "1953-default").map(
        (t) => t.id
      );
      expect(ids, `country ${countryId} @1953`).toEqual(expected);
    }
  });

  it("yields at least one election type for every registered country", () => {
    for (const countryId of Object.keys(COUNTRY_CONFIGS) as CountryId[]) {
      const types = getBroadcastElectionTypes(countryId, "2019-default");
      expect(types.length, `country ${countryId} yielded none`).toBeGreaterThan(0);
    }
  });

  it("never emits a head-of-government office key", () => {
    for (const countryId of Object.keys(COUNTRY_CONFIGS) as CountryId[]) {
      const ids = getBroadcastElectionTypes(countryId, "2019-default").map((t) => t.id);
      for (const banned of HEAD_OF_GOV_KEYS) {
        expect(ids, `country ${countryId}`).not.toContain(banned);
      }
    }
  });

  it("retains directly-elected heads of state", () => {
    expect(getBroadcastElectionTypes("US", "2019-default").map((t) => t.id)).toContain("president");
    expect(getBroadcastElectionTypes("IE", "2019-default").map((t) => t.id)).toContain("uachtaran");
  });

  it("resolves office-type keys, not chamber keys", () => {
    const cn = getBroadcastElectionTypes("CN", "2019-default").map((t) => t.id);
    expect(cn).toContain("npcDelegate");
    expect(cn).not.toContain("npc");
    const dd = getBroadcastElectionTypes("DD", "2019-default").map((t) => t.id);
    expect(dd).toContain("volkskammerDeputy");
    expect(dd).not.toContain("volkskammer");
  });

  it("excludes appointed upper chambers", () => {
    expect(getBroadcastElectionTypes("UK", "2019-default").map((t) => t.id)).not.toContain("lords");
    expect(getBroadcastElectionTypes("DE", "2019-default").map((t) => t.id)).not.toContain(
      "bundesrat"
    );
    expect(getBroadcastElectionTypes("IE", "2019-default").map((t) => t.id)).not.toContain(
      "seanad"
    );
    expect(getBroadcastElectionTypes("CN", "2019-default").map((t) => t.id)).not.toContain("cppcc");
  });

  it("gates sub-national executives on electionSystems, not office-key presence", () => {
    // UK recycles the `governor` office key for devolved First Ministers but
    // declares no subNationalExecutive election system.
    expect(getBroadcastElectionTypes("UK", "2019-default").map((t) => t.id)).not.toContain(
      "governor"
    );
    // DE keys its regional executive `ministerPresident`, not `governor`.
    const de = getBroadcastElectionTypes("DE", "2019-default").map((t) => t.id);
    expect(de).toContain("ministerPresident");
    expect(de).not.toContain("governor");
  });

  it("labels every derived type with a non-empty human-readable string", () => {
    for (const countryId of Object.keys(COUNTRY_CONFIGS) as CountryId[]) {
      for (const t of getBroadcastElectionTypes(countryId, "2019-default")) {
        expect(t.label.length, `${countryId}/${t.id}`).toBeGreaterThan(0);
      }
    }
  });
});
