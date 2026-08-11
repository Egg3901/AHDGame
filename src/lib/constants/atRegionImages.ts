/**
 * Representative hero images for Austria's five macro-regions (Wikimedia
 * Commons via the stable Special:FilePath redirect), keyed by region id
 * (= `states._id`, matching `src/lib/seeds/at/atRegions.ts` /
 * `atRegions1953.ts`).
 */
const AT_REGION_IMAGES: Record<string, string> = {
  // Vienna — Schönbrunn Palace.
  AT_VIE:
    "https://commons.wikimedia.org/wiki/Special:FilePath/Schloss_Schönbrunn_Wien_2014_(Zuschnitt_2).jpg?width=1280",
  // Lower Austria & Burgenland — Melk Abbey above the Danube.
  AT_NOE:
    "https://commons.wikimedia.org/wiki/Special:FilePath/Stift_Melk_Nordseite_01.jpg?width=1280",
  // Upper Austria & Salzburg — Hallstatt on the Hallstätter See.
  AT_OOE: "https://commons.wikimedia.org/wiki/Special:FilePath/Hallstatt_-_Zentrum_.JPG?width=1280",
  // Styria & Carinthia — Graz with the Schlossberg.
  AT_STK: "https://commons.wikimedia.org/wiki/Special:FilePath/Austria_Graz_2022-03.jpg?width=1280",
  // Tyrol & Vorarlberg — the Golden Roof, Innsbruck.
  AT_TYR:
    "https://commons.wikimedia.org/wiki/Special:FilePath/Goldenes_Dachl_(Innsbruck).jpg?width=1280",
};

const AT_DEFAULT_IMAGE = AT_REGION_IMAGES.AT_VIE;

export function getATRegionImage(regionId: string): string {
  return AT_REGION_IMAGES[regionId] ?? AT_DEFAULT_IMAGE;
}
