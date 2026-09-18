import type { CountryId } from "@/lib/constants/countries";
import { JP_ECONOMY } from "@/lib/countries/jp/economy";
import { US_ECONOMY } from "@/lib/countries/us/economy";
import { UK_ECONOMY } from "@/lib/countries/uk/economy";
import { DE_ECONOMY } from "@/lib/countries/de/economy";
import { CN_ECONOMY } from "@/lib/countries/cn/economy";
import { IE_ECONOMY } from "@/lib/countries/ie/economy";
import { RU_ECONOMY } from "@/lib/countries/ru/economy";
import { DD_ECONOMY } from "@/lib/countries/dd/economy";
import { NG_ECONOMY } from "@/lib/countries/ng/economy";
import { BR_ECONOMY } from "@/lib/countries/br/economy";
import { FR_ECONOMY } from "@/lib/countries/fr/economy";
import { IT_ECONOMY } from "@/lib/countries/it/economy";
import { ES_ECONOMY } from "@/lib/countries/es/economy";
import { SE_ECONOMY } from "@/lib/countries/se/economy";
import { TR_ECONOMY } from "@/lib/countries/tr/economy";
import { GR_ECONOMY } from "@/lib/countries/gr/economy";
import { AT_ECONOMY } from "@/lib/countries/at/economy";
import { FI_ECONOMY } from "@/lib/countries/fi/economy";

/**
 * Mapping from country to the "stateId" used in collections like statePolicies
 * and governorExecutiveOrders for national-scope rows. US uses "federal" by
 * convention; other countries use "{lowercased-id}_national".
 *
 * Single source of truth — duplicated mappings elsewhere should import this.
 */
export const NATIONAL_POLICY_STATE_IDS: Record<CountryId, string> = {
  US: US_ECONOMY.nationalPolicyStateId,
  UK: UK_ECONOMY.nationalPolicyStateId,
  JP: JP_ECONOMY.nationalPolicyStateId,
  DE: DE_ECONOMY.nationalPolicyStateId,
  IE: IE_ECONOMY.nationalPolicyStateId,
  BR: BR_ECONOMY.nationalPolicyStateId,
  CN: CN_ECONOMY.nationalPolicyStateId,
  NG: NG_ECONOMY.nationalPolicyStateId,
  HU: "hu_national",
  PL: "pl_national",
  RO: "ro_national",
  YU: "yu_national",
  BG: "bg_national",
  UKR: "ukr_national",
  BLR: "blr_national",
  CS: "cs_national",
  BAL: "bal_national",
  RU: RU_ECONOMY.nationalPolicyStateId,
  FR: FR_ECONOMY.nationalPolicyStateId,
  IT: IT_ECONOMY.nationalPolicyStateId,
  ES: ES_ECONOMY.nationalPolicyStateId,
  SE: SE_ECONOMY.nationalPolicyStateId,
  TR: TR_ECONOMY.nationalPolicyStateId,
  GR: GR_ECONOMY.nationalPolicyStateId,
  AT: AT_ECONOMY.nationalPolicyStateId,
  FI: FI_ECONOMY.nationalPolicyStateId,
  DD: DD_ECONOMY.nationalPolicyStateId,
  SCO: "sco_national",
  WAL: "wal_national",
};

export function getNationalStateId(countryId: CountryId): string {
  return NATIONAL_POLICY_STATE_IDS[countryId];
}
