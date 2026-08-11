import {
  getCountryConfig,
  getRegionalExecutiveOfficeKey,
  type CountryId,
} from "@/lib/constants/countries";
import {
  getLowerChamberOfficeType,
  getUpperChamberOfficeType,
  getOfficeTypeForChamber,
} from "./chamberOfficeType";

/** One election type a country can broadcast results for. */
export interface BroadcastElectionType {
  /** Matches `elections.electionType` / `ElectedOfficial.officeType`. */
  id: string;
  /** Human-readable label for admin UI buttons. */
  label: string;
}

/**
 * An election method that is actually contested at the ballot box.
 * "parliamentary" (confidence-based) and "ceremonial" (appointed/hereditary)
 * produce no election result to broadcast.
 */
function isContested(method: string | undefined): boolean {
  return !!method && method !== "ceremonial" && method !== "parliamentary";
}

/**
 * Election types whose results a country broadcasts to Discord.
 *
 * Popularly-elected offices only. Heads of government are excluded across the
 * board: they differ per country (primeMinister / chancellor / taoiseach /
 * premier) and every one of them emerges from legislative confidence rather
 * than a ballot, so there is no result to post.
 *
 * `preset` is NOT optional in practice — chamber models are era-conditional
 * (FR loses its directly-elected president in 1953, ES becomes the Francoist
 * Cortes, TR is unicameral), so callers must pass the active preset.
 *
 * Chamber keys are resolved to office-type keys via chamberOfficeType.ts.
 * The two diverge for most of the roster (CN npc -> npcDelegate, HU
 * nationalAssembly -> assemblyDelegate, DD volkskammer -> volkskammerDeputy),
 * and elections key on the office type.
 */
export function getBroadcastElectionTypes(
  countryId: CountryId,
  preset?: string
): BroadcastElectionType[] {
  const config = getCountryConfig(countryId, preset);
  const { electionSystems, officeTypes } = config;
  const ids: string[] = [];

  // 1. Directly-elected head of state. When the office fuses head of state and
  //    head of government (US President), no officeType carries isHeadOfState,
  //    so fall back to the national executive office.
  if (isContested(electionSystems.headOfState)) {
    const headOfState = officeTypes.find((o) => o.isHeadOfState);
    if (headOfState) {
      ids.push(headOfState.key);
    } else {
      const executive = officeTypes.find((o) => o.isExecutive && !o.isSubNational);
      if (executive) ids.push(executive.key);
    }
  }

  // 2. Upper chamber. Returns undefined for appointed chambers (UK Lords,
  //    DE Bundesrat, CN CPPCC, IE Seanad) — the correct guard.
  const upper = getUpperChamberOfficeType(countryId, preset);
  if (upper) ids.push(upper);

  // 3. Lower chamber — always present.
  ids.push(getLowerChamberOfficeType(countryId, preset));

  // 4. Sub-national chamber.
  const subNationalKey = config.subNationalChamber?.key;
  if (subNationalKey) ids.push(getOfficeTypeForChamber(countryId, subNationalKey, preset));

  // 5. Sub-national executive. Gate on electionSystems, NOT on the presence of
  //    a `governor` office type — UK recycles that key for its devolved First
  //    Ministers without declaring a subNationalExecutive election system.
  if (isContested(electionSystems.subNationalExecutive)) {
    ids.push(getRegionalExecutiveOfficeKey(countryId));
  }

  const seen = new Set<string>();
  const out: BroadcastElectionType[] = [];
  for (const id of ids) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const office = officeTypes.find((o) => o.key === id);
    out.push({ id, label: office?.label ?? id });
  }
  return out;
}
