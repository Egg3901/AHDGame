import { JP_MAP_ANCHOR } from "@/lib/countries/jp/geographyFacts";
import { US_MAP_ANCHOR } from "@/lib/countries/us/geographyFacts";
import { UK_MAP_ANCHOR } from "@/lib/countries/uk/geographyFacts";
import { DE_MAP_ANCHOR } from "@/lib/countries/de/geographyFacts";
import { CN_MAP_ANCHOR } from "@/lib/countries/cn/geographyFacts";
import { IE_MAP_ANCHOR } from "@/lib/countries/ie/geographyFacts";
import { RU_MAP_ANCHOR } from "@/lib/countries/ru/geographyFacts";
import { DD_MAP_ANCHOR } from "@/lib/countries/dd/geographyFacts";

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
  FR: [2.3, 46.6],
  IT: [12.5, 42.8],
  ES: [-3.7, 40.4],
  SE: [18.6, 60.1],
  FI: [25.7, 61.9],
  AT: [14.6, 47.6],
  GR: [21.8, 39.1],
  PL: [19.1, 52.1],
  CS: [15.5, 49.8],
  HU: [19.5, 47.2],
  RO: [24.9, 45.9],
  BG: [25.5, 42.7],
  YU: [20.5, 44.0],
  TR: [35.2, 39.0],
  UKR: [31.0, 49.0],
  BLR: [27.9, 53.5],
  BAL: [24.5, 57.0],
  CN: CN_MAP_ANCHOR,
  JP: JP_MAP_ANCHOR,
  NVN: [105.85, 21.03],
  SVN: [106.7, 10.78],
  BR: [-51.9, -14.2],
  NG: [8.7, 9.1],
};

/** The orienting point for a country, or null when there is none. */
export function anchorOf(countryId: string): [number, number] | null {
  return COUNTRY_ANCHOR[countryId] ?? null;
}
