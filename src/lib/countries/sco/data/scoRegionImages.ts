/**
 * Representative hero images for Scotland's seven post-independence
 * sub-regions (Wikimedia Commons via the stable Special:FilePath redirect),
 * keyed by region id (= `states._id`, matching `src/lib/seeds/sco/scoRegions.ts`).
 */
const SCO_REGION_IMAGES: Record<string, string> = {
  // Greater Glasgow — Glasgow Cathedral.
  GLA: "https://commons.wikimedia.org/wiki/Special:FilePath/Glasgow-cathedral-may-2007.jpg?width=1280",
  // Edinburgh & the Lothians — Edinburgh Castle.
  LOT: "https://commons.wikimedia.org/wiki/Special:FilePath/City_of_Edinburgh_-_Edinburgh_Castle_-_20140421004403.jpg?width=1280",
  // Highlands & Islands — Urquhart Castle on Loch Ness.
  HIG: "https://commons.wikimedia.org/wiki/Special:FilePath/Urquhart_Castle_2017-05-22.jpg?width=1280",
  // North East Scotland — Dunnottar Castle, Aberdeenshire.
  GRA: "https://commons.wikimedia.org/wiki/Special:FilePath/Dunnottar_Castle_-_geograph.org.uk_-_8057610.jpg?width=1280",
  // Tayside & Fife — Scone Palace, Perthshire.
  TAY: "https://commons.wikimedia.org/wiki/Special:FilePath/Perth_and_Kinross_Scone_Palace_2.jpg?width=1280",
  // South Scotland — Melrose Abbey.
  STH: "https://commons.wikimedia.org/wiki/Special:FilePath/Melrose_Abbey.jpg?width=1280",
  // Central Scotland — Stirling Castle.
  CSC: "https://commons.wikimedia.org/wiki/Special:FilePath/Stirling_Castle_Aerial_Photo.jpg?width=1280",
};

const SCO_DEFAULT_IMAGE = SCO_REGION_IMAGES.LOT;

export function getSCORegionImage(regionId: string): string {
  return SCO_REGION_IMAGES[regionId] ?? SCO_DEFAULT_IMAGE;
}
