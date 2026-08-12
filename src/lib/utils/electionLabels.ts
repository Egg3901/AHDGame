/**
 * Shared election-type label utilities.
 *
 * Centralises all "election type → display string" mappings so they don't
 * drift across the server-side lib/ modules and the API routes.
 *
 * Import `formatElectionTypeLabel` from here rather than duplicating the map.
 * The same map is exported as a plain Record for callers that need to do a
 * direct lookup without a function call overhead.
 */

import type { CountryId } from "@/lib/constants/countries";
import { getOfficeTypeForChamber } from "@/lib/legislature/chamberOfficeType";

/** Human-readable label for each election type. Fallback to the raw string. */
export const ELECTION_TYPE_LABEL_MAP: Record<string, string> = {
  // US offices
  senate: "Senate",
  house: "House",
  stateSenate: "State Senate",
  governor: "Governor",
  special_governor: "Governor By-Election",
  president: "President",
  // UK offices
  commons: "Parliamentary",
  snap_commons: "Snap Commons",
  primeMinister: "Prime Minister",
  regionalCouncil: "Regional Council",
  // DE offices
  bundestag: "Bundestag",
  snap_bundestag: "Snap Bundestag",
  landtag: "Landtag",
  ministerPresident: "Minister-President",
  chancellor: "Chancellor",
  // JP offices
  shugiin: "Shūgiin",
  sangiin: "Sangiin",
  snap_shugiin: "Snap Shūgiin",
  // CN offices
  npcDelegate: "NPC Delegate",
  peoplesCongress: "People's Congress",
  // RU (Soviet Union) offices
  supremeSovietDeputy: "Supreme Soviet",
  nationalitiesDeputy: "Soviet of Nationalities",
  republicSupremeSoviet: "Republic Supreme Soviet",
  // DD (East Germany) offices
  volkskammerDeputy: "Volkskammer",
  landAssembly: "Landtag",
  // Eastern bloc Tier-1 unicameral assemblies
  sejm: "Sejm",
  chamberOfThePeople: "Chamber of the People",
  nationalAssembly: "National Assembly",
  grandNationalAssembly: "Grand National Assembly",
  federalAssembly: "Federal Assembly",
  // IE offices
  dail: "Dáil Éireann",
  seanad: "Seanad Éireann",
  uachtaran: "Uachtarán na hÉireann",
  localCouncil: "Local Council",
  // Beta-country parliamentary lower chambers (FR/IT/ES/SE/TR)
  assembleeNationale: "National Assembly",
  cameraDeputati: "Chamber of Deputies",
  congresoDiputados: "Congress of Deputies",
  riksdag: "Riksdag",
  milletMeclisi: "Grand National Assembly",
};

/** Short labels used in win/loss notifications (space-constrained contexts). */
export const ELECTION_TYPE_SHORT_LABEL: Record<string, string> = {
  senate: "Senate",
  house: "House",
  stateSenate: "State Senate",
  governor: "Governor",
  special_governor: "Gov. By-Election",
  president: "President",
  commons: "Parliamentary",
  snap_commons: "Snap Commons",
  primeMinister: "Prime Minister",
  regionalCouncil: "Regional Council",
  bundestag: "Bundestag",
  snap_bundestag: "Snap Bundestag",
  landtag: "Landtag",
  ministerPresident: "MP",
  // JP offices
  shugiin: "Shūgiin",
  sangiin: "Sangiin",
  snap_shugiin: "Snap Shūgiin",
  // CN offices
  npcDelegate: "NPC Delegate",
  npc: "National People's Congress",
  peoplesCongress: "People's Congress",
  // RU (Soviet Union) offices
  supremeSovietDeputy: "Supreme Soviet",
  nationalitiesDeputy: "Nationalities",
  // DD (East Germany) offices
  volkskammerDeputy: "Volkskammer",
  landAssembly: "Landtag",
  republicSupremeSoviet: "Republic Soviet",
  // Eastern bloc Tier-1 unicameral assemblies
  sejm: "Sejm",
  chamberOfThePeople: "Chamber of the People",
  nationalAssembly: "National Assembly",
  grandNationalAssembly: "Grand National Assembly",
  federalAssembly: "Federal Assembly",
  // IE offices
  dail: "Dáil",
  seanad: "Seanad",
  uachtaran: "Uachtarán",
  localCouncil: "Local Council",
  // Beta-country parliamentary lower chambers (FR/IT/ES/SE/TR)
  assembleeNationale: "Assemblée",
  cameraDeputati: "Camera",
  congresoDiputados: "Congreso",
  riksdag: "Riksdag",
  milletMeclisi: "Meclis",
};

/**
 * Per-country label overrides for shared/generic election types. Consulted
 * before ELECTION_TYPE_LABEL_MAP so a country can rename a generic type
 * (e.g. NG "house" → "House of Representatives") without a new election type.
 */
export const COUNTRY_ELECTION_TYPE_LABELS: Partial<Record<CountryId, Record<string, string>>> = {
  NG: {
    house: "House of Representatives",
    regionalCouncil: "State House of Assembly",
    // senate override omitted — equals the canonical "Senate".
  },
};

/** Returns a display label for an election type, falling back to the raw string. */
export function formatElectionTypeLabel(electionType: string, countryId?: CountryId): string {
  const override = countryId ? COUNTRY_ELECTION_TYPE_LABELS[countryId]?.[electionType] : undefined;
  return override ?? ELECTION_TYPE_LABEL_MAP[electionType] ?? electionType;
}

/**
 * Election types that allocate multiple seats proportionally (Largest Remainder).
 * Used by: electionEngine, electionResolution, elections API route,
 *          updatePoliticianPageOnElection, admin backfill.
 */
export const MULTI_SEAT_TYPES: ReadonlySet<string> = new Set([
  "house",
  "stateSenate",
  "commons",
  "snap_commons",
  "regionalCouncil",
  "bundestag",
  "snap_bundestag",
  "shugiin",
  "snap_shugiin",
  "sangiin",
  "landtag",
  "npcDelegate",
  "peoplesCongress",
  // IE multi-seat (PR-STV) chambers: Dáil and Seanad per region, plus
  // Local Council per region. Uachtarán is single-seat nationwide so it
  // stays out of this set.
  "dail",
  "seanad",
  "localCouncil",
  // Beta-country parliamentary lower chambers (FR/IT/ES/SE/TR): multi-seat
  // regional PR (Largest Remainder), seats per region = the region doc's
  // `houseDistricts` (issue #3239).
  "assembleeNationale",
  "cameraDeputati",
  "congresoDiputados",
  "riksdag",
  "milletMeclisi",
  // AT/FI/GR lower chambers (unfrozen in the 1953 preflight pass): multi-seat
  // regional PR like their FR/IT/ES siblings. Without this their first
  // resolved election runs the single-winner path, which deletes the region's
  // whole seeded delegation and seats one winner (the BR #3252 collapse).
  "nationalrat",
  "eduskunta",
  "vouli",
  // Office-type keys for the same chambers (after officeKeyForElectionType).
  "deputy",
  "senator",
  "member",
  "procurador",
  // Upper-chamber election types for beta parliaments.
  "senat",
  "senato",
  "senado",
  // BR/NG lower chamber ("Chamber of Deputies" / "House of Representatives"):
  // multi-member proportional constituencies. Without this it resolved
  // single-seat, collapsing the whole chamber to one winner (issue #3252).
  "chamber",
  // RU Supreme Soviet chambers + republic soviets: multi-seat regional PR
  // (Largest Remainder). Without this they'd resolve single-seat, collapsing
  // each delegation to one winner (the BR #3252 failure mode).
  "supremeSovietDeputy",
  "nationalitiesDeputy",
  "republicSupremeSoviet",
  // Eastern bloc Tier-1 unicameral assemblies (DD multi-seat regional pattern).
  "sejm",
  "chamberOfThePeople",
  "nationalAssembly",
  "grandNationalAssembly",
  "federalAssembly",
  "sejmDeputy",
  "assemblyDeputy",
  "assemblyDelegate",
  // DD Volkskammer regional races (5 bloc parties: SED/CDU/LDPD/NDPD/DBD):
  // multi-seat regional PR like the Sejm/People's Chamber family above.
  // Without this, `allocateSeats` fell through to the single-winner branch
  // and seated exactly one deputy per region regardless of `totalSeats` —
  // the founding cycle's six races (totalSeats summing to 500) seated 6
  // deputies total instead of 500 (issue #3896).
  "volkskammerDeputy",
  // DD Land assemblies — same multi-seat PR shape; without this each Land
  // would collapse to a single Landtag deputy (ticket #1044).
  "landAssembly",
]);

/**
 * Map a snap-election type to its regular counterpart for office-type use.
 *
 * Winners of `snap_commons` become regular Commons MPs — they hold
 * `officeType: "commons"`, not `"snap_commons"`. The snap designation lives
 * on the ELECTION record only; the resulting SEAT is identical to a
 * regular-cycle seat. Same for JP snap_shugiin → shugiin.
 *
 * Used by: generalResolution (winner assignment + stale-office sweep),
 * NPP electionEntry (incumbent detection).
 */
const SNAP_TO_REGULAR: Readonly<Record<string, string>> = {
  snap_commons: "commons",
  snap_bundestag: "bundestag",
  snap_shugiin: "shugiin",
};

/**
 * Beta-parliament chamber keys → default (modern) office-type keys.
 *
 * FR/IT/ES/SE/TR elections are keyed by the legislature chamber key
 * (`cameraDeputati`, `riksdag`, …) but seated officials must use the
 * `officeTypes[].key` (`deputy` / `member` / `senator`). Econ-tier seeding
 * and `backfillMissingSeats` already write the office-type key via
 * `getLowerChamberOfficeType`; elections that stored the chamber key left
 * BOTH sets of officials in place (IT audit: deputy 630 + senato 315 = 945
 * vs Camera totalSeats 630).
 *
 * Prefer {@link officeKeyForElectionType} with `countryId` (+ optional preset)
 * so era overlays (ES 1953 `procurador`) resolve correctly.
 */
const CHAMBER_KEY_TO_OFFICE_TYPE: Readonly<Record<string, string>> = {
  assembleeNationale: "deputy",
  cameraDeputati: "deputy",
  congresoDiputados: "deputy",
  riksdag: "member",
  milletMeclisi: "deputy",
  senat: "senator",
  senato: "senator",
  senado: "senator",
  // Eastern bloc — prefer getOfficeTypeForChamber when countryId is known;
  // these are fallbacks for chamber-key election types.
  sejm: "sejmDeputy",
  chamberOfThePeople: "assemblyDeputy",
  nationalAssembly: "assemblyDelegate",
  grandNationalAssembly: "assemblyDeputy",
  federalAssembly: "assemblyDelegate",
};

/**
 * Map an electionType to the officeType key stored on electedOfficials.
 * Snap types collapse to their regular counterpart; beta chamber keys map to
 * office-type keys. When `countryId` is known, prefer the country/era office
 * table (ES 1953 Cortes → procurador, not deputy).
 */
export function officeKeyForElectionType(
  electionType: string,
  countryId?: CountryId,
  preset?: string
): string {
  if (SNAP_TO_REGULAR[electionType]) return SNAP_TO_REGULAR[electionType];
  if (countryId) {
    const resolved = getOfficeTypeForChamber(countryId, electionType, preset);
    if (resolved !== electionType) return resolved;
  }
  return CHAMBER_KEY_TO_OFFICE_TYPE[electionType] ?? electionType;
}

/**
 * MongoDB filter that matches US-only state documents.
 *
 * Includes both documents explicitly tagged `countryId: "US"` and legacy
 * documents that predate the `countryId` field (which are implicitly US).
 *
 * Usage:
 *   db.collection("states").find(US_STATE_FILTER)
 */
export const US_STATE_FILTER: { $or: [{ countryId: "US" }, { countryId: { $exists: false } }] } = {
  $or: [{ countryId: "US" }, { countryId: { $exists: false } }],
};
