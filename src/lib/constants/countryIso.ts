import type { CountryId } from "@/lib/constants/countries";
import { JP_ISO_NUMERIC } from "@/lib/countries/jp/geographyFacts";
import { US_ISO_NUMERIC } from "@/lib/countries/us/geographyFacts";
import { UK_ISO_NUMERIC } from "@/lib/countries/uk/geographyFacts";
import { DE_ISO_NUMERIC } from "@/lib/countries/de/geographyFacts";
import { CN_ISO_NUMERIC } from "@/lib/countries/cn/geographyFacts";
import { IE_ISO_NUMERIC } from "@/lib/countries/ie/geographyFacts";
import { RU_ISO_NUMERIC } from "@/lib/countries/ru/geographyFacts";
import { DD_ISO_NUMERIC } from "@/lib/countries/dd/geographyFacts";

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
  BR: "076",
  CN: CN_ISO_NUMERIC,
  NG: "566",
  HU: "348",
  PL: "616",
  RO: "642",
  YU: "890",
  BG: "100",
  BLR: "112",
  UKR: "804",
  CS: "200",
  BAL: "", // EE+LV+LT combined — no single ISO-numeric
  RU: RU_ISO_NUMERIC,
  FR: "250",
  IT: "380",
  ES: "724",
  SE: "752",
  TR: "792",
  GR: "300",
  AT: "040",
  FI: "246",
  DD: DD_ISO_NUMERIC,
  SCO: "826", // shares GB code; not on the commodity map until secession
  WAL: "826", // shares GB code; not on the commodity map until secession
};

/** Resolve a topojson feature id (ISO-numeric string) to a CountryId, or undefined. */
export function isoNumericToCountryId(id: string): CountryId | undefined {
  return ISO_NUMERIC_TO_COUNTRY[id];
}
