/**
 * Representative hero images for Finland's six macro-regions (Wikimedia
 * Commons via the stable Special:FilePath redirect), keyed by region id
 * (= `states._id`, matching `src/lib/seeds/fi/fiRegions.ts` /
 * `fiRegions1953.ts`).
 */
const FI_REGION_IMAGES: Record<string, string> = {
  // Uusimaa — Helsinki Cathedral over Senate Square.
  FI_UUS:
    "https://commons.wikimedia.org/wiki/Special:FilePath/Lutheran_Cathedral_Helsinki.jpg?width=1280",
  // Southwest Finland — Turku Castle.
  FI_SW: "https://commons.wikimedia.org/wiki/Special:FilePath/Turku_Castle.jpg?width=1280",
  // Häme & Central Finland — the Tammerkoski rapids and mill town of Tampere.
  FI_HAM: "https://commons.wikimedia.org/wiki/Special:FilePath/Tammerkoski_Tampere.jpg?width=1280",
  // Eastern Finland — Olavinlinna castle, Savonlinna.
  FI_EAS:
    "https://commons.wikimedia.org/wiki/Special:FilePath/Olavinlinna_Savonlinna.jpg?width=1280",
  // Ostrobothnia — central Oulu.
  FI_OST:
    "https://commons.wikimedia.org/wiki/Special:FilePath/Oulu_City_Centre_20250329.jpg?width=1280",
  // Lapland — the Pallastunturi fells.
  FI_LAP: "https://commons.wikimedia.org/wiki/Special:FilePath/Pallakset.jpg?width=1280",
};

const FI_DEFAULT_IMAGE = FI_REGION_IMAGES.FI_UUS;

export function getFIRegionImage(regionId: string): string {
  return FI_REGION_IMAGES[regionId] ?? FI_DEFAULT_IMAGE;
}
