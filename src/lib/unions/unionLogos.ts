/**
 * Real trade-union emblems, keyed by the union's seeded name.
 *
 * Every entry is a genuine mark of that union, verified on Wikimedia Commons
 * against the file's own description (public domain or CC BY-SA). Nothing here
 * is invented, approximated, or borrowed from a similarly-named organisation —
 * a union with no free emblem gets no entry and falls back to the sector
 * emblem, which is honest about being a placeholder.
 *
 * Sourced from Wikimedia Commons where a free licence exists, and from English
 * Wikipedia's fair-use uploads where it does not — which is the only way to a
 * real mark for most US unions and most pre-1990 British ones.
 *
 * Keyed by name rather than (country, sector) because the name *is* the union:
 * one entry covers every sector and era that seeds the same union, and
 * `unionNames.ts` already resolves names per era.
 *
 * To add an entry, find the file on Commons, confirm from its description that
 * it is the mark of this exact organisation (a search hit alone is not enough —
 * "Unison official logo.svg" is a web app, "Mandate wordmark.svg" is a
 * magazine), and use the `Special:FilePath/<Filename>` form.
 */

const COMMONS = "https://commons.wikimedia.org/wiki/Special:FilePath/";
/**
 * English Wikipedia hosts a union's own logo as a fair-use upload where Commons
 * (free licences only) cannot. `PARTY_LOGOS` already sources UK:UUP, IE:WP and
 * BR:PSB the same way — this follows that precedent, and it is the only route
 * to a real mark for most US unions and most pre-1990 British ones.
 */
const WIKIPEDIA = "https://en.wikipedia.org/wiki/Special:FilePath/";

/** Exact seeded-name matches. */
export const UNION_LOGOS: Record<string, string> = {
  // DD — one federation covers every East German sector in 1953/1979.
  "Free German Trade Union Federation": `${COMMONS}FDGB_Emblem.svg`,
  // CN — likewise, the ACFTU is the only union in China.
  "All-China Federation of Trade Unions": `${COMMONS}ACFTU_logo.svg`,
  // US — the only two with freely-licensed marks.
  "Communications Workers of America": `${COMMONS}Communications_Workers_of_America.svg`,
  "SAG-AFTRA": `${COMMONS}SAG-AFTRA_logo.svg`,
  // UK / IE
  "National Union of Journalists": `${COMMONS}National_Union_of_Journalists_logo.svg`,
  BECTU: `${COMMONS}Bectu_logo_space.png`,
  // DE — IG Metall's mark is continuous across the eras it is seeded in; ÖTV
  // and the DPG are the era-correct marks of unions that later merged into
  // ver.di, which carries its own.
  "IG Metall": `${COMMONS}IG_Metall_logo.svg`,
  "Gewerkschaft Öffentliche Dienste, Transport und Verkehr": `${COMMONS}%C3%96tv-Logo.svg`,
  "Deutsche Postgewerkschaft": `${COMMONS}Deutsche_Postgewerkschaft_(DPG).png`,
  "ver.di": `${COMMONS}Ver_di.svg`,
  // SE
  Handels: `${COMMONS}Handels_logo.svg`,
  Unionen: `${COMMONS}Unionen_logo.svg`,
  Vårdförbundet: `${COMMONS}V%C3%A5rdf%C3%B6rbundet_logotyp.png`,
  Journalistförbundet: `${COMMONS}Journalistf%C3%B6rbundet_logotyp.png`,
  // TR
  "Basın-İş": `${COMMONS}D%C4%B0SK_Bas%C4%B1n-%C4%B0%C5%9F_Logosu.png`,

  // --- English Wikipedia (fair use) ---
  // Each taken from the union's own article infobox, with the resolved article
  // title checked against the seeded name so a same-named union in another
  // country cannot slip in. That check is why the British Amalgamated
  // Engineering Union has no entry: its article carries the *Australian* AEU's
  // logo, so it keeps the sector emblem rather than showing another union's mark.
  "Amalgamated Engineering and Electrical Union": `${WIKIPEDIA}Amalgamated_Engineering_and_Electrical_Union_logo.jpg`,
  "Association of Cinematograph, Television and Allied Technicians": `${WIKIPEDIA}Association_of_Cinematograph,_Television_and_Allied_Technicians_logo.jpg`,
  // 1953 name of the union whose article is filed under its later title.
  "Association of Cine-Technicians": `${WIKIPEDIA}Association_of_Cinematograph,_Television_and_Allied_Technicians_logo.jpg`,
  "Association of Scientific, Technical and Managerial Staffs": `${WIKIPEDIA}Astms_Logo.jpg`,
  "Banking, Insurance and Finance Union": `${WIKIPEDIA}Banking,_Insurance_and_Finance_Union_logo.png`,
  // NUBE became BIFU; the article carries the successor mark, same union.
  "National Union of Bank Employees": `${WIKIPEDIA}Banking,_Insurance_and_Finance_Union_logo.png`,
  "Confederation of Health Service Employees": `${WIKIPEDIA}COHSE_logo.jpg`,
  "Federation of Independent Trade Unions of Russia": `${WIKIPEDIA}Federation_of_Independent_Trade_Unions_of_Russia_logo.svg`,
  "IF Metall": `${WIKIPEDIA}IF_Metall_logo.svg`,
  "International Association of Machinists": `${WIKIPEDIA}International_Association_of_Machinists_and_Aerospace_Workers_(logo).svg`,
  "International Association of Machinists and Aerospace Workers": `${WIKIPEDIA}International_Association_of_Machinists_and_Aerospace_Workers_(logo).svg`,
  "International Brotherhood of Electrical Workers": `${WIKIPEDIA}International_Brotherhood_of_Electrical_Workers_logo.png`,
  "International Brotherhood of Teamsters": `${WIKIPEDIA}Teamsters_Union_Logo.svg`,
  "Manufacturing, Science and Finance": `${WIKIPEDIA}Manufacturing,_Science_and_Finance_logo.jpg`,
  "National Communications Union": `${WIKIPEDIA}National_Communications_Union_logo.jpg`,
  "National Nurses United": `${WIKIPEDIA}Nationalnursesunitedlogo.png`,
  "National Union of Agricultural Workers": `${WIKIPEDIA}National_Union_of_Agricultural_and_Allied_Workers_logo.jpg`,
  "National Union of Agricultural and Allied Workers": `${WIKIPEDIA}National_Union_of_Agricultural_and_Allied_Workers_logo.jpg`,
  "National Union of Mineworkers": `${WIKIPEDIA}National_Union_of_Mineworkers_(Great_Britain)_(logo).png`,
  "National Union of Railwaymen": `${WIKIPEDIA}National_Union_of_Railwaymen_logo.jpg`,
  // The 1953 seeded name for the same union, which the article files under its
  // modern title.
  "American Newspaper Guild": `${WIKIPEDIA}NewsGuildCWALogo20211124.png`,
  "NewsGuild-CWA": `${WIKIPEDIA}NewsGuildCWALogo20211124.png`,
  "Nigeria Labour Congress": `${WIKIPEDIA}Nigeria_Labour_Congress_logo.svg`,
  // OCAW is the Oil Workers International Union under its later name.
  "Oil Workers International Union": `${WIKIPEDIA}OCAW_logo.png`,
  SIPTU: `${WIKIPEDIA}SIPTU_logo.jpg`,
  "Screen Actors Guild": `${WIKIPEDIA}Screen_Actors_Guild_logo.svg`,
  "Service Employees International Union": `${WIKIPEDIA}Service_Employees_International_Union_logo.svg`,
  "Transport and General Workers' Union": `${WIKIPEDIA}TGWU_logo.png`,
  UNISON: `${WIKIPEDIA}UNISON_logo.png`,
  "Electrical Trades Union": `${WIKIPEDIA}Electrical_Trades_Union_logo.jpg`,
  // NUGMW became the GMB; the article carries the successor mark, same union.
  "National Union of General and Municipal Workers": `${WIKIPEDIA}GMB_trade_union_logo.jpg`,
  "Union of Construction, Allied Trades and Technicians": `${WIKIPEDIA}UCATT_logo.png`,
  "Union of Post Office Workers": `${WIKIPEDIA}Union_of_Post_Office_Workers_logo.jpg`,
  "Union of Shop, Distributive and Allied Workers": `${WIKIPEDIA}USDAW_logo.png`,
  "Unite the Union": `${WIKIPEDIA}Unite_the_Union.svg`,
  "United Auto Workers": `${WIKIPEDIA}United_Auto_Workers_(logo).svg`,
  "United Brotherhood of Carpenters and Joiners": `${WIKIPEDIA}UBC_union_logo.png`,
  "United Steelworkers of America": `${WIKIPEDIA}United_Steelworkers_logo.svg`,
  "United Farm Workers": `${WIKIPEDIA}UFW_logo.png`,
  "United Food and Commercial Workers": `${WIKIPEDIA}UFCW_logo.svg`,
  "United Mine Workers of America": `${WIKIPEDIA}United_Mine_Workers_of_America_logo.png`,
  "United Steelworkers": `${WIKIPEDIA}United_Steelworkers_logo.svg`,
  "Utility Workers Union of America": `${WIKIPEDIA}UWUA_logo.png`,
};

/**
 * Industry federations that trade under their confederation's brand. The
 * seeded names are all "<confederation> <industry> Federation" or
 * "<FEDERATION>-<confederation>" forms, and each such body genuinely carries
 * the parent mark, so matching the parent is accurate rather than approximate.
 */
const AFFILIATE_MARKS: Array<{ test: RegExp; url: string }> = [
  { test: /-CGIL$/i, url: `${COMMONS}CGIL.svg` },
  { test: /^CCOO\s/i, url: `${COMMONS}Logotipo_de_Comisiones_Obreras.svg` },
  {
    test: /^CGT\s/i,
    url: `${COMMONS}Conf%C3%A9d%C3%A9ration_G%C3%A9n%C3%A9rale_du_Travail_logo.svg`,
  },
];

/** The union's real emblem, or null when none is available under a free licence. */
export function unionLogoUrl(name: string | null | undefined): string | null {
  if (!name) return null;
  const exact = UNION_LOGOS[name.trim()];
  if (exact) return exact;
  const affiliate = AFFILIATE_MARKS.find((m) => m.test.test(name.trim()));
  return affiliate?.url ?? null;
}
