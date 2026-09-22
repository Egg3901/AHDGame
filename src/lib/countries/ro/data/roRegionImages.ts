/**
 * Representative hero images for Romania's seven historic provinces (Wikimedia
 * Commons via the stable Special:FilePath redirect), keyed by region id
 * (= `states._id`, matching `src/lib/seeds/ro/roRegions.ts` /
 * `roRegions1953.ts`).
 */
const RO_REGION_IMAGES: Record<string, string> = {
  // Bucharest — the Romanian Athenaeum.
  RO_BUC:
    "https://commons.wikimedia.org/wiki/Special:FilePath/Romanian_Athenaeum_in_Bucharest_Romania.jpg?width=1280",
  // Muntenia — Peleș Castle, Sinaia.
  RO_MUN:
    "https://commons.wikimedia.org/wiki/Special:FilePath/Castle_Pele%C5%9F_in_2009.jpg?width=1280",
  // Oltenia — Horezu Monastery.
  RO_OLT:
    "https://commons.wikimedia.org/wiki/Special:FilePath/Horezu_Monastery_area,_Romania.JPG?width=1280",
  // Transylvania — Bran Castle.
  RO_TRA:
    "https://commons.wikimedia.org/wiki/Special:FilePath/Bran_Castle,_Transylvania_(2023).jpg?width=1280",
  // Banat & Crișana — Union Square, Timișoara.
  RO_VST:
    "https://commons.wikimedia.org/wiki/Special:FilePath/Union_Square,_Timi%C8%99oara,_Banat_02.jpg?width=1280",
  // Moldavia — the Palace of Culture, Iași.
  RO_MOL:
    "https://commons.wikimedia.org/wiki/Special:FilePath/RO_IS_Iasi,_Palace_of_Culture_2.jpg?width=1280",
  // Dobruja — the Constanța Casino on the Black Sea.
  RO_DOB:
    "https://commons.wikimedia.org/wiki/Special:FilePath/Cazinoul_din_Constanta_vedere_laterala.jpg?width=1280",
};

const RO_DEFAULT_IMAGE = RO_REGION_IMAGES.RO_BUC;

export function getRORegionImage(regionId: string): string {
  return RO_REGION_IMAGES[regionId] ?? RO_DEFAULT_IMAGE;
}
