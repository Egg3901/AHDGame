import { ALL_COUNTRY_IDS, COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";

/**
 * Pure race-resolution helpers for the /predict bot route, derived entirely from
 * COUNTRY_CONFIGS so new countries become predictable via config alone — the same
 * data-driven approach the rest of the discord-bot API uses (CORPORATION_TYPES,
 * COUNTRY_ORDER). Previously these were hardcoded maps covering only US/UK/CA/DE/JP,
 * so IE/BR/CN/NG races were rejected with an empty "valid races" list.
 *
 * A "race" is a national, elected legislative chamber. The race value IS the
 * office key — it matches both ElectedOfficial.officeType and Election.electionType
 * — so no separate race→office translation table is needed.
 */

const VALID_COUNTRIES = new Set<string>(ALL_COUNTRY_IDS);

/**
 * Office keys for the national, elected legislative chambers of a country.
 *
 * Included when an office type:
 *  - is tied to a chamber (`chamberKey` set), and
 *  - is national (not `isSubNational` — excludes state senate, Landtag, regional
 *    / local councils, provincial people's congresses), and
 *  - sits in an elected chamber. The lower chamber is always elected; the upper
 *    chamber only when `ChamberConfig.elected === true` (excludes the appointed
 *    UK Lords and DE Bundesrat).
 *
 * Order follows the country's `officeTypes` declaration order.
 */
export function eligibleRaceOfficeKeys(countryId: CountryId): string[] {
  const config = COUNTRY_CONFIGS[countryId];
  if (!config) return [];
  const { upperChamber, lowerChamber } = config.legislature;
  const keys: string[] = [];
  for (const office of config.officeTypes) {
    if (!office.chamberKey || office.isSubNational) continue;
    const isElected =
      office.chamberKey === lowerChamber.key
        ? true
        : office.chamberKey === upperChamber?.key
          ? upperChamber?.elected === true
          : false;
    if (isElected) keys.push(office.key);
  }
  return keys;
}

/** Valid /predict race choices for a country code. Empty for unknown countries. */
export function validRaces(country: string): string[] {
  if (!VALID_COUNTRIES.has(country)) return [];
  return eligibleRaceOfficeKeys(country as CountryId);
}

/**
 * Map country+race to the officeType used in ElectedOfficial records. The race
 * value already equals the office key, so this validates membership and returns
 * the key, or null when the race is not a valid chamber for the country.
 */
export function raceToOfficeType(country: string, race: string): string | null {
  return validRaces(country).includes(race) ? race : null;
}

/**
 * Map country+race to the electionType(s) stored on Election documents.
 *
 * Snap elections for a lower chamber are stored as `snap_${lowerChamberKey}`
 * (e.g. `snap_commons`, `snap_dail`). When the requested race is the country's
 * lower chamber and the country permits snaps, match both the regular and snap
 * election types so an active snap surfaces on /predict like a regular general.
 */
export function raceToElectionTypes(country: string, race: string): string[] | null {
  const base = raceToOfficeType(country, race);
  if (!base) return null;
  const config = COUNTRY_CONFIGS[country as CountryId];
  if (
    config?.lowerElectionSystem.snapElectionsAllowed &&
    race === config.legislature.lowerChamber.key
  ) {
    return [base, `snap_${base}`];
  }
  return [base];
}

/**
 * Display name for the chamber a race targets. Resolves the office's `chamberKey`
 * first because the race value (office key) can differ from the chamber key — e.g.
 * CN `npcDelegate` sits in the `npc` chamber.
 */
export function getChamberName(
  country: string,
  race: string,
  config: (typeof COUNTRY_CONFIGS)[CountryId]
): string {
  const chamberKey = config.officeTypes.find((o) => o.key === race)?.chamberKey ?? race;
  if (config.legislature.upperChamber && chamberKey === config.legislature.upperChamber.key)
    return config.legislature.upperChamber.name;
  if (chamberKey === config.legislature.lowerChamber.key)
    return config.legislature.lowerChamber.name;
  return race.charAt(0).toUpperCase() + race.slice(1);
}
