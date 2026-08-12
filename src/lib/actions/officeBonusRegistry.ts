import {
  COUNTRY_CONFIGS,
  getOfficeTypeConfig,
  type CountryId,
  type OfficeTypeConfig,
} from "@/lib/constants/countries";

/**
 * Two office vocabularies exist in this codebase:
 *
 * 1. `gameConfig.officeActionBonus` — a flat, hand-maintained map of office-type
 *    key → per-turn action bonus. It was written for the US and only ever grew
 *    to cover UK / DE / JP / CN / CA keys.
 * 2. `COUNTRY_CONFIGS[*].officeTypes[*].actionBonus` — the per-country office
 *    registry, which carries an `actionBonus` for EVERY office in EVERY country.
 *
 * The turn engine only ever read (1), so every office key that exists solely in
 * (2) — `volkskammerDeputy`, `supremeSovietDeputy`, `sejmDeputy`, `dail`,
 * `deputy`, `member`, … — silently resolved to a 0 bonus. Non-US legislators
 * received no per-turn generation for holding their seat (ticket #974).
 *
 * These helpers make (2) the fallback for (1): an explicit `gameConfig` entry
 * still wins (so admins keep their override), but an office the config has never
 * heard of now resolves against the country registry instead of returning 0.
 */

/**
 * The office registry entry for `officeType`.
 *
 * When `countryId` is known the lookup is exact. Otherwise the key is resolved
 * across every country; keys shared by several countries (`deputy`, `senator`,
 * `governor`) resolve to the entry with the highest `actionBonus` so an unknown
 * country never silently downgrades a holder.
 */
function findOfficeConfig(officeType: string, countryId?: CountryId): OfficeTypeConfig | undefined {
  if (countryId) {
    const exact = getOfficeTypeConfig(countryId, officeType);
    if (exact) return exact;
  }
  let best: OfficeTypeConfig | undefined;
  for (const config of Object.values(COUNTRY_CONFIGS)) {
    for (const office of config.officeTypes) {
      if (office.key !== officeType) continue;
      if (!best || office.actionBonus > best.actionBonus) best = office;
    }
  }
  return best;
}

/**
 * Per-turn action bonus for holding `officeType`.
 *
 * `gameConfig.officeActionBonus` is authoritative when it names the key; the
 * country office registry is the fallback. Returns 0 for keys neither source
 * knows (e.g. a retired office type still on an old character document).
 */
export function resolveOfficeActionBonusForType(
  officeType: string | undefined,
  officeActionBonus: Record<string, number> | undefined,
  countryId?: CountryId
): number {
  if (!officeType) return 0;
  const configured = officeActionBonus?.[officeType];
  if (typeof configured === "number") return configured;
  return findOfficeConfig(officeType, countryId)?.actionBonus ?? 0;
}

/**
 * Per-turn national-influence bonus tiers by office. Explicit entries preserve
 * the hand-tuned values the turn engine has always used:
 * 2.5 (executive head), 2.0 (VP), 1.0 (rank-and-file legislators, governors,
 * cabinet members).
 */
const OFFICE_NI_BONUS_OVERRIDES: Partial<Record<string, number>> = {
  president: 2.5,
  primeMinister: 2.5,
  chancellor: 2.5,
  vicePresident: 2.0,
  senate: 1.0,
  house: 1.0,
  stateSenate: 1.0,
  governor: 1.0,
  usCabinet: 1.0,
  commons: 1.0,
  regionalCouncil: 1.0,
  ukCabinet: 1.0,
  bundestag: 1.0,
  ministerPresident: 1.0,
  deCabinet: 1.0,
  parliamentaryCabinet: 1.0,
};

/** NI tier for a national executive office not named in the override table. */
const NATIONAL_EXECUTIVE_NI_BONUS = 2.5;
/** NI tier for any other seated office (legislators, sub-national offices). */
const SEATED_OFFICE_NI_BONUS = 1.0;

/**
 * Per-turn national-influence bonus for holding `officeType`.
 *
 * Offices named in {@link OFFICE_NI_BONUS_OVERRIDES} keep their tuned tier. Any
 * other office known to the country registry falls into the generic tiers rather
 * than resolving to 0 — this is what a Volkskammer deputy, a Supreme Soviet
 * deputy or a Dáil TD was missing.
 */
export function resolveOfficeNiBonus(
  officeType: string | undefined,
  countryId?: CountryId
): number {
  if (!officeType) return 0;
  const override = OFFICE_NI_BONUS_OVERRIDES[officeType];
  if (typeof override === "number") return override;
  const office = findOfficeConfig(officeType, countryId);
  if (!office) return 0;
  if (office.isExecutive && !office.isSubNational) return NATIONAL_EXECUTIVE_NI_BONUS;
  return SEATED_OFFICE_NI_BONUS;
}
