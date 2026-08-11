import type { CountryId } from "@/lib/constants/countries";

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
  US: "840",
  UK: "826",
  DE: "276",
  JP: "392",
  IE: "372",
  BR: "076",
  CN: "156",
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
  RU: "643",
  FR: "250",
  IT: "380",
  ES: "724",
  SE: "752",
  TR: "792",
  GR: "300",
  AT: "040",
  FI: "246",
  DD: "278",
  SCO: "826", // shares GB code; not on the commodity map until secession
  WAL: "826", // shares GB code; not on the commodity map until secession
};

/** Resolve a topojson feature id (ISO-numeric string) to a CountryId, or undefined. */
export function isoNumericToCountryId(id: string): CountryId | undefined {
  return ISO_NUMERIC_TO_COUNTRY[id];
}
