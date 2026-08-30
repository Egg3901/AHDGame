import { describe, it, expect } from "vitest";
import {
  positionForElectionType,
  isMultiSeatMethod,
  isListTierMethod,
  getElectionMethod,
} from "./electionMethod";
import {
  COUNTRY_ORDER,
  getCountryConfig,
  getExecutiveFormationForCountry,
  type CountryId,
} from "@/lib/constants/countries";
import { MULTI_SEAT_TYPES, ELECTION_TYPE_LABEL_MAP } from "@/lib/utils/electionLabels";

describe("positionForElectionType", () => {
  it("maps lower-chamber types (incl. snap variants)", () => {
    for (const t of [
      "house",
      "commons",
      "snap_commons",
      "bundestag",
      "snap_bundestag",
      "shugiin",
      "snap_shugiin",
      "npcDelegate",
      "dail",
      "supremeSoviet",
    ]) {
      expect(positionForElectionType(t)).toBe("lowerChamber");
    }
  });

  it("maps upper-chamber types", () => {
    for (const t of ["senate", "sangiin", "seanad"]) {
      expect(positionForElectionType(t)).toBe("upperChamber");
    }
  });

  it("maps sub-national chambers and executives", () => {
    for (const t of [
      "stateSenate",
      "regionalCouncil",
      "landtag",
      "landAssembly",
      "peoplesCongress",
      "localCouncil",
    ]) {
      expect(positionForElectionType(t)).toBe("subNationalChamber");
    }
    for (const t of ["governor", "ministerPresident"]) {
      expect(positionForElectionType(t)).toBe("subNationalExecutive");
    }
  });

  it("maps executives", () => {
    expect(positionForElectionType("primeMinister")).toBe("headOfGovernment");
    expect(positionForElectionType("chancellor")).toBe("headOfGovernment");
    expect(positionForElectionType("president")).toBe("headOfState");
    expect(positionForElectionType("uachtaran")).toBe("headOfState");
  });

  it("returns undefined for unknown types", () => {
    expect(positionForElectionType("nonexistent")).toBeUndefined();
  });
});

describe("isMultiSeatMethod", () => {
  it("is true only for PR/AMS methods", () => {
    expect(isMultiSeatMethod("pr_hareQuota")).toBe(true);
    expect(isMultiSeatMethod("pr_sainteLague")).toBe(true);
    expect(isMultiSeatMethod("ams")).toBe(true);
    expect(isMultiSeatMethod("fptp")).toBe(false);
    expect(isMultiSeatMethod("electoralCollege")).toBe(false);
    expect(isMultiSeatMethod("parliamentary")).toBe(false);
    expect(isMultiSeatMethod("ceremonial")).toBe(false);
  });
});

describe("isListTierMethod", () => {
  it("is true only for AMS (separate party-list tier)", () => {
    expect(isListTierMethod("ams")).toBe(true);
    expect(isListTierMethod("pr_sainteLague")).toBe(false);
    expect(isListTierMethod("pr_hareQuota")).toBe(false);
    expect(isListTierMethod("fptp")).toBe(false);
    expect(isListTierMethod(undefined)).toBe(false);
  });
});

// (country, electionType) -> expected method. Replicates current resolution
// for every playable-country race. Behavior-accurate snapshot: if a value here
// changes, resolution behavior changed.
const INVENTORY: [CountryId, string, string][] = [
  ["US", "house", "pr_hareQuota"],
  ["US", "senate", "fptp"],
  ["US", "stateSenate", "pr_hareQuota"],
  ["US", "governor", "fptp"],
  ["US", "president", "electoralCollege"],
  ["UK", "commons", "pr_hareQuota"],
  ["UK", "snap_commons", "pr_hareQuota"],
  ["UK", "regionalCouncil", "pr_hareQuota"],
  ["UK", "primeMinister", "parliamentary"],
  ["DE", "bundestag", "ams"],
  ["DE", "snap_bundestag", "ams"],
  ["DE", "landtag", "pr_sainteLague"],
  ["DE", "ministerPresident", "fptp"],
  ["DE", "chancellor", "parliamentary"],
  ["JP", "shugiin", "pr_hareQuota"],
  ["JP", "snap_shugiin", "pr_hareQuota"],
  ["JP", "sangiin", "pr_hareQuota"],
  ["JP", "regionalCouncil", "pr_hareQuota"],
  ["JP", "primeMinister", "parliamentary"],
  ["CN", "npcDelegate", "pr_hareQuota"],
  ["CN", "peoplesCongress", "pr_hareQuota"],
  ["DD", "landAssembly", "pr_hareQuota"],
  ["DD", "governor", "fptp"],
  ["IE", "dail", "pr_hareQuota"],
  ["IE", "seanad", "pr_hareQuota"],
  ["IE", "localCouncil", "pr_hareQuota"],
  ["IE", "uachtaran", "fptp"],
  ["IE", "primeMinister", "parliamentary"],
  // Beta parliamentary lower chambers (#3239)
  ["FR", "assembleeNationale", "pr_hareQuota"],
  ["IT", "cameraDeputati", "pr_hareQuota"],
  ["ES", "congresoDiputados", "pr_hareQuota"],
  ["SE", "riksdag", "pr_hareQuota"],
  ["TR", "milletMeclisi", "pr_hareQuota"],
];

describe("getElectionMethod inventory (replicates current behavior)", () => {
  it.each(INVENTORY)("%s/%s -> %s", (country, type, expected) => {
    expect(getElectionMethod(country, type)).toBe(expected);
  });
});

describe("getElectionMethod is null-safe for legacy undefined countryId", () => {
  // Legacy US election docs carry countryId as undefined at runtime. The
  // resolver's Landtag/Bundestag intercepts call getElectionMethod for EVERY
  // election, so this must return undefined (intercept skips) — never throw.
  it("returns undefined instead of throwing", () => {
    expect(getElectionMethod(undefined, "house")).toBeUndefined();
    expect(getElectionMethod(null, "landtag")).toBeUndefined();
    expect(getElectionMethod("" as never, "bundestag")).toBeUndefined();
  });
});

describe("MULTI_SEAT_TYPES stays consistent with the method map", () => {
  it.each(INVENTORY)("%s/%s multi-seat parity", (country, type) => {
    const method = getElectionMethod(country, type)!;
    expect(MULTI_SEAT_TYPES.has(type)).toBe(isMultiSeatMethod(method));
  });
});

describe("headOfGovernment parliamentary <=> confidence-of-legislature formation", () => {
  it.each(COUNTRY_ORDER)("%s", (id) => {
    const hog = getCountryConfig(id).electionSystems.headOfGovernment;
    const isConfidence = getExecutiveFormationForCountry(id) === "confidence_of_legislature";
    if (hog === "parliamentary") expect(isConfidence).toBe(true);
    if (isConfidence && hog !== undefined) expect(hog).toBe("parliamentary");
  });
});

describe("every labeled election type maps to a position", () => {
  it.each(Object.keys(ELECTION_TYPE_LABEL_MAP))("%s has a position", (type) => {
    expect(positionForElectionType(type)).toBeDefined();
  });
});

describe("every configured position holds a valid method", () => {
  const VALID = new Set([
    "fptp",
    "pr_hareQuota",
    "pr_sainteLague",
    "ams",
    "electoralCollege",
    "parliamentary",
    "ceremonial",
  ]);
  it.each(COUNTRY_ORDER)("%s", (id) => {
    for (const m of Object.values(getCountryConfig(id).electionSystems)) {
      expect(VALID.has(m as string)).toBe(true);
    }
  });
});
