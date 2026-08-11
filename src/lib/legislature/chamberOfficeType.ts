import { getCountryConfig, type CountryId } from "@/lib/constants/countries";

/**
 * Resolve the office-type key for a given chamber key in a country.
 *
 * Most countries use the chamber key directly as the office type
 * (e.g. US "house" → officeType "house").  China is the exception:
 * the chamber key is "npc" but seated delegates are stored with
 * officeType "npcDelegate".  This helper bridges that gap.
 *
 * Pass `preset` when the country's office/chamber model is era-conditional
 * (e.g. TR 1953 unicameral vs 1979 bicameral).
 */
export function getOfficeTypeForChamber(
  countryId: CountryId,
  chamberKey: string,
  preset?: string
): string {
  const office = getCountryConfig(countryId, preset).officeTypes.find(
    (o) => "chamberKey" in o && o.chamberKey === chamberKey
  );
  return office?.key ?? chamberKey;
}

/**
 * Inverse of {@link getOfficeTypeForChamber}: resolve the chamber key for a
 * given office-type key. China is the only country where these differ —
 * officeType "npcDelegate" maps back to chamber key "npc". For every other
 * country the office key equals the chamber key, so this is the identity.
 *
 * Bills store their origin/current chamber as the *chamber key* (the value
 * read paths filter on), so any code resolving a seated official's chamber
 * from their officeType must round-trip through this helper rather than using
 * the officeType directly.
 */
export function getChamberKeyForOfficeType(
  countryId: CountryId,
  officeType: string,
  preset?: string
): string {
  const office = getCountryConfig(countryId, preset).officeTypes.find((o) => o.key === officeType);
  if (office && "chamberKey" in office && office.chamberKey) {
    return office.chamberKey;
  }
  return officeType;
}

/** Convenience wrapper for the lower chamber. */
export function getLowerChamberOfficeType(countryId: CountryId, preset?: string): string {
  const lowerKey = getCountryConfig(countryId, preset).legislature.lowerChamber.key;
  return getOfficeTypeForChamber(countryId, lowerKey, preset);
}

/** Convenience wrapper for the upper chamber (when present).
 * Returns undefined when the upper chamber has no elected office type mapping
 * (e.g. appointed chambers like UK Lords or CN CPPCC).
 */
export function getUpperChamberOfficeType(
  countryId: CountryId,
  preset?: string
): string | undefined {
  const upperKey = getCountryConfig(countryId, preset).legislature.upperChamber?.key;
  if (!upperKey) return undefined;
  const office = getCountryConfig(countryId, preset).officeTypes.find(
    (o) => "chamberKey" in o && o.chamberKey === upperKey
  );
  return office?.key;
}

/**
 * Both chamber officeTypes for a joint sitting of the legislature — used by
 * head-of-state appointment votes (RU Chairman of the Presidium: the Supreme
 * Soviet elected the Presidium in joint session). Only counts an upper
 * chamber that is actually contested (`upperElectionSystem`); appointed
 * chambers (UK Lords, CN CPPCC) are excluded.
 */
export function getJointSittingOfficeTypes(countryId: CountryId, preset?: string): string[] {
  const config = getCountryConfig(countryId, preset);
  const types = [getLowerChamberOfficeType(countryId, preset)];
  if (config.legislature.upperChamber && config.upperElectionSystem) {
    const upper = getUpperChamberOfficeType(countryId, preset);
    if (upper) types.push(upper);
  }
  return types;
}

/**
 * Returns all office types whose holders are eligible for cabinet
 * appointment in parliamentary systems.
 *
 * For most countries this is the lower + upper chamber office types.
 * For China it is only npcDelegate (no senate equivalent in cabinet).
 */
export function getCabinetEligibleOfficeTypes(countryId: CountryId, preset?: string): string[] {
  const config = getCountryConfig(countryId, preset);
  const types: string[] = [];

  const lower = config.officeTypes.find(
    (o) => "chamberKey" in o && o.chamberKey === config.legislature.lowerChamber.key
  );
  if (lower) types.push(lower.key);

  if (config.legislature.upperChamber) {
    const upper = config.officeTypes.find(
      (o) => "chamberKey" in o && o.chamberKey === config.legislature.upperChamber!.key
    );
    if (upper) types.push(upper.key);
  }

  return types;
}
