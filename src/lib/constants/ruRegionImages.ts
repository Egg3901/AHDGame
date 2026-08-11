/**
 * Representative hero images for the USSR's 17 macro-regions (Wikimedia
 * Commons via the stable Special:FilePath redirect), keyed by region id
 * (= `states._id`, matching `src/lib/seeds/ru/ruRegions.ts` — the same codes
 * in the 1953 and 1979 presets). Era-flexible landmarks: nothing shown here
 * postdates the mid-century skylines the Cold-War presets depict.
 */
const RU_REGION_IMAGES: Record<string, string> = {
  // Central — Moscow State University's main building on the Lenin Hills.
  CEN: "https://commons.wikimedia.org/wiki/Special:FilePath/Moscow_State_University_crop.jpg?width=1280",
  // Northwest — the Winter Palace, Leningrad.
  NWR: "https://commons.wikimedia.org/wiki/Special:FilePath/Winter_Palace_Panorama_4.jpg?width=1280",
  // North — the wooden churches of Kizhi Pogost, Karelia.
  NOR: "https://commons.wikimedia.org/wiki/Special:FilePath/Kizhi_Pogost_P7114012_2200.jpg?width=1280",
  // Central Black Earth — Voronezh's Annunciation Cathedral.
  CBE: "https://commons.wikimedia.org/wiki/Special:FilePath/Voronezh_Annunciation_Cathedral_P1030830_2700.jpg?width=1280",
  // Volga — the Kazan Kremlin above the river.
  VOL: "https://commons.wikimedia.org/wiki/Special:FilePath/Kazan_Kremlin_Qolsharif_Mosque_08-2016_img2.jpg?width=1280",
  // North Caucasus — Mount Elbrus.
  NCA: "https://commons.wikimedia.org/wiki/Special:FilePath/Mount_Elbrus_May_2008.jpg?width=1280",
  // Urals — the Taganay range.
  URA: "https://commons.wikimedia.org/wiki/Special:FilePath/Taganay_National_Park_3_(20076504249).jpg?width=1280",
  // West Siberia — the Novosibirsk Opera and Ballet Theatre.
  WSB: "https://commons.wikimedia.org/wiki/Special:FilePath/Novosibirsk_Opera_and_Ballet_Theatre,_night_view.jpg?width=1280",
  // East Siberia — Shaman Rock on Lake Baikal.
  ESB: "https://commons.wikimedia.org/wiki/Special:FilePath/Baikal,_Cape_Burhan,_Shaman_Rock,_Olkhon_Island,_Lake_Baikal,_Russia.jpg?width=1280",
  // Far East — Koryaksky volcano over Petropavlovsk-Kamchatsky.
  FEA: "https://commons.wikimedia.org/wiki/Special:FilePath/Koryaksky_volcano_Petropavlovsk-Kamchatsky_oct-2005.jpg?width=1280",
  // Ukraine — the Pechersk Lavra, Kyiv.
  UKR: "https://commons.wikimedia.org/wiki/Special:FilePath/Dormition_and_Refectory_Churches_Lavra.jpg?width=1280",
  // Kazakhstan — Charyn Canyon.
  KAZ: "https://commons.wikimedia.org/wiki/Special:FilePath/Charyn_Canyon,_Kazakhstan_03.jpg?width=1280",
  // Transcaucasia — Tbilisi on the Mtkvari.
  TRA: "https://commons.wikimedia.org/wiki/Special:FilePath/Building_on_Mtkvari_River_(Tbilisi,_Georgia).jpg?width=1280",
  // Central Asia — the Registan, Samarkand.
  CAS: "https://commons.wikimedia.org/wiki/Special:FilePath/Registan_01.jpg?width=1280",
  // Moldavia — Orheiul Vechi on the Răut.
  MOL: "https://commons.wikimedia.org/wiki/Special:FilePath/Orhei_Vechi_08.JPG?width=1280",
  // Byelorussia — Mir Castle.
  BEL: "https://commons.wikimedia.org/wiki/Special:FilePath/Belarus_Mir_Mir_Castle_Complex_8101_2085.jpg?width=1280",
  // The Baltics — the House of the Blackheads, Riga.
  BLT: "https://commons.wikimedia.org/wiki/Special:FilePath/House_of_Blackheads_at_Dusk_3,_Riga,_Latvia_-_Diliff.jpg?width=1280",
};

const RU_DEFAULT_IMAGE = RU_REGION_IMAGES.CEN;

export function getRURegionImage(regionId: string): string {
  return RU_REGION_IMAGES[regionId] ?? RU_DEFAULT_IMAGE;
}
