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
import { PL_CONTINENT } from "@/lib/countries/pl/geographyFacts";
import { HU_CONTINENT } from "@/lib/countries/hu/geographyFacts";
import { RO_CONTINENT } from "@/lib/countries/ro/geographyFacts";
import { YU_CONTINENT } from "@/lib/countries/yu/geographyFacts";
import { BG_CONTINENT } from "@/lib/countries/bg/geographyFacts";
import { CS_CONTINENT } from "@/lib/countries/cs/geographyFacts";
import { SCO_CONTINENT } from "@/lib/countries/sco/geographyFacts";
import { WAL_CONTINENT } from "@/lib/countries/wal/geographyFacts";
import { BLR_CONTINENT } from "@/lib/countries/blr/geographyFacts";
import { UKR_CONTINENT } from "@/lib/countries/ukr/geographyFacts";
import { BAL_CONTINENT } from "@/lib/countries/bal/geographyFacts";

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
  HU: HU_CONTINENT,
  PL: PL_CONTINENT,
  RO: RO_CONTINENT,
  YU: YU_CONTINENT,
  BG: BG_CONTINENT,
  BLR: BLR_CONTINENT,
  UKR: UKR_CONTINENT,
  CS: CS_CONTINENT,
  BAL: BAL_CONTINENT,
  RU: RU_CONTINENT,
  TR: TR_CONTINENT,
  GR: GR_CONTINENT,
  AT: AT_CONTINENT,
  FI: FI_CONTINENT,
  SCO: SCO_CONTINENT,
  WAL: WAL_CONTINENT,
  NG: NG_CONTINENT,
  JP: JP_CONTINENT,
  CN: CN_CONTINENT,
};
