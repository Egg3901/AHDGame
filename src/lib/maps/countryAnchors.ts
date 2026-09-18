import { JP_MAP_ANCHOR } from "@/lib/countries/jp/geographyFacts";
import { US_MAP_ANCHOR } from "@/lib/countries/us/geographyFacts";
import { UK_MAP_ANCHOR } from "@/lib/countries/uk/geographyFacts";
import { DE_MAP_ANCHOR } from "@/lib/countries/de/geographyFacts";
import { CN_MAP_ANCHOR } from "@/lib/countries/cn/geographyFacts";
import { IE_MAP_ANCHOR } from "@/lib/countries/ie/geographyFacts";
import { RU_MAP_ANCHOR } from "@/lib/countries/ru/geographyFacts";
import { DD_MAP_ANCHOR } from "@/lib/countries/dd/geographyFacts";
import { NG_MAP_ANCHOR } from "@/lib/countries/ng/geographyFacts";
import { BR_MAP_ANCHOR } from "@/lib/countries/br/geographyFacts";
import { FR_MAP_ANCHOR } from "@/lib/countries/fr/geographyFacts";
import { IT_MAP_ANCHOR } from "@/lib/countries/it/geographyFacts";
import { ES_MAP_ANCHOR } from "@/lib/countries/es/geographyFacts";
import { SE_MAP_ANCHOR } from "@/lib/countries/se/geographyFacts";
import { TR_MAP_ANCHOR } from "@/lib/countries/tr/geographyFacts";
import { GR_MAP_ANCHOR } from "@/lib/countries/gr/geographyFacts";
import { AT_MAP_ANCHOR } from "@/lib/countries/at/geographyFacts";
import { FI_MAP_ANCHOR } from "@/lib/countries/fi/geographyFacts";

/**
 * A rough interior lon/lat point per country, used to ORIENT a front: an invasion
 * shades the host's regions nearest the invader first. Approximate on purpose —
 * this decides a sort order and nothing else. A country absent here falls back to a
 * periphery-inward advance (see orderFeatures in frontGeometry.ts).
 *
 * Same spirit as the COUNTRY_TO_MAP_NAME bridge table in
 * src/app/world/conflicts/_coldwar/regionOverlayBridge.ts.
 */
export const COUNTRY_ANCHOR: Record<string, [number, number]> = {
  US: US_MAP_ANCHOR,
  UK: UK_MAP_ANCHOR,
  IE: IE_MAP_ANCHOR,
  SCO: [-4.2, 56.8],
  WAL: [-3.8, 52.3],
  RU: RU_MAP_ANCHOR,
  DD: DD_MAP_ANCHOR,
  DE: DE_MAP_ANCHOR,
  FR: FR_MAP_ANCHOR,
  IT: IT_MAP_ANCHOR,
  ES: ES_MAP_ANCHOR,
  SE: SE_MAP_ANCHOR,
  FI: FI_MAP_ANCHOR,
  AT: AT_MAP_ANCHOR,
  GR: GR_MAP_ANCHOR,
  PL: [19.1, 52.1],
  CS: [15.5, 49.8],
  HU: [19.5, 47.2],
  RO: [24.9, 45.9],
  BG: [25.5, 42.7],
  YU: [20.5, 44.0],
  TR: TR_MAP_ANCHOR,
  UKR: [31.0, 49.0],
  BLR: [27.9, 53.5],
  BAL: [24.5, 57.0],
  CN: CN_MAP_ANCHOR,
  JP: JP_MAP_ANCHOR,
  NVN: [105.85, 21.03],
  SVN: [106.7, 10.78],
  BR: BR_MAP_ANCHOR,
  NG: NG_MAP_ANCHOR,
};

/** The orienting point for a country, or null when there is none. */
export function anchorOf(countryId: string): [number, number] | null {
  return COUNTRY_ANCHOR[countryId] ?? null;
}
