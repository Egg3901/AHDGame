/**
 * Representative hero images for Brazil's five geographic regions (Wikimedia
 * Commons via the stable Special:FilePath redirect), keyed by region id
 * (= `states._id`, matching `src/lib/seeds/br/brRegions.ts` and era variants
 * — all presets share the same five region codes).
 */
const BR_REGION_IMAGES: Record<string, string> = {
  // Norte — Teatro Amazonas, Manaus.
  NORTE:
    "https://commons.wikimedia.org/wiki/Special:FilePath/Amazon_Theatre,_Teatro_Amazonas._Manaus,_Brazil._03.jpg?width=1280",
  // Nordeste — Largo do Pelourinho, Salvador.
  NORDESTE:
    "https://commons.wikimedia.org/wiki/Special:FilePath/Largo_do_Pelourinho_Salvador_2019-9754_(cropped).jpg?width=1280",
  // Centro-Oeste — Cathedral of Brasília.
  CENTRO_OESTE:
    "https://commons.wikimedia.org/wiki/Special:FilePath/Brasilia_Cathedral_2007.jpg?width=1280",
  // Sudeste — Christ the Redeemer, Rio de Janeiro.
  SUDESTE:
    "https://commons.wikimedia.org/wiki/Special:FilePath/Christ_the_Redeemer_-_Cristo_Redentor.jpg?width=1280",
  // Sul — Iguaçu Falls.
  SUL: "https://commons.wikimedia.org/wiki/Special:FilePath/The_Igua%C3%A7u_Falls_with_a_rainbow_in_a_sunny_day.jpg?width=1280",
};

const BR_DEFAULT_IMAGE = BR_REGION_IMAGES.SUDESTE;

export function getBRRegionImage(regionId: string): string {
  return BR_REGION_IMAGES[regionId] ?? BR_DEFAULT_IMAGE;
}
