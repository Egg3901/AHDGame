/**
 * Representative hero images for Hungary's six regions (Wikimedia Commons via
 * the stable Special:FilePath redirect), keyed by region id (= `states._id`,
 * matching `src/lib/seeds/hu/huRegions.ts` / `huRegions1953.ts`).
 */
const HU_REGION_IMAGES: Record<string, string> = {
  // Budapest — Parliament Building on the Danube.
  HU_BUD: "https://commons.wikimedia.org/wiki/Special:FilePath/Budapest_Parliament.jpg?width=1280",
  // Pest — the Danube Bend from the Visegrád citadel.
  HU_PES:
    "https://commons.wikimedia.org/wiki/Special:FilePath/The_Danube_from_the_Visegrad_Citadel_2012-03-21.jpg?width=1280",
  // Western Transdanubia — Tihany Abbey over Lake Balaton.
  HU_TRW:
    "https://commons.wikimedia.org/wiki/Special:FilePath/Tihany_Abbey_Balaton_panorama_at_sunset.jpg?width=1280",
  // Southern Transdanubia — the Mosque of Pasha Qasim, Pécs.
  HU_TRS:
    "https://commons.wikimedia.org/wiki/Special:FilePath/Mosque_of_Gazi_Kasim_Pasha_-_panoramio.jpg?width=1280",
  // Northern Hungary — Eger Castle.
  HU_NOR:
    "https://commons.wikimedia.org/wiki/Special:FilePath/Eger_castle_(by_Pudelek)_01.JPG?width=1280",
  // Great Plain — the Nine-arched Bridge at Hortobágy.
  HU_ALF:
    "https://commons.wikimedia.org/wiki/Special:FilePath/Nine-arched_bridge_2024_1.jpg?width=1280",
};

const HU_DEFAULT_IMAGE = HU_REGION_IMAGES.HU_BUD;

export function getHURegionImage(regionId: string): string {
  return HU_REGION_IMAGES[regionId] ?? HU_DEFAULT_IMAGE;
}
