/**
 * Representative hero images for Poland's eight macro-regions (Wikimedia
 * Commons via the stable Special:FilePath redirect), keyed by region id
 * (= `states._id`, matching `src/lib/seeds/pl/plRegions.ts` /
 * `plRegions1953.ts`).
 */
const PL_REGION_IMAGES: Record<string, string> = {
  // Mazovia — Warsaw Old Town.
  PL_MAZ:
    "https://commons.wikimedia.org/wiki/Special:FilePath/Warsaw_Old_Town,_Warsaw,_Poland_-_panoramio_(69).jpg?width=1280",
  // Łódź & Holy Cross — Piotrkowska Street, Łódź.
  PL_LOD:
    "https://commons.wikimedia.org/wiki/Special:FilePath/Piotrkowska_%C5%81%C3%B3d%C5%BA_panorama_wzd%C5%82u%C5%BCna.jpg?width=1280",
  // Lesser Poland — Wawel Castle over the Vistula, Kraków.
  PL_MAL:
    "https://commons.wikimedia.org/wiki/Special:FilePath/Krakow_-_Wawel_from_Vistula_-_4.jpg?width=1280",
  // Silesia — the Spodek arena, Katowice.
  PL_SLK:
    "https://commons.wikimedia.org/wiki/Special:FilePath/Katowice_-_Spodek_by_night.jpg?width=1280",
  // Lower Silesia — Wrocław market square.
  PL_DSL: "https://commons.wikimedia.org/wiki/Special:FilePath/Panorama_wroclaw.jpg?width=1280",
  // Greater Poland — Poznań town hall.
  PL_WLK:
    "https://commons.wikimedia.org/wiki/Special:FilePath/Poznan_10-2013_img10_Town_hall.jpg?width=1280",
  // Pomerania & Masuria — Malbork Castle.
  PL_POM:
    "https://commons.wikimedia.org/wiki/Special:FilePath/Malbork_Castle_2023_001.jpg?width=1280",
  // Eastern Poland — Lublin Castle.
  PL_EAS:
    "https://commons.wikimedia.org/wiki/Special:FilePath/Lublin_Castle_(50309348188).jpg?width=1280",
};

const PL_DEFAULT_IMAGE = PL_REGION_IMAGES.PL_MAZ;

export function getPLRegionImage(regionId: string): string {
  return PL_REGION_IMAGES[regionId] ?? PL_DEFAULT_IMAGE;
}
