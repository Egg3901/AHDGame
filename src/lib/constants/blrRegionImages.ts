/**
 * Representative hero images for Byelorussia's six oblasts (Wikimedia Commons
 * via the stable Special:FilePath redirect), keyed by region id
 * (= `states._id`, matching `src/lib/seeds/blr/blrRegions.ts` /
 * `blrRegions1953.ts`).
 *
 * One image per oblast rather than one for the whole republic: the region set
 * used to be a single placeholder region (`BLR_BEL`), and a single national
 * image made sense then. It does not now - six regions sharing one photo of Mir
 * Castle reads as a rendering bug, not a design.
 */
const BLR_REGION_IMAGES: Record<string, string> = {
  // Minsk — the rebuilt Stalinist-era centre, Independence Avenue.
  BLR_MIN:
    "https://commons.wikimedia.org/wiki/Special:FilePath/Minsk_Independence_Avenue_2013.jpg?width=1280",
  // Brest — the fortress, the republic's defining war memorial and its gateway
  // to Poland.
  BLR_BRE:
    "https://commons.wikimedia.org/wiki/Special:FilePath/Brest_Fortress_Main_Entrance.jpg?width=1280",
  // Gomel — the Rumyantsev-Paskevich palace and park on the Sozh.
  BLR_HOM:
    "https://commons.wikimedia.org/wiki/Special:FilePath/Gomel_Palace_of_Rumyantsev_and_Paskevich.jpg?width=1280",
  // Grodno — the most Catholic and most western oblast; the old town.
  BLR_GRO:
    "https://commons.wikimedia.org/wiki/Special:FilePath/Hrodna_Farny_Kascioł.jpg?width=1280",
  // Mogilev — the Dnieper city and its central square.
  BLR_MOG:
    "https://commons.wikimedia.org/wiki/Special:FilePath/Mahilioŭ_Ratuša_2015.jpg?width=1280",
  // Vitebsk — the northern lakeland and the city on the Western Dvina.
  BLR_VIT:
    "https://commons.wikimedia.org/wiki/Special:FilePath/Viciebsk_Uspienski_sabor.jpg?width=1280",
};

/** Mir Castle: the national image, used when a region id is unrecognised. */
const BLR_DEFAULT_IMAGE =
  "https://commons.wikimedia.org/wiki/Special:FilePath/Belarus_Mir_Mir_Castle_Complex_8094_2075.jpg?width=1280";

export function getBLRRegionImage(regionId: string): string {
  return BLR_REGION_IMAGES[regionId] ?? BLR_DEFAULT_IMAGE;
}
