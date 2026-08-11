import type { CountryId } from "@/lib/constants/countries";

/**
 * Mapping from country to the "stateId" used in collections like statePolicies
 * and governorExecutiveOrders for national-scope rows. US uses "federal" by
 * convention; other countries use "{lowercased-id}_national".
 *
 * Single source of truth — duplicated mappings elsewhere should import this.
 */
export const NATIONAL_POLICY_STATE_IDS: Record<CountryId, string> = {
  US: "federal",
  UK: "uk_national",
  JP: "jp_national",
  DE: "de_national",
  IE: "ie_national",
  BR: "br_national",
  CN: "cn_national",
  NG: "ng_national",
  HU: "hu_national",
  PL: "pl_national",
  RO: "ro_national",
  YU: "yu_national",
  BG: "bg_national",
  UKR: "ukr_national",
  BLR: "blr_national",
  CS: "cs_national",
  BAL: "bal_national",
  RU: "su_national",
  FR: "fr_national",
  IT: "it_national",
  ES: "es_national",
  SE: "se_national",
  TR: "tr_national",
  GR: "gr_national",
  AT: "at_national",
  FI: "fi_national",
  DD: "dd_national",
  SCO: "sco_national",
  WAL: "wal_national",
};

export function getNationalStateId(countryId: CountryId): string {
  return NATIONAL_POLICY_STATE_IDS[countryId];
}
