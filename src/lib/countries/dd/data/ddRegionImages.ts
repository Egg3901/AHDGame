/**
 * Representative hero images for East Germany's six Länder (Wikimedia Commons
 * via the stable Special:FilePath redirect), keyed by region id
 * (= `states._id`, matching `src/lib/seeds/dd/ddRegions1953.ts` /
 * `ddRegions.ts` — both Cold-War presets seed the same codes). Era-flexible
 * landmarks that stood through the GDR years.
 */
const DD_REGION_IMAGES: Record<string, string> = {
  // Berlin (Ost) — the Brandenburg Gate, on the eastern side of the line.
  BEO: "https://commons.wikimedia.org/wiki/Special:FilePath/Brandenburger_Tor_abends.jpg?width=1280",
  // Mecklenburg-Vorpommern — the Königsstuhl chalk cliffs, Rügen.
  MV: "https://commons.wikimedia.org/wiki/Special:FilePath/K%C3%B6nigsstuhl_R%C3%BCgen_Jasmund.jpg?width=1280",
  // Brandenburg — Sanssouci, Potsdam.
  BB: "https://commons.wikimedia.org/wiki/Special:FilePath/Aerial_image_of_Sanssouci_(view_from_the_south).jpg?width=1280",
  // Sachsen-Anhalt — Magdeburg Cathedral over the Elbe.
  ST: "https://commons.wikimedia.org/wiki/Special:FilePath/Dom_(Magdeburg-Altstadt).Ansicht_Neue_Strombr%C3%BCcke.ajb.jpg?width=1280",
  // Sachsen — the Zwinger, Dresden (rebuilt through the fifties and sixties).
  SN: "https://commons.wikimedia.org/wiki/Special:FilePath/Zwinger_gardens.jpg?width=1280",
  // Thüringen — the Wartburg above Eisenach.
  TH: "https://commons.wikimedia.org/wiki/Special:FilePath/Thuringia_Eisenach_asv2020-07_img23_Wartburg_Castle.jpg?width=1280",

  // ── 1953 preset's three macro-regions (ddRegions1953.ts) — these don't map
  // 1:1 to a single Land, so each points at the most iconic landmark within
  // its constituent Bezirke, reusing the same verified images above.
  // East Berlin.
  DD_BER:
    "https://commons.wikimedia.org/wiki/Special:FilePath/Brandenburger_Tor_abends.jpg?width=1280",
  // Northern Districts (Rostock, Schwerin, Neubrandenburg, Magdeburg, Halle) —
  // Rostock/Schwerin/Neubrandenburg are in present-day Mecklenburg-Vorpommern.
  DD_NOR:
    "https://commons.wikimedia.org/wiki/Special:FilePath/K%C3%B6nigsstuhl_R%C3%BCgen_Jasmund.jpg?width=1280",
  // Southern Districts (Leipzig, Dresden, Karl-Marx-Stadt, Erfurt, Gera, Suhl,
  // Cottbus, Frankfurt/Oder, Potsdam) — the Zwinger, Dresden.
  DD_SOU: "https://commons.wikimedia.org/wiki/Special:FilePath/Zwinger_gardens.jpg?width=1280",
};

const DD_DEFAULT_IMAGE = DD_REGION_IMAGES.BEO;

export function getDDRegionImage(regionId: string): string {
  return DD_REGION_IMAGES[regionId] ?? DD_DEFAULT_IMAGE;
}
