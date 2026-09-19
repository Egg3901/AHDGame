/**
 * Representative hero images for France's eight macro-regions (Wikimedia
 * Commons via the stable Special:FilePath redirect), keyed by region id
 * (= `states._id`, matching `src/lib/seeds/fr/frRegions.ts` /
 * `frRegions1953.ts`).
 */
const FR_REGION_IMAGES: Record<string, string> = {
  // Île-de-France — Eiffel Tower, Paris.
  FR_IDF:
    "https://commons.wikimedia.org/wiki/Special:FilePath/Tour_Eiffel_Wikimedia_Commons_(cropped).jpg?width=1280",
  // North — Amiens Cathedral.
  FR_NOR:
    "https://commons.wikimedia.org/wiki/Special:FilePath/0_Amiens_-_Cath%C3%A9drale_Notre-Dame_(1).JPG?width=1280",
  // East — Strasbourg Cathedral.
  FR_EST:
    "https://commons.wikimedia.org/wiki/Special:FilePath/Strasbourg_Cathedral_Exterior_-_Diliff.jpg?width=1280",
  // West — Mont-Saint-Michel.
  FR_OUE:
    "https://commons.wikimedia.org/wiki/Special:FilePath/Mont-Saint-Michel_vu_du_ciel.jpg?width=1280",
  // Southwest — Pont de Pierre, Bordeaux.
  FR_SOU:
    "https://commons.wikimedia.org/wiki/Special:FilePath/151_-_Le_Pont_de_Pierre_-_Bordeaux.jpg?width=1280",
  // Auvergne-Rhône-Alpes — Notre-Dame de Fourvière, Lyon.
  FR_ARA: "https://commons.wikimedia.org/wiki/Special:FilePath/Fourviere_Lyon.jpg?width=1280",
  // Mediterranean — Palais des Papes, Avignon.
  FR_MED:
    "https://commons.wikimedia.org/wiki/Special:FilePath/Avignon_Palais_des_Papes_2013.jpg?width=1280",
  // Center — Château de Chambord.
  FR_CEN:
    "https://commons.wikimedia.org/wiki/Special:FilePath/Aerial_image_of_Ch%C3%A2teau_de_Chambord_(view_from_the_southeast).jpg?width=1280",
};

const FR_DEFAULT_IMAGE = FR_REGION_IMAGES.FR_IDF;

export function getFRRegionImage(regionId: string): string {
  return FR_REGION_IMAGES[regionId] ?? FR_DEFAULT_IMAGE;
}
