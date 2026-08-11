import { BRITISH_ISLES_GEO_URL, BRITISH_ISLES_REGION_CODES } from "./britishIslesGeometry";
import { GERMANY_GEO_URL, GERMANY_REGION_CODES } from "./germanyGeometry";
import { BRAZIL_GEO_URL, BR_REGION_CODES } from "./brazilGeometry";
import { CHINA_GEO_URL, CN_REGION_CODES } from "./chinaGeometry";
import { JAPAN_GEO_URL, JP_REGION_CODES } from "./japanGeometry";
import { USA_GEO_URL, US_REGION_CODES } from "./usaGeometry";
import { RU_GEO_URL, RU_REGION_CODES } from "./ruGeometry";
import { DD_GEO_URL, DD_SHARD_CODES } from "./ddGeometry";
import { NIGERIA_GEO_URL, NG_REGION_CODES } from "./nigeriaGeometry";
import { TR_GEO_URL, TR_REGION_CODES } from "./trGeometry";
import { GR_GEO_URL, GR_REGION_CODES } from "./grGeometry";
import { AT_GEO_URL, AT_REGION_CODES } from "./atGeometry";
import { FI_GEO_URL, FI_REGION_CODES } from "./fiGeometry";
import { IT_GEO_URL, IT_REGION_CODES } from "./itGeometry";
import { FR_GEO_URL, FR_REGION_CODES } from "./frGeometry";
import { ES_GEO_URL, ES_REGION_CODES } from "./esGeometry";
import { SE_GEO_URL, SE_REGION_CODES } from "./seGeometry";
import { YU_GEO_URL, YU_REGION_CODES } from "./yuGeometry";
import { CS_GEO_URL, CS_REGION_CODES } from "./csGeometry";
import { BG_GEO_URL, BG_REGION_CODES } from "./bgGeometry";
import { HU_GEO_URL, HU_REGION_CODES } from "./huGeometry";
import { PL_GEO_URL, PL_REGION_CODES } from "./plGeometry";
import { RO_GEO_URL, RO_REGION_CODES } from "./roGeometry";
import { UA_GEO_URL, UA_REGION_CODES } from "./uaGeometry";
import { BLR_GEO_URL, BLR_REGION_CODES } from "./blrGeometry";
import { BAL_GEO_URL, BAL_REGION_CODES } from "./balGeometry";

export interface RegionShard {
  /** Stable area identity/dedup key (e.g. "british-isles", "china"). */
  area: string;
  /** Public URL of the regionCode-tagged GeoJSON shard. */
  url: string;
  /** The region codes whose geometry lives in this shard (each === a states._id). */
  codes: readonly string[];
  /**
   * The base `countries-110m` features this shard's geometry occupies — hidden
   * while the shard overlays, so a country that ACQUIRES foreign regions (France
   * gaining German Länder) keeps its own homeland polygon, which no shard redraws.
   * British Isles spans two base countries (UK + IE).
   *
   * Each entry is either a game countryId (e.g. "DE", matched via the feature's
   * WORLD_COUNTRY_ISO_TO_ID mapping) OR a raw countries-110m feature id (e.g. "804"
   * Ukraine) for territory the shard covers that has no game country of its own
   * (the USSR's union republics). MapSVGContent's biCovered checks both.
   */
  baseCountryIds: readonly string[];
  /**
   * Whether the /world map renders this shard's detailed geometry (regions unioned
   * per owner into one blob). Default true. Set false for a shard whose regions
   * won't union cleanly (digitized with gaps / non-shared borders); that country
   * keeps its clean base `countries-110m` polygon until the shard is rebuilt as a
   * shared-border topology. (All current shards union cleanly — Brazil was rebuilt
   * via scripts/maps/build-brazil-geo.mjs.)
   */
  worldOverlay?: boolean;
}

/**
 * The global region geometry, split into one shard per geographic area. The union
 * of all shards' codes is globally unique (enforced by regionManifest.test.ts).
 * Add a shard here when a new country's regionCode-tagged geometry is built.
 */
export const REGION_SHARDS: readonly RegionShard[] = [
  {
    area: "british-isles",
    url: BRITISH_ISLES_GEO_URL,
    codes: BRITISH_ISLES_REGION_CODES,
    baseCountryIds: ["UK", "IE"],
  },
  { area: "germany", url: GERMANY_GEO_URL, codes: GERMANY_REGION_CODES, baseCountryIds: ["DE"] },
  // East Berlin (`BEO`) — DD's one region with no germany-shard shape (BE is
  // West Berlin; Brandenburg carries Berlin as an enclave hole). The world
  // overlay already folds BE onto Brandenburg's owner, so this shard is
  // nation-map only.
  {
    area: "east-berlin",
    url: DD_GEO_URL,
    codes: DD_SHARD_CODES,
    baseCountryIds: ["DE"],
    worldOverlay: false,
  },
  { area: "brazil", url: BRAZIL_GEO_URL, codes: BR_REGION_CODES, baseCountryIds: ["BR"] },
  // China references the modern shard; the pre-handover variant is the same code
  // set (era-selected at render), so one manifest entry covers both.
  { area: "china", url: CHINA_GEO_URL, codes: CN_REGION_CODES, baseCountryIds: ["CN"] },
  { area: "japan", url: JAPAN_GEO_URL, codes: JP_REGION_CODES, baseCountryIds: ["JP"] },
  // Nigeria's six geopolitical zones; unioned per owner on the world map.
  {
    area: "nigeria",
    url: NIGERIA_GEO_URL,
    codes: NG_REGION_CODES,
    baseCountryIds: ["NG"],
    worldOverlay: true,
  },
  // Turkey's eight macro-regions (identical set in the 1953 and 1979 presets);
  // unioned per owner on the world map.
  {
    area: "turkey",
    url: TR_GEO_URL,
    codes: TR_REGION_CODES,
    baseCountryIds: ["TR"],
  },
  // Greece's six macro-regions (identical set in the 1953 and 1979 presets);
  // unioned per owner on the world map.
  {
    area: "greece",
    url: GR_GEO_URL,
    codes: GR_REGION_CODES,
    baseCountryIds: ["GR"],
  },
  // Austria's five macro-regions (identical set in the 1953 and 1979 presets);
  // unioned per owner on the world map.
  {
    area: "austria",
    url: AT_GEO_URL,
    codes: AT_REGION_CODES,
    baseCountryIds: ["AT"],
  },
  // Finland's six macro-regions (identical set in the 1953 and 1979 presets);
  // unioned per owner on the world map.
  {
    area: "finland",
    url: FI_GEO_URL,
    codes: FI_REGION_CODES,
    baseCountryIds: ["FI"],
  },
  // Italy's eight macro-regions (identical set in the 1953 and 1979 presets);
  // unioned per owner on the world map.
  {
    area: "italy",
    url: IT_GEO_URL,
    codes: IT_REGION_CODES,
    baseCountryIds: ["IT"],
  },
  // France's eight macro-regions (identical set in the 1953 and 1979 presets);
  // unioned per owner on the world map.
  {
    area: "france",
    url: FR_GEO_URL,
    codes: FR_REGION_CODES,
    baseCountryIds: ["FR"],
  },
  // Spain's eight macro-regions (identical set in the 1953 and 1979 presets);
  // unioned per owner on the world map. Canaries/Ceuta/Melilla excluded from
  // geometry (see build-es-geo.mjs).
  {
    area: "spain",
    url: ES_GEO_URL,
    codes: ES_REGION_CODES,
    baseCountryIds: ["ES"],
  },
  // Sweden's eight macro-regions (identical set in the 1953 and 1979 presets);
  // unioned per owner on the world map.
  {
    area: "sweden",
    url: SE_GEO_URL,
    codes: SE_REGION_CODES,
    baseCountryIds: ["SE"],
  },
  // Yugoslavia's eight federal units (six republics + Vojvodina/Kosovo;
  // identical set in the 1953 and 1979 presets). YU has NO single modern base
  // feature — the shard covers the successor states' countries-110m features,
  // listed by feature id ("705" Slovenia, "191" Croatia, "070" Bosnia, "688"
  // Serbia, "499" Montenegro, "807" Macedonia) plus "Kosovo" by feature NAME
  // (Natural Earth ships Kosovo without an id — see MapSVGContent's covered
  // check). This is what first puts Yugoslavia on the world globe.
  {
    area: "yugoslavia",
    url: YU_GEO_URL,
    codes: YU_REGION_CODES,
    baseCountryIds: ["705", "191", "070", "688", "499", "807", "Kosovo"],
  },
  // Czechoslovakia's three historic lands (Bohemia/Moravia/Slovakia; identical
  // set in the 1953 and 1979 presets). Like YU it has no single modern base
  // feature — the shard covers the successor states' countries-110m features
  // by id ("203" Czechia, "703" Slovakia).
  {
    area: "czechoslovakia",
    url: CS_GEO_URL,
    codes: CS_REGION_CODES,
    baseCountryIds: ["203", "703"],
  },
  // Bulgaria's three macro-regions (Sofia basin / Danubian Plain / Thrace;
  // identical set in the 1953 and 1979 presets).
  {
    area: "bulgaria",
    url: BG_GEO_URL,
    codes: BG_REGION_CODES,
    baseCountryIds: ["BG"],
  },
  // Hungary's three macro-regions (Central Hungary / Transdanubia / Great
  // Plain & North; identical set in the 1953 and 1979 presets).
  {
    area: "hungary",
    url: HU_GEO_URL,
    codes: HU_REGION_CODES,
    baseCountryIds: ["HU"],
  },
  // Poland's eight macro-regions (identical set in the 1953 and 1979 presets);
  // unioned per owner on the world map.
  {
    area: "poland",
    url: PL_GEO_URL,
    codes: PL_REGION_CODES,
    baseCountryIds: ["PL"],
  },
  // Romania's seven historic provinces (identical set in the 1953 and 1979
  // presets); unioned per owner on the world map.
  {
    area: "romania",
    url: RO_GEO_URL,
    codes: RO_REGION_CODES,
    baseCountryIds: ["RO"],
  },
  // US state codes (AL…WY, DC). Note `DE` here is Delaware-the-region; Germany's
  // `DE` is a country id, not a region code (germany regions are BW/BE/…), so the
  // global-uniqueness guard still holds.
  { area: "usa", url: USA_GEO_URL, codes: US_REGION_CODES, baseCountryIds: ["US"] },
  // The USSR (seeded in 1953 and 1979) spans many base features: Russia (the game
  // country RU, which owns the Russian landmass in every era) plus the union
  // republics it still contains, listed by countries-110m feature id so they hide
  // under the merged blob ONLY while the SU overlay covers them (era-correct: in
  // presets where the USSR is not seeded there is no overlay, so RU shows as
  // Russia and the republics revert to themselves).
  // 398 Kazakhstan, 268/051/031 Transcaucasia (Georgia/Armenia/Azerbaijan),
  // 860/417/762/795 Central Asia (Uzbek/Kyrgyz/Tajik/Turkmen), 498 Moldova.
  // Ukraine, Byelorussia and the Baltics are NOT here any more: they are their
  // own playable countries (UKR/BLR/BAL) with their own shards below, and each
  // hides its own base features.
  // The shard's Far-East longitudes are unwrapped (>180) for the flat nation map;
  // WorldMapSVG re-wraps the unioned blob so d3's antimeridian clipping renders it
  // on the globe.
  {
    area: "soviet-union",
    url: RU_GEO_URL,
    codes: RU_REGION_CODES,
    baseCountryIds: ["RU", "398", "268", "051", "031", "860", "417", "762", "795", "498"],
  },
  // Ukraine's six macro-regions. Promoted out of the USSR shard into its own
  // country, so it hides both its game country id and the raw 804 feature (the
  // latter matters in presets where UKR is not seeded as a game country).
  {
    area: "ukraine",
    url: UA_GEO_URL,
    codes: UA_REGION_CODES,
    baseCountryIds: ["UKR", "804"],
  },
  // Byelorussia's six oblast groups; 112 is the countries-110m Belarus feature.
  {
    area: "byelorussia",
    url: BLR_GEO_URL,
    codes: BLR_REGION_CODES,
    baseCountryIds: ["BLR", "112"],
  },
  // The Baltics as one country of three republics; 233/428/440 are the
  // countries-110m Estonia/Latvia/Lithuania features.
  {
    area: "baltics",
    url: BAL_GEO_URL,
    codes: BAL_REGION_CODES,
    baseCountryIds: ["BAL", "233", "428", "440"],
  },
];

const CODE_TO_SHARD: Map<string, RegionShard> = (() => {
  const m = new Map<string, RegionShard>();
  for (const shard of REGION_SHARDS) {
    for (const code of shard.codes) m.set(code, shard);
  }
  return m;
})();

/** The shard whose geometry contains `code`, or undefined if none does. */
export function shardForRegion(code: string): RegionShard | undefined {
  return CODE_TO_SHARD.get(code);
}

/** The distinct shards needed to render the given region codes (deduped by area). */
export function shardsForRegions(codes: readonly string[]): RegionShard[] {
  const seen = new Set<string>();
  const out: RegionShard[] = [];
  for (const code of codes) {
    const shard = CODE_TO_SHARD.get(code);
    if (shard && !seen.has(shard.area)) {
      seen.add(shard.area);
      out.push(shard);
    }
  }
  return out;
}

/** Every region code across all shards (the global region set). */
export function allRegionCodes(): string[] {
  return REGION_SHARDS.flatMap((s) => [...s.codes]);
}
