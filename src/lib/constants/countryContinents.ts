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
import { BR_CONTINENT } from "@/lib/countries/br/geographyFacts";
import { FR_CONTINENT } from "@/lib/countries/fr/geographyFacts";
import { IT_CONTINENT } from "@/lib/countries/it/geographyFacts";
import { ES_CONTINENT } from "@/lib/countries/es/geographyFacts";
import { SE_CONTINENT } from "@/lib/countries/se/geographyFacts";
import { TR_CONTINENT } from "@/lib/countries/tr/geographyFacts";
import { GR_CONTINENT } from "@/lib/countries/gr/geographyFacts";
import { AT_CONTINENT } from "@/lib/countries/at/geographyFacts";
import { FI_CONTINENT } from "@/lib/countries/fi/geographyFacts";

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
  BR: BR_CONTINENT,
  UK: UK_CONTINENT,
  IE: IE_CONTINENT,
  DE: DE_CONTINENT,
  DD: DD_CONTINENT,
  FR: FR_CONTINENT,
  IT: IT_CONTINENT,
  ES: ES_CONTINENT,
  SE: SE_CONTINENT,
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
  TR: TR_CONTINENT,
  GR: GR_CONTINENT,
  AT: AT_CONTINENT,
  FI: FI_CONTINENT,
  SCO: "Europe",
  WAL: "Europe",
  NG: NG_CONTINENT,
  JP: JP_CONTINENT,
  CN: CN_CONTINENT,
};
