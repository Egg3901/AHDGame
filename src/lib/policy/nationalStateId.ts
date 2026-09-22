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
import { PL_ECONOMY } from "@/lib/countries/pl/economy";
import { HU_ECONOMY } from "@/lib/countries/hu/economy";
import { RO_ECONOMY } from "@/lib/countries/ro/economy";
import { YU_ECONOMY } from "@/lib/countries/yu/economy";
import { BG_ECONOMY } from "@/lib/countries/bg/economy";
import { CS_ECONOMY } from "@/lib/countries/cs/economy";
import { SCO_ECONOMY } from "@/lib/countries/sco/economy";
import { WAL_ECONOMY } from "@/lib/countries/wal/economy";
import { BLR_ECONOMY } from "@/lib/countries/blr/economy";
import { UKR_ECONOMY } from "@/lib/countries/ukr/economy";
import { BAL_ECONOMY } from "@/lib/countries/bal/economy";

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
  HU: HU_ECONOMY.nationalPolicyStateId,
  PL: PL_ECONOMY.nationalPolicyStateId,
  RO: RO_ECONOMY.nationalPolicyStateId,
  YU: YU_ECONOMY.nationalPolicyStateId,
  BG: BG_ECONOMY.nationalPolicyStateId,
  UKR: UKR_ECONOMY.nationalPolicyStateId,
  BLR: BLR_ECONOMY.nationalPolicyStateId,
  CS: CS_ECONOMY.nationalPolicyStateId,
  BAL: BAL_ECONOMY.nationalPolicyStateId,
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
  SCO: SCO_ECONOMY.nationalPolicyStateId,
  WAL: WAL_ECONOMY.nationalPolicyStateId,
};

export function getNationalStateId(countryId: CountryId): string {
  return NATIONAL_POLICY_STATE_IDS[countryId];
}
