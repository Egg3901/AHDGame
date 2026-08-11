import type { CountryId } from "./countries";

export type Continent =
  "North America" | "South America" | "Europe" | "Africa" | "Asia" | "Oceania";

export const CONTINENT_ORDER: readonly Continent[] = [
  "North America",
  "South America",
  "Europe",
  "Africa",
  "Asia",
  "Oceania",
];

/**
 * The continent each country sorts under in admin views. Transcontinental
 * states (the USSR/Russia, Turkey) follow the game's Cold-War European framing.
 * Oceania has no registered country yet, so its tab shows an empty state until
 * one is added.
 */
export const COUNTRY_CONTINENT: Record<CountryId, Continent> = {
  US: "North America",
  BR: "South America",
  UK: "Europe",
  IE: "Europe",
  DE: "Europe",
  DD: "Europe",
  FR: "Europe",
  IT: "Europe",
  ES: "Europe",
  SE: "Europe",
  HU: "Europe",
  PL: "Europe",
  RO: "Europe",
  YU: "Europe",
  BG: "Europe",
  BLR: "Europe",
  UKR: "Europe",
  CS: "Europe",
  BAL: "Europe",
  RU: "Europe",
  TR: "Europe",
  GR: "Europe",
  AT: "Europe",
  FI: "Europe",
  SCO: "Europe",
  WAL: "Europe",
  NG: "Africa",
  JP: "Asia",
  CN: "Asia",
};
