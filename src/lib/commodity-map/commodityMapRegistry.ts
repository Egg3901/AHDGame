/**
 * Registry mapping country codes to their regional SVG map components/assets.
 *
 * This provides a config-based approach so adding new countries doesn't
 * require touching the UI components — just add an entry here.
 */

import type { CountryId } from "@/lib/constants/countries";
import { JP_GEOGRAPHY } from "@/lib/countries/jp/geography";
import { US_MAP_REGISTRY } from "@/lib/countries/us/geographyFacts";
import { UK_MAP_REGISTRY } from "@/lib/countries/uk/geographyFacts";
import { DE_MAP_REGISTRY } from "@/lib/countries/de/data/deMapConfig";
import { CN_MAP_REGISTRY } from "@/lib/countries/cn/geographyFacts";
import { IE_MAP_REGISTRY } from "@/lib/countries/ie/geographyFacts";
import { RU_MAP_REGISTRY } from "@/lib/countries/ru/geographyFacts";
import { DD_MAP_REGISTRY } from "@/lib/countries/dd/geographyFacts";
import { NG_MAP_REGISTRY } from "@/lib/countries/ng/geographyFacts";
import { BR_MAP_REGISTRY } from "@/lib/countries/br/geographyFacts";
import { FR_MAP_REGISTRY } from "@/lib/countries/fr/geographyFacts";
import { IT_MAP_REGISTRY } from "@/lib/countries/it/geographyFacts";
import { ES_MAP_REGISTRY } from "@/lib/countries/es/geographyFacts";
import { SE_MAP_REGISTRY } from "@/lib/countries/se/geographyFacts";
import { TR_MAP_REGISTRY } from "@/lib/countries/tr/geographyFacts";
import { GR_MAP_REGISTRY } from "@/lib/countries/gr/geographyFacts";
import { AT_MAP_REGISTRY } from "@/lib/countries/at/geographyFacts";
import { FI_MAP_REGISTRY } from "@/lib/countries/fi/geographyFacts";
import { PL_MAP_REGISTRY } from "@/lib/countries/pl/geographyFacts";
import { HU_MAP_REGISTRY } from "@/lib/countries/hu/geographyFacts";
import { RO_MAP_REGISTRY } from "@/lib/countries/ro/geographyFacts";
import { YU_MAP_REGISTRY } from "@/lib/countries/yu/geographyFacts";
import { BG_MAP_REGISTRY } from "@/lib/countries/bg/geographyFacts";
import { CS_MAP_REGISTRY } from "@/lib/countries/cs/geographyFacts";
import { SCO_MAP_REGISTRY } from "@/lib/countries/sco/geographyFacts";
import { WAL_MAP_REGISTRY } from "@/lib/countries/wal/geographyFacts";
import { BLR_MAP_REGISTRY } from "@/lib/countries/blr/geographyFacts";
import { UKR_MAP_REGISTRY } from "@/lib/countries/ukr/geographyFacts";
import { BAL_MAP_REGISTRY } from "@/lib/countries/bal/geographyFacts";

export interface CountryMapConfig {
  /** Country ID */
  countryId: CountryId;
  /** Display name */
  name: string;
  /** Path to the country's overview page */
  overviewPath: string;
  /** Path to the country's existing map page */
  mapPath: string;
  /** Whether a sub-national SVG map is available */
  hasRegionMap: boolean;
  /** GeoJSON/TopoJSON URL for the subnational map (if available) */
  geoUrl?: string;
  /**
   * Map from feature ID in the geo file to our internal state/region ID.
   * For US: FIPS code → state abbreviation.
   * For UK: NUTS1 code → region code.
   * For JP: prefecture JIS code (string "1"–"47") → region code.
   * For DE: RS code ("01"–"16") → Bundesland code.
   */
  featureIdToStateId?: Record<string, string>;
  /**
   * Optional custom extractor for the feature ID string from a geo feature.
   * Defaults to: String(geo.id ?? geo.properties?.id ?? geo.properties?.RS ?? "")
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  featureIdExtractor?: (geo: any) => string;
  /** Projection type to use for the subnational map */
  projection?: "albers-usa" | "mercator";
  /** Mercator projection center [longitude, latitude] (overrides per-country default) */
  projectionCenter?: [number, number];
  /** Mercator projection scale (overrides per-country default) */
  projectionScale?: number;
}

/**
 * RS (Regionalschlüssel) → German Bundesland code.
 * Both zero-padded ("01") and plain ("1") keys are included since
 * different GeoJSON sources use different ID formats.
 */

export const COUNTRY_MAP_REGISTRY: Record<CountryId, CountryMapConfig> = {
  US: US_MAP_REGISTRY,
  UK: UK_MAP_REGISTRY,
  DE: DE_MAP_REGISTRY,
  JP: JP_GEOGRAPHY.mapRegistry,
  IE: IE_MAP_REGISTRY,
  BR: BR_MAP_REGISTRY,
  CN: CN_MAP_REGISTRY,
  NG: NG_MAP_REGISTRY,
  HU: HU_MAP_REGISTRY,
  PL: PL_MAP_REGISTRY,
  RO: RO_MAP_REGISTRY,
  YU: YU_MAP_REGISTRY,
  BG: BG_MAP_REGISTRY,
  BLR: BLR_MAP_REGISTRY,
  UKR: UKR_MAP_REGISTRY,
  CS: CS_MAP_REGISTRY,
  BAL: BAL_MAP_REGISTRY,
  RU: RU_MAP_REGISTRY,
  FR: FR_MAP_REGISTRY,
  IT: IT_MAP_REGISTRY,
  ES: ES_MAP_REGISTRY,
  SE: SE_MAP_REGISTRY,
  GR: GR_MAP_REGISTRY,
  TR: TR_MAP_REGISTRY,
  AT: AT_MAP_REGISTRY,
  FI: FI_MAP_REGISTRY,
  DD: DD_MAP_REGISTRY,
  // Latent — region map (public/sco-regions.json) wired in at SP3.
  SCO: SCO_MAP_REGISTRY,
  // Latent — region map (public/wal-regions.json) wired in at SP3.
  WAL: WAL_MAP_REGISTRY,
};

/**
 * Get the map config for a given country, or null if not found.
 */
export function getCountryMapConfig(countryId: CountryId): CountryMapConfig | null {
  return COUNTRY_MAP_REGISTRY[countryId] ?? null;
}
