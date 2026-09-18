import type { CountryId } from "./countries";
import { JP_CONTINENT } from "@/lib/countries/jp/geographyFacts";
import { US_CONTINENT } from "@/lib/countries/us/geographyFacts";
import { UK_CONTINENT } from "@/lib/countries/uk/geographyFacts";
import { DE_CONTINENT } from "@/lib/countries/de/geographyFacts";
import { CN_CONTINENT } from "@/lib/countries/cn/geographyFacts";
import { IE_CONTINENT } from "@/lib/countries/ie/geographyFacts";
import { RU_CONTINENT } from "@/lib/countries/ru/geographyFacts";
import { DD_CONTINENT } from "@/lib/countries/dd/geographyFacts";
import { NG_CONTINENT } from "@/lib/countries/ng/geographyFacts";

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
  US: US_CONTINENT,
  BR: "South America",
  UK: UK_CONTINENT,
  IE: IE_CONTINENT,
  DE: DE_CONTINENT,
  DD: DD_CONTINENT,
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
  RU: RU_CONTINENT,
  TR: "Europe",
  GR: "Europe",
  AT: "Europe",
  FI: "Europe",
  SCO: "Europe",
  WAL: "Europe",
  NG: NG_CONTINENT,
  JP: JP_CONTINENT,
  CN: CN_CONTINENT,
};
