/**
 * Representative hero images for Greece's six macro-regions (Wikimedia Commons
 * via the stable Special:FilePath redirect), keyed by region id
 * (= `states._id`, matching `src/lib/seeds/gr/grRegions.ts` /
 * `grRegions1953.ts`).
 */
const GR_REGION_IMAGES: Record<string, string> = {
  // Attica — the Parthenon.
  GR_ATT:
    "https://commons.wikimedia.org/wiki/Special:FilePath/The_Parthenon_in_Athens.jpg?width=1280",
  // Macedonia & Thrace — the White Tower of Thessaloniki.
  GR_MAC:
    "https://commons.wikimedia.org/wiki/Special:FilePath/White_Tower_of_Thessaloniki.jpg?width=1280",
  // Thessaly — the Meteora monasteries.
  GR_THE: "https://commons.wikimedia.org/wiki/Special:FilePath/Meteora_Panorama.jpg?width=1280",
  // Epirus & Central Greece — Delphi.
  GR_EPC:
    "https://commons.wikimedia.org/wiki/Special:FilePath/Delphi_-_panoramio_(7).jpg?width=1280",
  // Peloponnese — the theatre of Epidaurus.
  GR_PEL:
    "https://commons.wikimedia.org/wiki/Special:FilePath/Theatre_of_Epidaurus,_091172.jpg?width=1280",
  // Islands & Crete — Oia, Santorini.
  GR_ISL:
    "https://commons.wikimedia.org/wiki/Special:FilePath/Panoramic_view_of_Oia,_Santorini_island_(Thira),_Greece.jpg?width=1280",
};

const GR_DEFAULT_IMAGE = GR_REGION_IMAGES.GR_ATT;

export function getGRRegionImage(regionId: string): string {
  return GR_REGION_IMAGES[regionId] ?? GR_DEFAULT_IMAGE;
}
