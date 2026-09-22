/**
 * Representative hero images for Turkey's eight macro-regions (Wikimedia
 * Commons via the stable Special:FilePath redirect), keyed by region id
 * (= `states._id`, matching `src/lib/seeds/tr/trRegions.ts` /
 * `trRegions1953.ts`).
 */
const TR_REGION_IMAGES: Record<string, string> = {
  // Marmara — Hagia Sophia, Istanbul.
  TR_IST:
    "https://commons.wikimedia.org/wiki/Special:FilePath/Hagia_Sophia_(228968325).jpeg?width=1280",
  // Ankara — Anıtkabir (Atatürk's Mausoleum).
  TR_ANK:
    "https://commons.wikimedia.org/wiki/Special:FilePath/Ataturk%27s_Mausoleum_(6225341313).jpg?width=1280",
  // Aegean — Library of Celsus, Ephesus.
  TR_IZM:
    "https://commons.wikimedia.org/wiki/Special:FilePath/Ephesus_Celsus_Library_Fa%C3%A7ade.jpg?width=1280",
  // Mediterranean — Aspendos theatre.
  TR_MED:
    "https://commons.wikimedia.org/wiki/Special:FilePath/Aspendos_Basilica_4728.jpg?width=1280",
  // Black Sea — Sumela Monastery.
  TR_BLA:
    "https://commons.wikimedia.org/wiki/Special:FilePath/Sumela_From_Across_Valley.JPG?width=1280",
  // Eastern Anatolia — İshak Paşa Palace.
  TR_ESA:
    "https://commons.wikimedia.org/wiki/Special:FilePath/%C4%B0shakpasa_Saray%C4%B1.jpg?width=1280",
  // Southeastern Anatolia — Göbekli Tepe, Şanlıurfa.
  TR_SEA:
    "https://commons.wikimedia.org/wiki/Special:FilePath/G%C3%B6bekli_Tepe,_Urfa.jpg?width=1280",
  // Central Anatolia — Göreme valley, Cappadocia.
  TR_CEN:
    "https://commons.wikimedia.org/wiki/Special:FilePath/G%C3%B6reme_town_and_valley_2015.JPG?width=1280",
};

const TR_DEFAULT_IMAGE = TR_REGION_IMAGES.TR_ANK;

export function getTRRegionImage(regionId: string): string {
  return TR_REGION_IMAGES[regionId] ?? TR_DEFAULT_IMAGE;
}
