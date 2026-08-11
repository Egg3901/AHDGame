import type { CountryId } from "@/lib/constants/countries";
import type { HazardTag } from "@/lib/db/types/crisis";

/**
 * Curated geographic hazard tags per region, used to gate the regional disaster
 * spawner realistically (tsunamis only on coasts, tornadoes on the plains, no
 * hurricanes in landlocked regions). Keyed by `State._id`, which is the bare
 * region code from each country's seed (e.g. US "CA", DE "BW", JP "KAN").
 *
 * Authored as tag -> region-id lists for readability; inverted once into a
 * region -> tags lookup at module load. A region absent from every list simply
 * has no special hazards and is therefore ineligible for tag-gated disasters
 * (ungated disasters like heat waves or bridge collapses can still hit it).
 */
const HAZARD_GROUPS: Partial<Record<CountryId, Partial<Record<HazardTag, string[]>>>> = {
  US: {
    coastal: [
      "AK",
      "CA",
      "OR",
      "WA",
      "HI",
      "TX",
      "LA",
      "MS",
      "AL",
      "FL",
      "GA",
      "SC",
      "NC",
      "VA",
      "MD",
      "DE",
      "NJ",
      "NY",
      "CT",
      "RI",
      "MA",
      "NH",
      "ME",
    ],
    seismic: ["CA", "AK", "NV", "WA", "OR", "HI", "UT"],
    tornado: [
      "TX",
      "OK",
      "KS",
      "NE",
      "SD",
      "IA",
      "MO",
      "AR",
      "MS",
      "AL",
      "IL",
      "IN",
      "MN",
      "ND",
      "CO",
      "GA",
      "KY",
      "TN",
    ],
    volcanic: ["HI", "AK", "WA", "OR", "CA"],
    flood: [
      "LA",
      "MS",
      "MO",
      "IA",
      "IL",
      "TX",
      "FL",
      "ND",
      "KY",
      "TN",
      "WV",
      "CA",
      "NJ",
      "NY",
      "PA",
    ],
    wintry: [
      "AK",
      "ME",
      "NH",
      "VT",
      "NY",
      "MA",
      "CT",
      "RI",
      "MI",
      "MN",
      "WI",
      "ND",
      "SD",
      "MT",
      "WY",
      "CO",
      "IA",
      "PA",
      "OH",
      "IL",
      "IN",
    ],
    wildfire: ["CA", "OR", "WA", "NV", "AZ", "NM", "CO", "MT", "ID", "UT", "TX"],
    arid: ["AZ", "NM", "NV", "UT", "CA", "TX", "OK", "KS", "CO"],
  },
  UK: {
    coastal: ["SEE", "SWE", "EAE", "YHU", "NWE", "NEE", "SCO", "WAL", "NIR"],
    flood: ["LON", "SWE", "EAE", "YHU", "NWE", "SEE", "WAL", "SCO"],
    wintry: ["SCO", "NEE", "NWE", "YHU", "NIR"],
  },
  JP: {
    coastal: ["HOK", "TOH", "KAN", "CHU", "KNS", "CGK", "SHI", "KYU"],
    seismic: ["HOK", "TOH", "KAN", "CHU", "KNS", "CGK", "SHI", "KYU"],
    volcanic: ["HOK", "TOH", "KAN", "CHU", "KNS", "KYU"],
    flood: ["HOK", "TOH", "KAN", "CHU", "KNS", "CGK", "SHI", "KYU"],
    wintry: ["HOK", "TOH", "CHU"],
  },
  DE: {
    coastal: ["SH", "HH", "BRE", "MV", "NI"],
    flood: ["NW", "RP", "BW", "BY", "SN", "ST", "BB", "NI", "SH", "HE"],
    wintry: ["BY", "BW", "SN", "TH", "ST"],
  },
  IE: {
    coastal: ["DUB", "WEX", "COR", "GAL", "DON", "LIM"],
    flood: ["DUB", "KIL", "MID", "WEX", "LIM", "COR", "GAL", "DON"],
    wintry: ["DON"],
  },
  CN: {
    coastal: ["DB", "HB", "HD", "HN"],
    seismic: ["XN", "XB"],
    flood: ["HD", "HZ", "HN", "DB"],
    wintry: ["DB", "XB", "HB"],
    arid: ["XB", "HB"],
  },
  BR: {
    coastal: ["NORTE", "NORDESTE", "SUDESTE", "SUL"],
    flood: ["NORTE", "SUDESTE", "SUL"],
    arid: ["NORDESTE"],
    wildfire: ["CENTRO_OESTE", "NORTE"],
  },
};

/** Inverted lookup: `${countryId}:${regionId}` -> Set<HazardTag>. */
const REGION_TAGS: Map<string, Set<HazardTag>> = (() => {
  const map = new Map<string, Set<HazardTag>>();
  for (const [country, groups] of Object.entries(HAZARD_GROUPS)) {
    for (const [tag, regionIds] of Object.entries(groups ?? {})) {
      for (const regionId of regionIds ?? []) {
        const key = `${country}:${regionId}`;
        const set = map.get(key) ?? new Set<HazardTag>();
        set.add(tag as HazardTag);
        map.set(key, set);
      }
    }
  }
  return map;
})();

/** Hazard tags for a region. Empty when the region carries no curated hazards. */
export function getRegionHazards(countryId: CountryId, regionId: string): HazardTag[] {
  return Array.from(REGION_TAGS.get(`${countryId}:${regionId}`) ?? []);
}

/** True when the region carries every tag in `required` (or `required` is empty). */
export function regionMatchesTags(
  countryId: CountryId,
  regionId: string,
  required: HazardTag[] | undefined
): boolean {
  if (!required || required.length === 0) return true;
  const set = REGION_TAGS.get(`${countryId}:${regionId}`);
  if (!set) return false;
  return required.every((tag) => set.has(tag));
}
