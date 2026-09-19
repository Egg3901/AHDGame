/**
 * Representative hero images for Bulgaria's five regions (Wikimedia Commons
 * via the stable Special:FilePath redirect), keyed by region id
 * (= `states._id`, matching `src/lib/seeds/bg/bgRegions.ts` /
 * `bgRegions1953.ts`).
 */
const BG_REGION_IMAGES: Record<string, string> = {
  // Sofia — Alexander Nevsky Cathedral.
  BG_SOF:
    "https://commons.wikimedia.org/wiki/Special:FilePath/Alexander_Nevsky_Cathedral,_Sofia.jpg?width=1280",
  // Northern Bulgaria — Tsarevets fortress, Veliko Tarnovo.
  BG_NOR:
    "https://commons.wikimedia.org/wiki/Special:FilePath/Tsarevets_Veliko_Tarnovo.jpg?width=1280",
  // Black Sea Coast — Nesebar old town.
  BG_COA: "https://commons.wikimedia.org/wiki/Special:FilePath/Panorama_Nesebar.jpg?width=1280",
  // Thrace — the Roman theatre of Plovdiv.
  BG_THR:
    "https://commons.wikimedia.org/wiki/Special:FilePath/Roman_Theatre_Plovdiv.jpg?width=1280",
  // Southwestern Bulgaria — Rila Monastery.
  BG_SW:
    "https://commons.wikimedia.org/wiki/Special:FilePath/2016-07-31_Bulgaria,_Rila_Monastery_DSC_9213_DxO.jpg?width=1280",
};

const BG_DEFAULT_IMAGE = BG_REGION_IMAGES.BG_SOF;

export function getBGRegionImage(regionId: string): string {
  return BG_REGION_IMAGES[regionId] ?? BG_DEFAULT_IMAGE;
}
