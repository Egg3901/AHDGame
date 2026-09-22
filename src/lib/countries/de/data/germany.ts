/**
 * Germany region constants.
 *
 * Currently scoped to the per-Land banner-image helper used by the
 * Governor's Office page and any other surface that wants a country-aware
 * region banner. Mirrors `lib/constants/uk.ts:getUKRegionImage` and
 * `lib/constants/japan.ts:getJPRegionImage` so callers can dispatch
 * uniformly per country.
 *
 * The Land structure / Bundestag election data live in
 * `lib/seeds/de/deRegions.ts` and `lib/seeds/de/deBundestag.ts` — not
 * duplicated here.
 */

/**
 * Fallback used when a Bundesland has no entry in `DE_REGION_IMAGES`.
 * Reichstag building — neutral and works for any DE banner context.
 */
const DE_DEFAULT_IMAGE =
  "https://upload.wikimedia.org/wikipedia/commons/thumb/0/0d/Berlin_reichstag_west_panorama_2.jpg/1280px-Berlin_reichstag_west_panorama_2.jpg";

/**
 * Representative landmark/landscape photos for each of the 16 Bundesländer.
 * URLs verified against Wikimedia Commons via the Wikipedia article infobox
 * for the named landmark. Freely licensed via Commons. Falls back to
 * `DE_DEFAULT_IMAGE` (Reichstag) for any future Land ID added without a
 * dedicated entry here.
 */
const DE_REGION_IMAGES: Record<string, string> = {
  // Baden-Württemberg — Heidelberg Castle
  BW: "https://upload.wikimedia.org/wikipedia/commons/thumb/1/1d/Heidelberg-2726936.jpg/1280px-Heidelberg-2726936.jpg",
  // Bayern — Neuschwanstein Castle
  BY: "https://upload.wikimedia.org/wikipedia/commons/thumb/f/f8/Schloss_Neuschwanstein_2013.jpg/1280px-Schloss_Neuschwanstein_2013.jpg",
  // Berlin — Brandenburg Gate
  BE: "https://upload.wikimedia.org/wikipedia/commons/thumb/a/a6/Brandenburger_Tor_abends.jpg/1280px-Brandenburger_Tor_abends.jpg",
  // Brandenburg — Sanssouci Palace
  BB: "https://upload.wikimedia.org/wikipedia/commons/thumb/8/8b/Schloss_Sanssouci_2014.jpg/1280px-Schloss_Sanssouci_2014.jpg",
  // Bremen — Bremen City Hall + Roland. Keyed BRE (the internal Land id) — the
  // real-world code "HB" collides with CN Huabei, so the state seed uses BRE
  // (see seeds/de/deRegions.ts + deLandtag.ts). Keying this "HB" silently fell
  // back to the Reichstag default since getDERegionImage is called with the
  // internal id.
  BRE: "https://upload.wikimedia.org/wikipedia/commons/thumb/3/32/Bremer_Rathaus_und_Bremer_Roland_%282007%29.jpg/1280px-Bremer_Rathaus_und_Bremer_Roland_%282007%29.jpg",
  // Hamburg — Speicherstadt at dusk
  HH: "https://upload.wikimedia.org/wikipedia/commons/thumb/3/31/Speicherstadt_abends.jpg/1280px-Speicherstadt_abends.jpg",
  // Hessen — Frankfurt skyline
  HE: "https://upload.wikimedia.org/wikipedia/commons/thumb/a/ac/Frankfurt_Main_August_2020_1.jpg/1280px-Frankfurt_Main_August_2020_1.jpg",
  // Mecklenburg-Vorpommern — Königsstuhl chalk cliffs (Rügen)
  MV: "https://upload.wikimedia.org/wikipedia/commons/thumb/5/54/K%C3%B6nigsstuhl_R%C3%BCgen_2012.JPG/1280px-K%C3%B6nigsstuhl_R%C3%BCgen_2012.JPG",
  // Niedersachsen — Lüneburg Heath
  NI: "https://upload.wikimedia.org/wikipedia/commons/thumb/0/00/L%C3%BCneburger_Heide_-_038.jpg/1280px-L%C3%BCneburger_Heide_-_038.jpg",
  // Nordrhein-Westfalen — Cologne Cathedral
  NW: "https://upload.wikimedia.org/wikipedia/commons/thumb/0/04/K%C3%B6lner_Dom_-_Westfassade_2022_ohne_Ger%C3%BCst-0968_b.jpg/1280px-K%C3%B6lner_Dom_-_Westfassade_2022_ohne_Ger%C3%BCst-0968_b.jpg",
  // Rheinland-Pfalz — Burg Eltz
  RP: "https://upload.wikimedia.org/wikipedia/commons/thumb/5/5e/Le_ch%C3%A2teau_d%27Eltz_%28Burg_Eltz%29_en_allemagne_%28cropped%29.jpg/1280px-Le_ch%C3%A2teau_d%27Eltz_%28Burg_Eltz%29_en_allemagne_%28cropped%29.jpg",
  // Saarland — Saarschleife (Saar Loop)
  SL: "https://upload.wikimedia.org/wikipedia/commons/thumb/6/69/Saarschleife_vomTurm_Baumwipfelpfad.jpg/1280px-Saarschleife_vomTurm_Baumwipfelpfad.jpg",
  // Sachsen — Dresden Frauenkirche
  SN: "https://upload.wikimedia.org/wikipedia/commons/thumb/9/93/100130_150006_Dresden_Frauenkirche_winter_blue_sky-2.jpg/1280px-100130_150006_Dresden_Frauenkirche_winter_blue_sky-2.jpg",
  // Sachsen-Anhalt — Wernigerode Castle
  ST: "https://upload.wikimedia.org/wikipedia/commons/thumb/2/24/WernigerodeCastleWinter.jpg/1280px-WernigerodeCastleWinter.jpg",
  // Schleswig-Holstein — Holstentor in Lübeck
  SH: "https://upload.wikimedia.org/wikipedia/commons/thumb/c/ca/Holstentor_in_L%C3%BCbeck_Frontseite_-_Zuschnitt.jpg/1280px-Holstentor_in_L%C3%BCbeck_Frontseite_-_Zuschnitt.jpg",
  // Thüringen — Wartburg Castle
  TH: "https://upload.wikimedia.org/wikipedia/commons/thumb/c/c2/Thuringia_Eisenach_asv2020-07_img23_Wartburg_Castle.jpg/1280px-Thuringia_Eisenach_asv2020-07_img23_Wartburg_Castle.jpg",
};

/** Get a representative image URL for a German Bundesland card. */
export function getDERegionImage(landId: string): string {
  return DE_REGION_IMAGES[landId] ?? DE_DEFAULT_IMAGE;
}
