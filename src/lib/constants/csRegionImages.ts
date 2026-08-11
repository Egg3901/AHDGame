/**
 * Representative hero images for Czechoslovakia's four regions (Wikimedia
 * Commons via the stable Special:FilePath redirect), keyed by region id
 * (= `states._id`, matching `src/lib/seeds/cs/csRegions.ts` /
 * `csRegions1953.ts`).
 */
const CS_REGION_IMAGES: Record<string, string> = {
  // Prague — Prague Castle at dusk.
  CS_PRG:
    "https://commons.wikimedia.org/wiki/Special:FilePath/Czech-2013-Prague-Prague_Castle_at_dusk.jpg?width=1280",
  // Bohemia — Český Krumlov over the Vltava.
  CS_BOH:
    "https://commons.wikimedia.org/wiki/Special:FilePath/Panorama-of-cesky-krumlov-tower-castle-old-town-and-latran.jpg?width=1280",
  // Moravia — Špilberk Castle, Brno.
  CS_MOR:
    "https://commons.wikimedia.org/wiki/Special:FilePath/Brno_Spilberk_Castle-03.jpg?width=1280",
  // Slovakia — Bratislava Castle over the Danube.
  CS_SVK:
    "https://commons.wikimedia.org/wiki/Special:FilePath/Bratislava_Castle_with_Danube.jpeg?width=1280",
};

const CS_DEFAULT_IMAGE = CS_REGION_IMAGES.CS_PRG;

export function getCSRegionImage(regionId: string): string {
  return CS_REGION_IMAGES[regionId] ?? CS_DEFAULT_IMAGE;
}
