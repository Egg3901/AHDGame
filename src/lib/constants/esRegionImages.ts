/**
 * Representative hero images for Spain's eight macro-regions (Wikimedia
 * Commons via the stable Special:FilePath redirect), keyed by region id
 * (= `states._id`, matching `src/lib/seeds/es/esRegions.ts` /
 * `esRegions1953.ts`).
 */
const ES_REGION_IMAGES: Record<string, string> = {
  // Madrid — Royal Palace.
  ES_MAD:
    "https://commons.wikimedia.org/wiki/Special:FilePath/Palacio_Real_de_Madrid_Julio_2016_(cropped).jpg?width=1280",
  // Catalonia — Sagrada Família, Barcelona.
  ES_CAT: "https://commons.wikimedia.org/wiki/Special:FilePath/SF_maig_2_cropped.jpg?width=1280",
  // Andalusia — the Alhambra, Granada.
  ES_AND: "https://commons.wikimedia.org/wiki/Special:FilePath/Alhambra_Granada.jpg?width=1280",
  // Valencia & Murcia — City of Arts and Sciences, Valencia.
  ES_VAL:
    "https://commons.wikimedia.org/wiki/Special:FilePath/Ciudad_de_las_Artes_y_las_Ciencias,_Valencia.jpg?width=1280",
  // Basque Country & Navarre — Guggenheim Museum, Bilbao.
  ES_PVB:
    "https://commons.wikimedia.org/wiki/Special:FilePath/Museo_Guggenheim,_Bilbao_(31273245344).jpg?width=1280",
  // Galicia — Santiago de Compostela Cathedral.
  ES_GAL:
    "https://commons.wikimedia.org/wiki/Special:FilePath/Santiago_cathedral_2021.jpg?width=1280",
  // Northern Spain — Basilica of Covadonga, Asturias.
  ES_NOR:
    "https://commons.wikimedia.org/wiki/Special:FilePath/Covadonga_-_Bas%C3%ADlica_de_Santa_Mar%C3%ADa_la_Real_08.jpg?width=1280",
  // Central Spain & Islands — Alcázar of Segovia.
  ES_CEN:
    "https://commons.wikimedia.org/wiki/Special:FilePath/Panor%C3%A1mica_Oto%C3%B1o_Alc%C3%A1zar_de_Segovia.jpg?width=1280",
};

const ES_DEFAULT_IMAGE = ES_REGION_IMAGES.ES_MAD;

export function getESRegionImage(regionId: string): string {
  return ES_REGION_IMAGES[regionId] ?? ES_DEFAULT_IMAGE;
}
