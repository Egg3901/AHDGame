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
import { PL_MAP_ANCHOR } from "@/lib/countries/pl/geographyFacts";
import { HU_MAP_ANCHOR } from "@/lib/countries/hu/geographyFacts";
import { RO_MAP_ANCHOR } from "@/lib/countries/ro/geographyFacts";
import { YU_MAP_ANCHOR } from "@/lib/countries/yu/geographyFacts";
import { BG_MAP_ANCHOR } from "@/lib/countries/bg/geographyFacts";
import { CS_MAP_ANCHOR } from "@/lib/countries/cs/geographyFacts";
import { SCO_MAP_ANCHOR } from "@/lib/countries/sco/geographyFacts";
import { WAL_MAP_ANCHOR } from "@/lib/countries/wal/geographyFacts";
import { BLR_MAP_ANCHOR } from "@/lib/countries/blr/geographyFacts";
import { UKR_MAP_ANCHOR } from "@/lib/countries/ukr/geographyFacts";
import { BAL_MAP_ANCHOR } from "@/lib/countries/bal/geographyFacts";

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
  SCO: SCO_MAP_ANCHOR,
  WAL: WAL_MAP_ANCHOR,
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
  PL: PL_MAP_ANCHOR,
  CS: CS_MAP_ANCHOR,
  HU: HU_MAP_ANCHOR,
  RO: RO_MAP_ANCHOR,
  BG: BG_MAP_ANCHOR,
  YU: YU_MAP_ANCHOR,
  TR: TR_MAP_ANCHOR,
  UKR: UKR_MAP_ANCHOR,
  BLR: BLR_MAP_ANCHOR,
  BAL: BAL_MAP_ANCHOR,
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
