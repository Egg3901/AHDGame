import { describe, expect, it } from "vitest";
import { COUNTRY_CONFIGS, COUNTRY_ORDER, type CountryId } from "@/lib/constants/countries";
import {
  listCountryOffices,
  resolveChamberForOffice,
  resolveOfficeKeyForElectionType,
} from "./officeResolution";

/**
 * Every `(countryId, electionType)` pair the live 1953 world actually seeds.
 *
 * This is ground truth, not a guess: it was read off the `elections` collection.
 * If a new era seed introduces a type that does not resolve, this table is where
 * to add it, and the assertion below is what stops the race from silently
 * vanishing out of the grouped list.
 */
const SEEDED_PAIRS: ReadonlyArray<readonly [CountryId, string]> = [
  ["BR", "chamber"],
  ["CN", "governor"],
  ["CN", "npcDelegate"],
  ["CN", "peoplesCongress"],
  ["DD", "governor"],
  ["DD", "volkskammerDeputy"],
  ["DE", "bundestag"],
  ["FR", "assembleeNationale"],
  ["IE", "dail"],
  ["IE", "governor"],
  ["IE", "localCouncil"],
  ["IE", "uachtaran"],
  ["IT", "cameraDeputati"],
  ["JP", "sangiin"],
  ["JP", "shugiin"],
  ["RU", "governor"],
  ["RU", "nationalitiesDeputy"],
  ["RU", "republicSupremeSoviet"],
  ["RU", "supremeSovietDeputy"],
  ["SE", "riksdag"],
  ["TR", "milletMeclisi"],
  ["UK", "commons"],
  ["UK", "regionalCouncil"],
  ["US", "governor"],
  ["US", "house"],
  ["US", "president"],
  ["US", "senate"],
  ["US", "stateSenate"],
];

describe("resolveOfficeKeyForElectionType", () => {
  it("resolves every election type the live world seeds", () => {
    const unresolved = SEEDED_PAIRS.filter(
      ([countryId, electionType]) =>
        resolveOfficeKeyForElectionType(countryId, electionType) === null
    );
    expect(unresolved).toEqual([]);
  });

  it("resolves each seeded type to an office the country actually defines", () => {
    for (const [countryId, electionType] of SEEDED_PAIRS) {
      const key = resolveOfficeKeyForElectionType(countryId, electionType);
      const officeKeys = COUNTRY_CONFIGS[countryId].officeTypes.map((o) => o.key);
      expect(officeKeys, `${countryId}/${electionType} -> ${key}`).toContain(key);
    }
  });

  it("matches on the office key directly (US, RU, DD, CN shape)", () => {
    expect(resolveOfficeKeyForElectionType("US", "senate")).toBe("senate");
    expect(resolveOfficeKeyForElectionType("RU", "supremeSovietDeputy")).toBe(
      "supremeSovietDeputy"
    );
    expect(resolveOfficeKeyForElectionType("DD", "volkskammerDeputy")).toBe("volkskammerDeputy");
  });

  it("falls back to the chamber key (FR, IT, SE, TR shape)", () => {
    // The election type names the chamber; the office is keyed `deputy`.
    expect(resolveOfficeKeyForElectionType("FR", "assembleeNationale")).toBe("deputy");
    expect(resolveOfficeKeyForElectionType("IT", "cameraDeputati")).toBe("deputy");
    expect(resolveOfficeKeyForElectionType("TR", "milletMeclisi")).toBe("deputy");
    expect(resolveOfficeKeyForElectionType("SE", "riksdag")).toBe("member");
  });

  it("files a snap election under the same office as its regular race", () => {
    expect(resolveOfficeKeyForElectionType("UK", "snap_commons")).toBe(
      resolveOfficeKeyForElectionType("UK", "commons")
    );
    expect(resolveOfficeKeyForElectionType("DE", "snap_bundestag")).toBe(
      resolveOfficeKeyForElectionType("DE", "bundestag")
    );
    expect(resolveOfficeKeyForElectionType("JP", "snap_shugiin")).toBe(
      resolveOfficeKeyForElectionType("JP", "shugiin")
    );
  });

  it("returns null for a type the country does not run, rather than guessing", () => {
    expect(resolveOfficeKeyForElectionType("UK", "president")).toBeNull();
    expect(resolveOfficeKeyForElectionType("US", "bogus")).toBeNull();
  });

  it("resolves every office key and chamber key of every registered country", () => {
    const failures: string[] = [];
    for (const countryId of COUNTRY_ORDER) {
      for (const office of COUNTRY_CONFIGS[countryId].officeTypes) {
        if (resolveOfficeKeyForElectionType(countryId, office.key) !== office.key) {
          failures.push(`${countryId}: office key ${office.key}`);
        }
        if (
          office.chamberKey &&
          resolveOfficeKeyForElectionType(countryId, office.chamberKey) === null
        ) {
          failures.push(`${countryId}: chamber key ${office.chamberKey}`);
        }
      }
    }
    expect(failures).toEqual([]);
  });
});

describe("listCountryOffices", () => {
  it("returns a non-empty, uniquely keyed office list for every registered country", () => {
    for (const countryId of COUNTRY_ORDER) {
      const offices = listCountryOffices(countryId);
      expect(offices.length, countryId).toBeGreaterThan(0);
      const keys = offices.map((o) => o.key);
      expect(new Set(keys).size, `${countryId} has duplicate office keys`).toBe(keys.length);
    }
  });

  it("puts the executive first and sub-national offices last", () => {
    const us = listCountryOffices("US");
    expect(us[0].key).toBe("president");
    const governorIndex = us.findIndex((o) => o.key === "governor");
    const senateIndex = us.findIndex((o) => o.key === "senate");
    expect(governorIndex).toBeGreaterThan(senateIndex);
  });

  it("uses the chamber name as the section heading where one exists", () => {
    const us = listCountryOffices("US");
    expect(us.find((o) => o.key === "senate")?.sectionLabel).toBe(
      COUNTRY_CONFIGS.US.legislature.upperChamber!.name
    );
    expect(us.find((o) => o.key === "house")?.sectionLabel).toBe(
      COUNTRY_CONFIGS.US.legislature.lowerChamber.name
    );
  });

  it("carries chamber seat totals so sections can show contested-of-total", () => {
    const us = listCountryOffices("US");
    expect(us.find((o) => o.key === "house")?.chamberSeats).toBe(
      COUNTRY_CONFIGS.US.legislature.lowerChamber.seats
    );
    // A chamberless office has no seat total to report.
    expect(us.find((o) => o.key === "president")?.chamberSeats).toBeNull();
  });
});

describe("resolveChamberForOffice", () => {
  it("finds lower, upper, and sub-national chambers", () => {
    expect(resolveChamberForOffice("US", "house")?.key).toBe("house");
    expect(resolveChamberForOffice("US", "senate")?.key).toBe("senate");
    expect(resolveChamberForOffice("UK", "regionalCouncil")?.key).toBe("regionalCouncil");
  });

  it("returns null for a chamberless office", () => {
    expect(resolveChamberForOffice("US", "president")).toBeNull();
  });
});
