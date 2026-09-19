/**
 * Representative hero images for Nigeria's six geopolitical zones (Wikimedia
 * Commons via the stable Special:FilePath redirect), keyed by region id
 * (= `states._id`, matching `src/lib/seeds/ng/ngRegions.ts` and era variants
 * — all presets share the same six zone codes).
 */
const NG_REGION_IMAGES: Record<string, string> = {
  // North-Central — Abuja National Mosque.
  NORTH_CENTRAL:
    "https://commons.wikimedia.org/wiki/Special:FilePath/Abuja_National_Mosque.jpg?width=1280",
  // North-East — Yankari Game Reserve, Bauchi.
  NORTH_EAST: "https://commons.wikimedia.org/wiki/Special:FilePath/Yankari.jpg?width=1280",
  // North-West — Great Mosque of Kano (1960 view).
  NORTH_WEST:
    "https://commons.wikimedia.org/wiki/Special:FilePath/Kano_Mosque_in_1960.jpg?width=1280",
  // South-East — Owerri cityscape, Imo State.
  SOUTH_EAST:
    "https://commons.wikimedia.org/wiki/Special:FilePath/CITY_SCAPE,_OWERRI.jpg?width=1280",
  // South-South — Obudu Mountain Resort, Cross River.
  SOUTH_SOUTH:
    "https://commons.wikimedia.org/wiki/Special:FilePath/Obudu_Mountain_Resort_02.jpg?width=1280",
  // South-West — Third Mainland Bridge, Lagos.
  SOUTH_WEST:
    "https://commons.wikimedia.org/wiki/Special:FilePath/Dan_Flore_Lagos-Nigeria-3rd-Mainland-Bridge-2006.jpg?width=1280",
};

const NG_DEFAULT_IMAGE = NG_REGION_IMAGES.NORTH_CENTRAL;

export function getNGRegionImage(regionId: string): string {
  return NG_REGION_IMAGES[regionId] ?? NG_DEFAULT_IMAGE;
}
