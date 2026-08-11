/**
 * Representative hero images for Sweden's eight macro-regions (Wikimedia
 * Commons via the stable Special:FilePath redirect), keyed by region id
 * (= `states._id`, matching `src/lib/seeds/se/seRegions.ts` /
 * `seRegions1953.ts`).
 */
const SE_REGION_IMAGES: Record<string, string> = {
  // Stockholm — Stockholm City Hall.
  SE_STH:
    "https://commons.wikimedia.org/wiki/Special:FilePath/Stockholms_Stadshuset_City_Hall_Stockholm_2016_01.jpg?width=1280",
  // Western Sweden — Gothenburg skyline.
  SE_GOT:
    "https://commons.wikimedia.org/wiki/Special:FilePath/G%C3%B6teborg_2503_stitch_(28573994096).jpg?width=1280",
  // Skåne — Turning Torso, Malmö.
  SE_SKA: "https://commons.wikimedia.org/wiki/Special:FilePath/Turning_Torso2.jpg?width=1280",
  // Eastern Sweden — Visby Cathedral, Gotland.
  SE_EAS: "https://commons.wikimedia.org/wiki/Special:FilePath/0522Visby_domkyrka.jpg?width=1280",
  // Småland — Kalmar Castle.
  SE_SML: "https://commons.wikimedia.org/wiki/Special:FilePath/1285Kalmar_slott.jpg?width=1280",
  // Bergslagen — Örebro Castle.
  SE_VML: "https://commons.wikimedia.org/wiki/Special:FilePath/%C3%96rebro_slott.jpg?width=1280",
  // Norrland — Lapporten, Abisko.
  SE_NOR: "https://commons.wikimedia.org/wiki/Special:FilePath/Lapporten_2.jpg?width=1280",
  // Uppland & Dalarna — Uppsala Cathedral.
  SE_UPP:
    "https://commons.wikimedia.org/wiki/Special:FilePath/Uppsala_cathedral_from_southwest_02.jpg?width=1280",
};

const SE_DEFAULT_IMAGE = SE_REGION_IMAGES.SE_STH;

export function getSERegionImage(regionId: string): string {
  return SE_REGION_IMAGES[regionId] ?? SE_DEFAULT_IMAGE;
}
