import type { CountryId } from "@/lib/constants/countries";
import type { HazardTag } from "@/lib/db/types/crisis";
import { JP_GEOGRAPHY } from "@/lib/countries/jp/geography";
import { US_GEOGRAPHY } from "@/lib/countries/us/geography";
import { UK_GEOGRAPHY } from "@/lib/countries/uk/geography";
import { DE_GEOGRAPHY } from "@/lib/countries/de/geography";
import { CN_GEOGRAPHY } from "@/lib/countries/cn/geography";
import { IE_GEOGRAPHY } from "@/lib/countries/ie/geography";
import { BR_GEOGRAPHY } from "@/lib/countries/br/geography";

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
export const HAZARD_GROUPS: Partial<Record<CountryId, Partial<Record<HazardTag, string[]>>>> = {
  US: US_GEOGRAPHY.hazardGroups,
  UK: UK_GEOGRAPHY.hazardGroups,
  JP: JP_GEOGRAPHY.hazardGroups,
  DE: DE_GEOGRAPHY.hazardGroups,
  IE: IE_GEOGRAPHY.hazardGroups,
  CN: CN_GEOGRAPHY.hazardGroups,
  BR: BR_GEOGRAPHY.hazardGroups,
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
