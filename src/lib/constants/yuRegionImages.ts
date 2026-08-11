/**
 * Representative hero images for Yugoslavia's eight federal units (Wikimedia
 * Commons via the stable Special:FilePath redirect), keyed by region id
 * (= `states._id`, matching `src/lib/seeds/yu/yuRegions.ts` /
 * `yuRegions1953.ts`).
 */
const YU_REGION_IMAGES: Record<string, string> = {
  // Slovenia — Lake Bled.
  YU_SLO: "https://commons.wikimedia.org/wiki/Special:FilePath/Panorama_Bled_01.jpg?width=1280",
  // Croatia — Dubrovnik old town.
  YU_CRO: "https://commons.wikimedia.org/wiki/Special:FilePath/Dubrovnik_-_Croatia.jpg?width=1280",
  // Bosnia & Herzegovina — Stari Most, Mostar.
  YU_BIH: "https://commons.wikimedia.org/wiki/Special:FilePath/Stari_Most22.jpg?width=1280",
  // Serbia — Kalemegdan Fortress, Belgrade.
  YU_SRB: "https://commons.wikimedia.org/wiki/Special:FilePath/Kalemegdan,_a10.jpg?width=1280",
  // Vojvodina — Petrovaradin Fortress, Novi Sad.
  YU_VOJ:
    "https://commons.wikimedia.org/wiki/Special:FilePath/Petrovaradin_Fortress.jpg?width=1280",
  // Kosovo — Gračanica Monastery.
  YU_KOS: "https://commons.wikimedia.org/wiki/Special:FilePath/Gracanica_Monastery.jpg?width=1280",
  // Montenegro — Bay of Kotor.
  YU_MNE:
    "https://commons.wikimedia.org/wiki/Special:FilePath/Bay_of_Kotor_Panorama.jpg?width=1280",
  // Macedonia — Church of St. John Kaneo, Ohrid.
  YU_MKD:
    "https://commons.wikimedia.org/wiki/Special:FilePath/Iglesia_San_Juan_Kaneo,_Ohrid,_Macedonia_del_Norte,_2014-04-17,_DD_22.jpg?width=1280",
};

const YU_DEFAULT_IMAGE = YU_REGION_IMAGES.YU_SRB;

export function getYURegionImage(regionId: string): string {
  return YU_REGION_IMAGES[regionId] ?? YU_DEFAULT_IMAGE;
}
