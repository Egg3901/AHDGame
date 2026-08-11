/**
 * Registry mapping country codes to their regional SVG map components/assets.
 *
 * This provides a config-based approach so adding new countries doesn't
 * require touching the UI components — just add an entry here.
 */

import type { CountryId } from "@/lib/constants/countries";
import { CDN_GEO } from "@/lib/images/cdnUrls";

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

/** FIPS → US state abbreviation (for the US TopoJSON) */
const FIPS_TO_STATE: Record<string, string> = {
  "01": "AL",
  "02": "AK",
  "04": "AZ",
  "05": "AR",
  "06": "CA",
  "08": "CO",
  "09": "CT",
  "10": "DE",
  "11": "DC",
  "12": "FL",
  "13": "GA",
  "15": "HI",
  "16": "ID",
  "17": "IL",
  "18": "IN",
  "19": "IA",
  "20": "KS",
  "21": "KY",
  "22": "LA",
  "23": "ME",
  "24": "MD",
  "25": "MA",
  "26": "MI",
  "27": "MN",
  "28": "MS",
  "29": "MO",
  "30": "MT",
  "31": "NE",
  "32": "NV",
  "33": "NH",
  "34": "NJ",
  "35": "NM",
  "36": "NY",
  "37": "NC",
  "38": "ND",
  "39": "OH",
  "40": "OK",
  "41": "OR",
  "42": "PA",
  "44": "RI",
  "45": "SC",
  "46": "SD",
  "47": "TN",
  "48": "TX",
  "49": "UT",
  "50": "VT",
  "51": "VA",
  "53": "WA",
  "54": "WV",
  "55": "WI",
  "56": "WY",
};

/**
 * JIS X 0401 prefecture code (as string "1"–"47") → our 8-region internal ID.
 * Multiple prefectures share a region — the map colors each prefecture by its region's data.
 */
const JIS_TO_JP_REGION: Record<string, string> = {
  // Hokkaido
  "1": "HOK",
  // Tohoku
  "2": "TOH",
  "3": "TOH",
  "4": "TOH",
  "5": "TOH",
  "6": "TOH",
  "7": "TOH",
  // Kanto
  "8": "KAN",
  "9": "KAN",
  "10": "KAN",
  "11": "KAN",
  "12": "KAN",
  "13": "KAN",
  "14": "KAN",
  // Chubu
  "15": "CHU",
  "16": "CHU",
  "17": "CHU",
  "18": "CHU",
  "19": "CHU",
  "20": "CHU",
  "21": "CHU",
  "22": "CHU",
  "23": "CHU",
  // Kansai
  "24": "KNS",
  "25": "KNS",
  "26": "KNS",
  "27": "KNS",
  "28": "KNS",
  "29": "KNS",
  "30": "KNS",
  // Chugoku
  "31": "CGK",
  "32": "CGK",
  "33": "CGK",
  "34": "CGK",
  "35": "CGK",
  // Shikoku
  "36": "SHI",
  "37": "SHI",
  "38": "SHI",
  "39": "SHI",
  // Kyushu & Okinawa
  "40": "KYU",
  "41": "KYU",
  "42": "KYU",
  "43": "KYU",
  "44": "KYU",
  "45": "KYU",
  "46": "KYU",
  "47": "KYU",
};

/**
 * RS (Regionalschlüssel) → German Bundesland code.
 * Both zero-padded ("01") and plain ("1") keys are included since
 * different GeoJSON sources use different ID formats.
 */
const RS_TO_DE_STATE: Record<string, string> = {
  "01": "SH",
  "1": "SH", // Schleswig-Holstein
  "02": "HH",
  "2": "HH", // Hamburg
  "03": "NI",
  "3": "NI", // Niedersachsen
  "04": "BRE",
  "4": "BRE", // Bremen
  "05": "NW",
  "5": "NW", // Nordrhein-Westfalen
  "06": "HE",
  "6": "HE", // Hessen
  "07": "RP",
  "7": "RP", // Rheinland-Pfalz
  "08": "BW",
  "8": "BW", // Baden-Württemberg
  "09": "BY",
  "9": "BY", // Bayern
  "10": "SL", // Saarland
  "11": "BE", // Berlin
  "12": "BB", // Brandenburg
  "13": "MV", // Mecklenburg-Vorpommern
  "14": "SN", // Sachsen
  "15": "ST", // Sachsen-Anhalt
  "16": "TH", // Thüringen
};

/** NUTS1 → UK region code */
const NUTS_TO_REGION: Record<string, string> = {
  UKC: "NEE",
  UKD: "NWE",
  UKE: "YHU",
  UKF: "EMI",
  UKG: "WMI",
  UKH: "EAE",
  UKI: "LON",
  UKJ: "SEE",
  UKK: "SWE",
  UKL: "WAL",
  UKM: "SCO",
  UKN: "NIR",
};

export const COUNTRY_MAP_REGISTRY: Record<CountryId, CountryMapConfig> = {
  US: {
    countryId: "US",
    name: "United States",
    overviewPath: "/country/us",
    mapPath: "/country/us/map",
    hasRegionMap: true,
    geoUrl: "https://cdn.jsdelivr.net/npm/us-atlas@3/states-10m.json",
    featureIdToStateId: FIPS_TO_STATE,
    projection: "albers-usa",
  },
  UK: {
    countryId: "UK",
    name: "United Kingdom",
    overviewPath: "/country/uk",
    mapPath: "/country/uk/map",
    hasRegionMap: true,
    geoUrl: CDN_GEO.ukNuts1,
    featureIdToStateId: NUTS_TO_REGION,
    projection: "mercator",
    projectionCenter: [-2, 55.5],
    projectionScale: 1800,
  },
  DE: {
    countryId: "DE",
    name: "Germany",
    overviewPath: "/country/de",
    mapPath: "/country/de/map",
    hasRegionMap: true,
    // isellsoap/deutschlandGeoJSON features: properties.RS = "01"–"16" (Regionalschlüssel).
    // Use a custom extractor so we always get the RS code regardless of what geo.id contains.
    geoUrl:
      "https://cdn.jsdelivr.net/gh/isellsoap/deutschlandGeoJSON@main/2_bundeslaender/4_niedrig.geo.json",
    featureIdToStateId: RS_TO_DE_STATE,
    featureIdExtractor: (geo) => String(geo.properties?.RS ?? ""),
    projection: "mercator",
    projectionCenter: [10.5, 51.2],
    projectionScale: 2200,
  },
  JP: {
    countryId: "JP",
    name: "Japan",
    overviewPath: "/country/jp",
    mapPath: "/country/jp/map",
    hasRegionMap: true,
    // Prefecture-level GeoJSON; featureIdToStateId aggregates all 47 prefectures into 8 regions.
    // Feature IDs come from geo.properties.id (JIS X 0401 numeric code, 1–47).
    geoUrl: "https://cdn.jsdelivr.net/gh/dataofjapan/land@master/japan.geojson",
    featureIdToStateId: JIS_TO_JP_REGION,
    projection: "mercator",
    projectionCenter: [136, 36],
    projectionScale: 1300,
  },
  IE: {
    countryId: "IE",
    name: "Ireland",
    overviewPath: "/country/ie",
    mapPath: "/country/ie/map",
    hasRegionMap: false,
  },
  BR: {
    countryId: "BR",
    name: "Brazil",
    overviewPath: "/country/br",
    mapPath: "/country/br/map",
    hasRegionMap: false,
  },
  CN: {
    countryId: "CN",
    name: "China",
    overviewPath: "/country/cn",
    mapPath: "/country/cn/map",
    hasRegionMap: false,
  },
  NG: {
    countryId: "NG",
    name: "Nigeria",
    overviewPath: "/country/ng",
    mapPath: "/country/ng/map",
    hasRegionMap: false,
  },
  HU: {
    countryId: "HU",
    name: "Hungary",
    overviewPath: "/country/hu",
    mapPath: "/country/hu/map",
    hasRegionMap: false,
  },
  PL: {
    countryId: "PL",
    name: "Poland",
    overviewPath: "/country/pl",
    mapPath: "/country/pl/map",
    hasRegionMap: false,
  },
  RO: {
    countryId: "RO",
    name: "Romania",
    overviewPath: "/country/ro",
    mapPath: "/country/ro/map",
    hasRegionMap: false,
  },
  YU: {
    countryId: "YU",
    name: "Yugoslavia",
    overviewPath: "/country/yu",
    mapPath: "/country/yu/map",
    hasRegionMap: false,
  },
  BG: {
    countryId: "BG",
    name: "Bulgaria",
    overviewPath: "/country/bg",
    mapPath: "/country/bg/map",
    hasRegionMap: false,
  },
  BLR: {
    countryId: "BLR",
    name: "Belarus",
    overviewPath: "/country/blr",
    mapPath: "/country/blr/map",
    hasRegionMap: false,
  },
  UKR: {
    countryId: "UKR",
    name: "Ukraine",
    overviewPath: "/country/ua",
    mapPath: "/country/ua/map",
    hasRegionMap: false,
  },
  CS: {
    countryId: "CS",
    name: "Czechoslovakia",
    overviewPath: "/country/cs",
    mapPath: "/country/cs/map",
    hasRegionMap: false,
  },
  BAL: {
    countryId: "BAL",
    name: "Baltic Republics",
    overviewPath: "/country/bal",
    mapPath: "/country/bal/map",
    hasRegionMap: false,
  },
  RU: {
    countryId: "RU",
    name: "Russia",
    overviewPath: "/country/ru",
    mapPath: "/country/ru/map",
    hasRegionMap: false,
  },
  FR: {
    countryId: "FR",
    name: "France",
    overviewPath: "/country/fr",
    mapPath: "/country/fr/map",
    hasRegionMap: false,
  },
  IT: {
    countryId: "IT",
    name: "Italy",
    overviewPath: "/country/it",
    mapPath: "/country/it/map",
    hasRegionMap: false,
  },
  ES: {
    countryId: "ES",
    name: "Spain",
    overviewPath: "/country/es",
    mapPath: "/country/es/map",
    hasRegionMap: false,
  },
  SE: {
    countryId: "SE",
    name: "Sweden",
    overviewPath: "/country/se",
    mapPath: "/country/se/map",
    hasRegionMap: false,
  },
  GR: {
    countryId: "GR",
    name: "Greece",
    overviewPath: "/country/gr",
    mapPath: "/country/gr/map",
    hasRegionMap: false,
  },
  TR: {
    countryId: "TR",
    name: "Turkey",
    overviewPath: "/country/tr",
    mapPath: "/country/tr/map",
    hasRegionMap: false,
  },
  AT: {
    countryId: "AT",
    name: "Austria",
    overviewPath: "/country/at",
    mapPath: "/country/at/map",
    hasRegionMap: false,
  },
  FI: {
    countryId: "FI",
    name: "Finland",
    overviewPath: "/country/fi",
    mapPath: "/country/fi/map",
    hasRegionMap: false,
  },
  DD: {
    countryId: "DD",
    name: "East Germany",
    overviewPath: "/country/dd",
    mapPath: "/country/dd/map",
    hasRegionMap: false,
  },
  // Latent — region map (public/sco-regions.json) wired in at SP3.
  SCO: {
    countryId: "SCO",
    name: "Scotland",
    overviewPath: "/country/sco",
    mapPath: "/country/sco/map",
    hasRegionMap: false,
  },
  // Latent — region map (public/wal-regions.json) wired in at SP3.
  WAL: {
    countryId: "WAL",
    name: "Wales",
    overviewPath: "/country/wal",
    mapPath: "/country/wal/map",
    hasRegionMap: false,
  },
};

/**
 * Get the map config for a given country, or null if not found.
 */
export function getCountryMapConfig(countryId: CountryId): CountryMapConfig | null {
  return COUNTRY_MAP_REGISTRY[countryId] ?? null;
}
