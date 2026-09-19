import type { CountryId } from "@/lib/constants/countries";
import { JP_ISO_NUMERIC } from "@/lib/countries/jp/geographyFacts";
import { US_ISO_NUMERIC } from "@/lib/countries/us/geographyFacts";
import { UK_ISO_NUMERIC } from "@/lib/countries/uk/geographyFacts";
import { DE_ISO_NUMERIC } from "@/lib/countries/de/geographyFacts";
import { CN_ISO_NUMERIC } from "@/lib/countries/cn/geographyFacts";
import { IE_ISO_NUMERIC } from "@/lib/countries/ie/geographyFacts";
import { RU_ISO_NUMERIC } from "@/lib/countries/ru/geographyFacts";
import { DD_ISO_NUMERIC } from "@/lib/countries/dd/geographyFacts";
import { NG_ISO_NUMERIC } from "@/lib/countries/ng/geographyFacts";
import { BR_ISO_NUMERIC } from "@/lib/countries/br/geographyFacts";
import { FR_ISO_NUMERIC } from "@/lib/countries/fr/geographyFacts";
import { IT_ISO_NUMERIC } from "@/lib/countries/it/geographyFacts";
import { ES_ISO_NUMERIC } from "@/lib/countries/es/geographyFacts";
import { SE_ISO_NUMERIC } from "@/lib/countries/se/geographyFacts";
import { TR_ISO_NUMERIC } from "@/lib/countries/tr/geographyFacts";
import { GR_ISO_NUMERIC } from "@/lib/countries/gr/geographyFacts";
import { AT_ISO_NUMERIC } from "@/lib/countries/at/geographyFacts";
import { FI_ISO_NUMERIC } from "@/lib/countries/fi/geographyFacts";
import { PL_ISO_NUMERIC } from "@/lib/countries/pl/geographyFacts";
import { HU_ISO_NUMERIC } from "@/lib/countries/hu/geographyFacts";
import { RO_ISO_NUMERIC } from "@/lib/countries/ro/geographyFacts";
import { YU_ISO_NUMERIC } from "@/lib/countries/yu/geographyFacts";
import { BG_ISO_NUMERIC } from "@/lib/countries/bg/geographyFacts";
import { CS_ISO_NUMERIC } from "@/lib/countries/cs/geographyFacts";
import { SCO_ISO_NUMERIC } from "@/lib/countries/sco/geographyFacts";
import { WAL_ISO_NUMERIC } from "@/lib/countries/wal/geographyFacts";
import { BLR_ISO_NUMERIC } from "@/lib/countries/blr/geographyFacts";
import { UKR_ISO_NUMERIC } from "@/lib/countries/ukr/geographyFacts";

/** Natural-Earth ISO-numeric (topojson feature id) → in-game CountryId. */
export const ISO_NUMERIC_TO_COUNTRY: Record<string, CountryId> = {
  "840": "US",
  "826": "UK",
  "276": "DE",
  "392": "JP",
  "372": "IE",
  "076": "BR",
  "156": "CN",
  "566": "NG",
  // 1979 Cold-War roster (historical ISO-numeric codes where applicable).
  "348": "HU",
  "616": "PL",
  "642": "RO",
  "890": "YU", // former Yugoslavia
  "100": "BG",
  "112": "BLR",
  "804": "UKR",
  "200": "CS", // former Czechoslovakia
  "643": "RU", // Russia / USSR (one entity; "Soviet Union" in 1979)
  "250": "FR",
  "380": "IT",
  "724": "ES",
  "752": "SE",
  "792": "TR",
  "300": "GR",
  "040": "AT",
  "246": "FI",
  "278": "DD", // former East Germany
};

/** Inverse of {@link ISO_NUMERIC_TO_COUNTRY}. */
export const COUNTRY_TO_ISO_NUMERIC: Record<CountryId, string> = {
  US: US_ISO_NUMERIC,
  UK: UK_ISO_NUMERIC,
  DE: DE_ISO_NUMERIC,
  JP: JP_ISO_NUMERIC,
  IE: IE_ISO_NUMERIC,
  BR: BR_ISO_NUMERIC,
  CN: CN_ISO_NUMERIC,
  NG: NG_ISO_NUMERIC,
  HU: HU_ISO_NUMERIC,
  PL: PL_ISO_NUMERIC,
  RO: RO_ISO_NUMERIC,
  YU: YU_ISO_NUMERIC,
  BG: BG_ISO_NUMERIC,
  BLR: BLR_ISO_NUMERIC,
  UKR: UKR_ISO_NUMERIC,
  CS: CS_ISO_NUMERIC,
  BAL: "", // EE+LV+LT combined — no single ISO-numeric
  RU: RU_ISO_NUMERIC,
  FR: FR_ISO_NUMERIC,
  IT: IT_ISO_NUMERIC,
  ES: ES_ISO_NUMERIC,
  SE: SE_ISO_NUMERIC,
  TR: TR_ISO_NUMERIC,
  GR: GR_ISO_NUMERIC,
  AT: AT_ISO_NUMERIC,
  FI: FI_ISO_NUMERIC,
  DD: DD_ISO_NUMERIC,
  SCO: SCO_ISO_NUMERIC, // shares GB code; not on the commodity map until secession
  WAL: WAL_ISO_NUMERIC, // shares GB code; not on the commodity map until secession
};

/** Resolve a topojson feature id (ISO-numeric string) to a CountryId, or undefined. */
export function isoNumericToCountryId(id: string): CountryId | undefined {
  return ISO_NUMERIC_TO_COUNTRY[id];
}
