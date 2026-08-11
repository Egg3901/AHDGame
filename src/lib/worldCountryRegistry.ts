import { COUNTRY_CONFIGS, COUNTRY_ORDER, type CountryId } from "./constants/countries";

export type WorldMapStatus = "active" | "beta" | "planned";

export interface WorldMappedCountry {
  label: string;
  status: WorldMapStatus;
  path?: string;
}

export interface WorldRoadmapCountry {
  id: string;
  name: string;
  region: string;
  featured?: boolean;
}

/**
 * ISO 3166-1 numeric → CountryId for configured world-map countries. The base
 * world map is modern (Natural-Earth countries-110m), so only countries whose
 * territory still maps to a present-day feature can be drawn on the globe.
 *
 * 1979 countries that still exist with ~the same borders map cleanly (FR/IT/ES/
 * SE/TR + HU/PL/RO/BG/BY). The USSR is drawn on the Russian-Federation feature
 * (643) as the best modern proxy for the superpower's core. The dissolved states
 * with no single modern feature draw via region shards instead of this map:
 * Yugoslavia and Czechoslovakia union their region shards over their successor
 * states' features (see regionManifest baseCountryIds), and East Germany renders
 * via the germany + east-berlin shards over unified Germany's 276. Only the
 * combined Baltic SSRs remain undrawable on the world globe.
 */
export const WORLD_COUNTRY_ISO_TO_ID: Record<string, CountryId> = {
  "840": "US",
  "826": "UK",
  "276": "DE",
  "392": "JP",
  "372": "IE",
  "076": "BR",
  "156": "CN",
  "566": "NG",
  // 1979 countries that still exist on a modern map.
  "250": "FR",
  "380": "IT",
  "724": "ES",
  "752": "SE",
  "792": "TR",
  "300": "GR",
  "040": "AT",
  "246": "FI",
  "348": "HU",
  "616": "PL",
  "642": "RO",
  "100": "BG",
  "112": "BLR",
  "804": "UKR",
  // The Baltic country is three modern features, so unlike every other row this
  // is a many-to-one mapping. COUNTRY_TO_ISO_NUMERIC has no single value to give
  // it, which is why the world map reads its geometry from here.
  "233": "BAL", // Estonia
  "428": "BAL", // Latvia
  "440": "BAL", // Lithuania
  // The Russian-Federation landmass is RU (modern Russia) in every era. In the 1953
  // and 1979 presets the soviet-union shard overlays it (the USSR's 17 macro-regions
  // union into one blob, covering RU + the union republics by feature id while the
  // overlay owns them — see regionManifest + MapSVGContent biCovered); in presets
  // where the USSR isn't seeded no overlay renders and RU shows through as Russia.
  // The republics (Ukraine, Kazakhstan, the Caucasus, Central Asia, Moldova,
  // Byelorussia, the Baltics) are NOT mapped to RU here — they revert to themselves
  // whenever the SU overlay isn't covering them.
  "643": "RU",
};

export const WORLD_MAPPED_COUNTRIES: Record<string, WorldMappedCountry> = Object.fromEntries(
  Object.entries(WORLD_COUNTRY_ISO_TO_ID).map(([isoId, countryId]) => {
    const config = COUNTRY_CONFIGS[countryId];
    return [
      isoId,
      {
        label: config.name,
        status: config.status === "coming-soon" ? "planned" : config.status,
        path: config.overviewPath,
      },
    ];
  })
) as Record<string, WorldMappedCountry>;

/** Countries not yet in COUNTRY_CONFIGS — shown as roadmap teaser cards only. */
export const WORLD_ROADMAP_COUNTRIES: WorldRoadmapCountry[] = [];

export const WORLD_COUNTRY_IDS = COUNTRY_ORDER;
