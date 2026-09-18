/**
 * Representative hero images for the three Baltic republics (Wikimedia Commons
 * via the stable Special:FilePath redirect), keyed by region id
 * (= `states._id`, matching `src/lib/seeds/bal/balRegions.ts` /
 * `balRegions1953.ts`).
 *
 * One image per republic. The old single `BAL_BAL` key showed Tallinn for
 * Lithuania and Latvia too, which is exactly the kind of flattening the
 * three-region split exists to undo.
 */
const BAL_REGION_IMAGES: Record<string, string> = {
  // Estonia — Tallinn, Toompea and the Upper Old Town.
  BAL_EST:
    "https://commons.wikimedia.org/wiki/Special:FilePath/Tallinn_Toompea_Upper_Old_Town_2013.jpg?width=1280",
  // Latvia — Riga, the Old Town skyline over the Daugava.
  BAL_LVA:
    "https://commons.wikimedia.org/wiki/Special:FilePath/Riga_Old_Town_panorama.jpg?width=1280",
  // Lithuania — Vilnius, the baroque old town from Gediminas' Hill.
  BAL_LTU:
    "https://commons.wikimedia.org/wiki/Special:FilePath/Vilnius_Old_Town_panorama.jpg?width=1280",
};

/** Tallinn stands in when a region id is unrecognised. */
const BAL_DEFAULT_IMAGE = BAL_REGION_IMAGES.BAL_EST;

export function getBALRegionImage(regionId: string): string {
  return BAL_REGION_IMAGES[regionId] ?? BAL_DEFAULT_IMAGE;
}
