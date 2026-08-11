/**
 * Representative hero images for Wales's six post-independence sub-regions
 * (Wikimedia Commons via the stable Special:FilePath redirect), keyed by
 * region id (= `states._id`, matching `src/lib/seeds/wal/walRegions.ts`).
 */
const WAL_REGION_IMAGES: Record<string, string> = {
  // Cardiff & South East — Cardiff Castle.
  CDF: "https://commons.wikimedia.org/wiki/Special:FilePath/Aerial_view_of_Cardiff_Castle.jpg?width=1280",
  // Swansea & South West — Rhossili / Gower peninsula.
  SWA: "https://commons.wikimedia.org/wiki/Special:FilePath/Rhosilli_village_from_the_air.jpg?width=1280",
  // The Valleys — Big Pit National Coal Museum, Blaenavon.
  VAL: "https://commons.wikimedia.org/wiki/Special:FilePath/Big_Pit,_Blaenavon.jpg?width=1280",
  // Mid Wales — Powis Castle.
  MWA: "https://commons.wikimedia.org/wiki/Special:FilePath/Powis_Castle_2016_116_(cropped).jpg?width=1280",
  // North West Wales — Caernarfon Castle.
  NWW: "https://commons.wikimedia.org/wiki/Special:FilePath/Caernarfon_Castle_1994.jpg?width=1280",
  // North East Wales — Pontcysyllte Aqueduct.
  NEW: "https://commons.wikimedia.org/wiki/Special:FilePath/Pontcysyllte_aqueduct_arp.jpg?width=1280",
};

const WAL_DEFAULT_IMAGE = WAL_REGION_IMAGES.CDF;

export function getWALRegionImage(regionId: string): string {
  return WAL_REGION_IMAGES[regionId] ?? WAL_DEFAULT_IMAGE;
}
