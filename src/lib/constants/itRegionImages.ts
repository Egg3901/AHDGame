/**
 * Representative hero images for Italy's eight macro-regions (Wikimedia
 * Commons via the stable Special:FilePath redirect), keyed by region id
 * (= `states._id`, matching `src/lib/seeds/it/itRegions.ts` /
 * `itRegions1953.ts`).
 */
const IT_REGION_IMAGES: Record<string, string> = {
  // Northwest — Milan Cathedral.
  IT_NW:
    "https://commons.wikimedia.org/wiki/Special:FilePath/Il_Duomo_di_Milano_-_July_2026.jpg?width=1280",
  // Northeast — Piazza San Marco, Venice.
  IT_NE:
    "https://commons.wikimedia.org/wiki/Special:FilePath/Piazza_San_Marco_(Venice)_at_night-msu-2021-6449-.jpg?width=1280",
  // Central Italy — Florence Cathedral (Duomo).
  IT_TUS:
    "https://commons.wikimedia.org/wiki/Special:FilePath/Cattedrale_di_Santa_Maria_del_Fiore_%E2%80%93_Il_Duomo_di_Firenze.jpg?width=1280",
  // Lazio — the Colosseum, Rome.
  IT_LAZ: "https://commons.wikimedia.org/wiki/Special:FilePath/Colosseo_2020.jpg?width=1280",
  // Campania — Pompeii with Mount Vesuvius.
  IT_CAM:
    "https://commons.wikimedia.org/wiki/Special:FilePath/Aerial_image_of_Pompeii_and_Mount_Vesuvius_(view_from_the_southeast).jpg?width=1280",
  // Southern Italy — Castel del Monte, Apulia.
  IT_SUD:
    "https://commons.wikimedia.org/wiki/Special:FilePath/Castel_del_Monte_-_Andria.jpg?width=1280",
  // Sicily — Temple of Concordia, Agrigento.
  IT_SIC:
    "https://commons.wikimedia.org/wiki/Special:FilePath/Agrigent_BW_2012-10-07_12-52-27.JPG?width=1280",
  // Sardinia — Costa Smeralda coastline.
  IT_SAR: "https://commons.wikimedia.org/wiki/Special:FilePath/Costa_Smeralda_1.jpg?width=1280",
};

const IT_DEFAULT_IMAGE = IT_REGION_IMAGES.IT_LAZ;

export function getITRegionImage(regionId: string): string {
  return IT_REGION_IMAGES[regionId] ?? IT_DEFAULT_IMAGE;
}
