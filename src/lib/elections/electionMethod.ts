import {
  getCountryConfig,
  type CountryId,
  type ElectionMethod,
  type ElectionPosition,
} from "@/lib/constants/countries";

/**
 * Canonical electionType → position map. Snap variants share their base type's
 * position. Single source of truth for "which configurable slot does this
 * election type fill". Keep in sync with ELECTION_TYPE_LABEL_MAP coverage
 * (asserted by electionMethod.test.ts position-coverage test).
 */
export const POSITION_BY_ELECTION_TYPE: Readonly<Record<string, ElectionPosition>> = {
  // lower chambers
  house: "lowerChamber",
  commons: "lowerChamber",
  snap_commons: "lowerChamber",
  bundestag: "lowerChamber",
  snap_bundestag: "lowerChamber",
  shugiin: "lowerChamber",
  snap_shugiin: "lowerChamber",
  npcDelegate: "lowerChamber",
  supremeSovietDeputy: "lowerChamber",
  volkskammerDeputy: "lowerChamber",
  // Eastern bloc Tier-1 unicameral assemblies (DD pattern).
  sejm: "lowerChamber",
  chamberOfThePeople: "lowerChamber",
  nationalAssembly: "lowerChamber",
  grandNationalAssembly: "lowerChamber",
  federalAssembly: "lowerChamber",
  dail: "lowerChamber",
  // Beta-country parliamentary lower chambers (FR/IT/ES/SE/TR): resolve with
  // the country's configured lowerChamber method (pr_hareQuota for all five).
  assembleeNationale: "lowerChamber",
  cameraDeputati: "lowerChamber",
  congresoDiputados: "lowerChamber",
  riksdag: "lowerChamber",
  milletMeclisi: "lowerChamber",
  // upper chambers
  senate: "upperChamber",
  sangiin: "upperChamber",
  seanad: "upperChamber",
  nationalitiesDeputy: "upperChamber",
  // sub-national chambers
  stateSenate: "subNationalChamber",
  regionalCouncil: "subNationalChamber",
  landtag: "subNationalChamber",
  peoplesCongress: "subNationalChamber",
  republicSupremeSoviet: "subNationalChamber",
  localCouncil: "subNationalChamber",
  // sub-national executives
  governor: "subNationalExecutive",
  special_governor: "subNationalExecutive", // governor by-election — same seat as `governor`
  ministerPresident: "subNationalExecutive",
  // national executives
  primeMinister: "headOfGovernment",
  chancellor: "headOfGovernment", // DE Bundeskanzler — selected via parliamentary formation
  president: "headOfState",
  uachtaran: "headOfState",
};

export function positionForElectionType(electionType: string): ElectionPosition | undefined {
  return POSITION_BY_ELECTION_TYPE[electionType];
}

/** Methods that allocate multiple seats across a multi-member constituency. */
export function isMultiSeatMethod(m: ElectionMethod): boolean {
  return m === "pr_hareQuota" || m === "pr_sainteLague" || m === "ams";
}

/** Methods that carry a separate party-list tier NOT captured by region
 *  `houseDistricts` (AMS only — the list seats live outside constituencies). */
export function isListTierMethod(m: ElectionMethod | undefined): boolean {
  return m === "ams";
}

/**
 * The configured election method for a (country, electionType). Returns the
 * static config default today; a future in-game layer can consult per-game
 * state here before falling back to config. Returns undefined when the country
 * does not configure that position (caller decides the fallback).
 *
 * `countryId` is intentionally widened to accept `null | undefined`: legacy US
 * election documents predate the `countryId` field and carry it as undefined at
 * runtime (see the `election.countryId ?? "US"` fallbacks in generalResolution).
 * The resolver's method-dispatch intercepts call this for EVERY election before
 * those fallbacks, so an undefined here must return undefined (intercept skips)
 * rather than throwing on `getCountryConfig(undefined).electionSystems`.
 */
export function getElectionMethod(
  countryId: CountryId | null | undefined,
  electionType: string
): ElectionMethod | undefined {
  if (!countryId) return undefined;
  const position = positionForElectionType(electionType);
  if (!position) return undefined;
  return getCountryConfig(countryId).electionSystems[position];
}
