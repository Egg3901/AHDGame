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
 * When the holder's country is known and its registry defines the office, the
 * registry value wins. `gameConfig.officeActionBonus` is keyed by bare office
 * name across every country, so letting it win gave the same key's value to
 * unrelated offices: every ceremonial `president` drew the US president's +4,
 * and CN/RU `premier` drew the Canadian premier's +2. The config map remains
 * the source for keys the country registry does not define (cabinet keys,
 * retired offices) and for callers that do not know the country. An admin
 * override for one country's office uses a `"<countryId>:<officeKey>"` key,
 * which wins over everything.
 */
export function resolveOfficeActionBonusForType(
  officeType: string | undefined,
  officeActionBonus: Record<string, number> | undefined,
  countryId?: CountryId
): number {
  if (!officeType) return 0;
  if (countryId) {
    const scoped = officeActionBonus?.[`${countryId}:${officeType}`];
    if (typeof scoped === "number") return scoped;
    const exact = getOfficeTypeConfig(countryId, officeType);
    if (exact) return exact.actionBonus;
  }
  const configured = officeActionBonus?.[officeType];
  if (typeof configured === "number") return configured;
  return findOfficeConfig(officeType, countryId)?.actionBonus ?? 0;
}

/** NI tier for a national head of government or executive head of state. */
export const NATIONAL_EXECUTIVE_NI_BONUS = 2.5;
/** NI tier for a deputy national executive (vice president, tánaiste). */
export const DEPUTY_EXECUTIVE_NI_BONUS = 2.0;
/** NI tier for a confirmed cabinet member or a sub-national executive. */
export const CABINET_NI_BONUS = 1.5;
/** NI tier for an acting cabinet member, who was never confirmed. */
export const ACTING_CABINET_NI_BONUS = 0.75;
/** NI tier for a ceremonial head of state. */
export const CEREMONIAL_HEAD_OF_STATE_NI_BONUS = 1.0;
/** NI tier for a national legislator. */
export const NATIONAL_LEGISLATOR_NI_BONUS = 1.0;
/** NI tier for a sub-national legislator. */
export const SUBNATIONAL_LEGISLATOR_NI_BONUS = 0.5;

/** Office keys that are not in any country registry but carry an NI tier. */
const OFFICE_NI_BONUS_OVERRIDES: Partial<Record<string, number>> = {
  vicePresident: DEPUTY_EXECUTIVE_NI_BONUS,
  tanaiste: DEPUTY_EXECUTIVE_NI_BONUS,
  usCabinet: CABINET_NI_BONUS,
  ukCabinet: CABINET_NI_BONUS,
  deCabinet: CABINET_NI_BONUS,
  parliamentaryCabinet: CABINET_NI_BONUS,
};

/** Sub-national executive office keys (governors, ministers-president). */
const SUBNATIONAL_EXECUTIVE_KEYS = new Set(["governor", "ministerPresident"]);

/**
 * Per-turn national-influence bonus for holding `officeType`, derived from the
 * holder's country registry entry:
 *   2.5 national head of government or executive head of state
 *   2.0 deputy national executive
 *   1.5 cabinet, sub-national executive
 *   1.0 ceremonial head of state, national legislator
 *   0.5 sub-national legislator
 * A head of state whose registry action bonus is below an executive's (4) is
 * ceremonial. Cabinet AP is resolved separately; acting cabinet members are
 * downgraded by the position resolver.
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
  if (office.isHeadOfState && office.actionBonus < 4) return CEREMONIAL_HEAD_OF_STATE_NI_BONUS;
  if (office.isSubNational) {
    return office.isExecutive || SUBNATIONAL_EXECUTIVE_KEYS.has(office.key)
      ? CABINET_NI_BONUS
      : SUBNATIONAL_LEGISLATOR_NI_BONUS;
  }
  if (office.isExecutive) return NATIONAL_EXECUTIVE_NI_BONUS;
  return NATIONAL_LEGISLATOR_NI_BONUS;
}
