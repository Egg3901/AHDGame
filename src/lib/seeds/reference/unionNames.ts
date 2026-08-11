import { CORPORATION_TYPES } from "@/lib/constants/corporations";
import type { CorporationType } from "@/lib/constants/corporations";
import type { CountryId } from "@/lib/constants/countries";
import type { EraId } from "@/lib/seeds/presetSelector";

/** Per-country, per-sector historical union names for a given era. */
export type UnionNameMap = Partial<Record<CountryId, Partial<Record<CorporationType, string>>>>;

/**
 * One national labour body covering every sector. Used for state-directed
 * single-federation systems (Soviet bloc, Franco Spain, ACFTU) and for
 * countries where only the national confederation is safely attestable for
 * an era. Sectors deliberately omitted from a country's map fall back to
 * `genericUnionName` at lookup time; that generic fallback is preferred over
 * inventing a plausible-sounding but fake historical union.
 */
function uniform(name: string): Partial<Record<CorporationType, string>> {
  const map: Partial<Record<CorporationType, string>> = {};
  for (const type of CORPORATION_TYPES) map[type] = name;
  return map;
}

/**
 * Shared modern-era names (2019/2023 family). Era-specific bundles override
 * these via spreads, so every era bundle is a complete map on its own.
 *
 * Historical-accuracy notes (audited 2026-07, refs union-name accuracy pass):
 * - IT: FENEAL-UIL is the construction/wood federation, and "Fegica" is a
 *   petrol-station operators' association, so extraction and entertainment
 *   now use FILCTEM-CGIL (energy/chemical/mining) and SLC-CGIL
 *   (communication/entertainment workers) instead.
 * - SE: Lantarbetareforbundet (farm workers) merged into Kommunal in 1997,
 *   so modern agriculture maps to Kommunal.
 * - TR: replaced invented "-Is" names with the real Turk-Is affiliates
 *   (Tez-Koop-Is commerce, Yol-Is construction, Tes-Is energy, TUMTIS
 *   transport). No era-correct dedicated tech union is attestable, so
 *   technology falls back to the generic name.
 * - RU: "Medprofzdrav" is not the union's name; the health workers' union is
 *   the Trade Union of Health Workers of Russia. Rail transport is dominated
 *   by Rosprofzhel (Russian Trade Union of Railwaymen and Transport Builders).
 * - ES media: FAPE is a journalists' professional association rather than a
 *   trade union, but it is a real, era-correct journalists' body; kept in
 *   preference to inventing a federation name.
 */
const NAMES_MODERN: UnionNameMap = {
  US: {
    manufacturing: "United Steelworkers",
    automobiles: "United Auto Workers",
    extraction: "United Mine Workers of America",
    energy: "Utility Workers Union of America",
    construction: "United Brotherhood of Carpenters and Joiners",
    agriculture: "United Farm Workers",
    healthcare: "National Nurses United",
    retail: "United Food and Commercial Workers",
    logistics: "International Brotherhood of Teamsters",
    media: "NewsGuild-CWA",
    defense: "International Association of Machinists and Aerospace Workers",
    entertainment: "SAG-AFTRA",
    telecommunications: "Communications Workers of America",
    chemical_industries: "United Steelworkers",
    technology: "Communications Workers of America",
  },
  UK: {
    manufacturing: "Unite the Union",
    automobiles: "Unite the Union",
    extraction: "National Union of Mineworkers",
    energy: "GMB",
    construction: "Unite the Union",
    agriculture: "Unite the Union",
    healthcare: "UNISON",
    retail: "Usdaw",
    logistics: "Unite the Union",
    media: "National Union of Journalists",
    defense: "Unite the Union",
    entertainment: "BECTU",
    telecommunications: "Communication Workers Union",
    chemical_industries: "Unite the Union",
    technology: "Prospect",
    financial: "Unite the Union",
    real_estate: "Unite the Union",
  },
  DE: {
    manufacturing: "IG Metall",
    automobiles: "IG Metall",
    chemical_industries: "IG BCE",
    construction: "IG BAU",
    energy: "IG BCE",
    extraction: "IG BCE",
    healthcare: "ver.di",
    retail: "ver.di",
    media: "ver.di",
    logistics: "ver.di",
    technology: "IG Metall",
    financial: "ver.di",
    telecommunications: "ver.di",
    entertainment: "ver.di",
    defense: "IG Metall",
    agriculture: "IG BAU",
    real_estate: "IG BAU",
  },
  JP: {
    manufacturing: "Japanese Trade Union Confederation",
    automobiles: "Confederation of Japan Automobile Workers' Unions",
    chemical_industries: "UA Zensen",
    construction: "National Federation of Construction Workers' Unions",
    energy: "Japanese Federation of Electric Wire and Electric Power Workers' Unions",
    extraction: "Japan Mining Industry Workers' Union",
    healthcare: "Japan Federation of Medical Workers' Unions",
    retail: "UA Zensen",
    media: "UA Zensen",
    logistics: "All Japan Seamen's Union",
    technology: "UA Zensen",
    financial: "National Federation of Finance Industry Workers' Unions",
    telecommunications: "UA Zensen",
    entertainment: "UA Zensen",
    defense: "Japan Federation of Aviation Industry Workers' Unions",
    agriculture: "UA Zensen",
    real_estate: "UA Zensen",
  },
  FR: {
    manufacturing: "CGT Metalworkers' Federation",
    automobiles: "CGT Metalworkers' Federation",
    chemical_industries: "CGT Chemical Industries Federation",
    construction: "CGT Building and Wood Federation",
    energy: "CGT Energy Federation",
    extraction: "CGT Mines Federation",
    healthcare: "CGT Health Federation",
    retail: "CGT Trade and Services Federation",
    media: "CGT Culture and Media Federation",
    logistics: "CGT Transport Federation",
    technology: "CGT Metalworkers' Federation",
    financial: "CGT Bank and Insurance Federation",
    telecommunications: "CGT Post and Telecommunications Federation",
    entertainment: "CGT Culture and Media Federation",
    defense: "CGT Metalworkers' Federation",
    agriculture: "CGT Agricultural Workers' Federation",
    real_estate: "CGT Building and Wood Federation",
  },
  IE: {
    manufacturing: "SIPTU",
    automobiles: "SIPTU",
    healthcare: "INMO",
    retail: "Mandate",
    construction: "Connect Trade Union",
    energy: "SIPTU",
    logistics: "SIPTU",
    media: "National Union of Journalists",
    financial: "Financial Services Union",
    technology: "SIPTU",
    telecommunications: "CWU Ireland",
  },
  BR: {
    manufacturing: "CUT Metalworkers' Federation",
    automobiles: "CUT Metalworkers' Federation",
    extraction: "CUT Mining Federation",
    energy: "CUT Energy Federation",
    agriculture: "CONTAG",
    healthcare: "CUT Health Workers' Federation",
    retail: "CUT Commerce Federation",
    construction: "CUT Construction Federation",
    logistics: "CUT Transport Federation",
    media: "CUT Communications Federation",
    chemical_industries: "CUT Chemical Workers' Federation",
    technology: "CUT Metalworkers' Federation",
    financial: "CUT Bank Workers' Federation",
    telecommunications: "CUT Communications Federation",
    entertainment: "CUT Culture Federation",
    defense: "CUT Metalworkers' Federation",
    real_estate: "CUT Construction Federation",
  },
  // Single state-supervised federation; correct for every era the game seeds
  // (founded 1925, rebuilt 1978 after the Cultural Revolution suspension).
  CN: uniform("All-China Federation of Trade Unions"),
  NG: {
    manufacturing: "Nigeria Labour Congress",
    extraction: "Nigeria Union of Petroleum and Natural Gas Workers",
    energy: "Nigeria Union of Petroleum and Natural Gas Workers",
    agriculture: "Nigeria Agricultural and Allied Workers' Union",
    healthcare: "Medical and Health Workers' Union of Nigeria",
    retail: "Nigeria Labour Congress",
    construction: "Nigeria Labour Congress",
    logistics: "National Union of Road Transport Workers",
    media: "Nigeria Union of Journalists",
    chemical_industries: "Nigeria Labour Congress",
    technology: "Nigeria Labour Congress",
    financial: "Association of Senior Staff of Banks, Insurance and Financial Institutions",
    telecommunications: "Private Telecommunications and Communications Senior Staff Association",
    entertainment: "Nigeria Labour Congress",
    defense: "Nigeria Labour Congress",
    real_estate: "Nigeria Labour Congress",
    automobiles: "Nigeria Labour Congress",
  },
  RU: {
    manufacturing: "Federation of Independent Trade Unions of Russia",
    automobiles: "Federation of Independent Trade Unions of Russia",
    extraction: "Russian Independent Coal Employees' Union",
    energy: "Trade Union of Russian Fuel and Energy Sector Workers",
    construction: "Building Workers' Union of Russia",
    agriculture: "Agro-Industrial Workers' Union of Russia",
    healthcare: "Trade Union of Health Workers of Russia",
    retail: "Trade Union of Workers of Trade and Public Catering",
    logistics: "Russian Trade Union of Railwaymen and Transport Builders",
    media: "Interregional Trade Union of Media Workers",
    chemical_industries: "Federation of Independent Trade Unions of Russia",
    technology: "Federation of Independent Trade Unions of Russia",
    financial: "Trade Union of Workers of the Banking Sector",
    telecommunications: "Federation of Independent Trade Unions of Russia",
    entertainment: "Interregional Trade Union of Culture Workers",
    defense: "Federation of Independent Trade Unions of Russia",
    real_estate: "Building Workers' Union of Russia",
  },
  IT: {
    manufacturing: "FIOM-CGIL",
    automobiles: "FIOM-CGIL",
    chemical_industries: "FILCTEM-CGIL",
    construction: "FILLEA-CGIL",
    energy: "FLAEI-CISL",
    extraction: "FILCTEM-CGIL",
    healthcare: "FP-CGIL",
    retail: "Filcams-CGIL",
    media: "FNSI",
    logistics: "FILT-CGIL",
    technology: "FIOM-CGIL",
    financial: "FISAC-CGIL",
    telecommunications: "SLC-CGIL",
    entertainment: "SLC-CGIL",
    defense: "FIOM-CGIL",
    agriculture: "FLAI-CGIL",
    real_estate: "FILLEA-CGIL",
  },
  ES: {
    manufacturing: "CCOO Industry Federation",
    automobiles: "CCOO Industry Federation",
    chemical_industries: "CCOO Industry Federation",
    construction: "CCOO Construction Federation",
    energy: "CCOO Energy Federation",
    extraction: "CCOO Mining Federation",
    healthcare: "CCOO Health Federation",
    retail: "CCOO Commerce Federation",
    media: "FAPE",
    logistics: "CCOO Transport Federation",
    technology: "CCOO Industry Federation",
    financial: "CCOO Finance Federation",
    telecommunications: "CCOO Communications Federation",
    entertainment: "CCOO Culture Federation",
    defense: "CCOO Industry Federation",
    agriculture: "CCOO Agriculture Federation",
    real_estate: "CCOO Construction Federation",
  },
  SE: {
    manufacturing: "IF Metall",
    automobiles: "IF Metall",
    chemical_industries: "IF Metall",
    construction: "Byggnads",
    energy: "Unionen",
    extraction: "IF Metall",
    healthcare: "Vårdförbundet",
    retail: "Handels",
    media: "Journalistförbundet",
    logistics: "Transport",
    technology: "Unionen",
    financial: "Finansförbundet",
    telecommunications: "Unionen",
    entertainment: "Unionen",
    defense: "IF Metall",
    agriculture: "Kommunal",
    real_estate: "Byggnads",
  },
  TR: {
    manufacturing: "Türk Metal",
    automobiles: "Türk Metal",
    chemical_industries: "Petrol-İş",
    construction: "Yol-İş",
    energy: "Tes-İş",
    extraction: "Genel Maden-İş",
    healthcare: "Sağlık-Sen",
    retail: "Tez-Koop-İş",
    media: "Basın-İş",
    logistics: "TÜMTİS",
    financial: "Bank-Sen",
    telecommunications: "Haber-İş",
    entertainment: "Basın-İş",
    defense: "Türk Metal",
    agriculture: "Tarım-İş",
    real_estate: "Yol-İş",
  },
  // East Germany's single SED-controlled federation (1946-1990). DD only
  // seeds in Cold-War presets; the entry is inert elsewhere.
  DD: uniform("Free German Trade Union Federation"),
  // MASZSZ, formed 2013; older eras override with MSZOSZ / SZOT below.
  HU: uniform("Hungarian Trade Union Confederation"),
  PL: uniform("NSZZ Solidarność"),
  RO: uniform("National Trade Union Bloc"),
  YU: uniform("Confederation of Trade Unions of Yugoslavia"),
  BG: uniform("Confederation of Independent Trade Unions in Bulgaria"),
  UKR: uniform("Federation of Trade Unions of Ukraine"),
  BLR: uniform("Federation of Trade Unions of Belarus"),
  CS: uniform("Czech-Moravian Confederation of Trade Unions"),
  // BAL is the game's composite Baltic country; the three real republics each
  // have their own confederation, so a neutral composite label is used.
  BAL: uniform("Baltic Trade Union Confederation"),
};

/**
 * 2007 era. Diffs from modern:
 * - US: SAG-AFTRA (2012) and National Nurses United (2009) do not exist yet;
 *   The Newspaper Guild was only renamed NewsGuild in 2015.
 * - JP: UA Zensen dates from 2012; 2002-2012 the union was UI Zensen.
 * - SE: Unionen formed 2008 from Sif + HTF; in 2007 the white-collar
 *   industrial union was Sif.
 * - HU: MASZSZ dates from 2013; MSZOSZ was the main confederation.
 * - IT: FILCTEM-CGIL formed 2010; its predecessor FILCEM-CGIL (2006) covers
 *   chemicals/energy/mining here.
 * - UK: Unite the Union formed during 2007 (Amicus + TGWU) and is kept.
 */
const NAMES_2007: UnionNameMap = {
  ...NAMES_MODERN,
  US: {
    ...NAMES_MODERN.US,
    healthcare: "Service Employees International Union",
    media: "The Newspaper Guild",
    entertainment: "Screen Actors Guild",
  },
  JP: {
    ...NAMES_MODERN.JP,
    chemical_industries: "UI Zensen",
    retail: "UI Zensen",
    media: "UI Zensen",
    technology: "UI Zensen",
    telecommunications: "UI Zensen",
    entertainment: "UI Zensen",
    agriculture: "UI Zensen",
    real_estate: "UI Zensen",
  },
  SE: {
    ...NAMES_MODERN.SE,
    energy: "Sif",
    technology: "Sif",
    telecommunications: "Sif",
    entertainment: "Sif",
  },
  HU: uniform("National Confederation of Hungarian Trade Unions"),
  IT: {
    ...NAMES_MODERN.IT,
    chemical_industries: "FILCEM-CGIL",
    extraction: "FILCEM-CGIL",
  },
};

/**
 * 1999 era. Diffs from 2007:
 * - UK: Unite (2007), Prospect (2001) and Amicus (2001) do not exist; the
 *   engineering union was the AEEU (1992 merger), white-collar technical
 *   staff were in MSF, and bank staff in BIFU.
 * - DE: ver.di formed 2001; its predecessors (ÖTV, HBV, IG Medien, Deutsche
 *   Postgewerkschaft, DAG) are used. GGLF merged into IG BAU in 1996, so
 *   agriculture stays IG BAU.
 * - JP: UI Zensen formed 2002; Zensen Dōmei is the pre-merger federation.
 * - IE: INMO name dates from 2010 (Irish Nurses Organisation before),
 *   Financial Services Union from 2017 (IBOA before), Connect from 2017
 *   (TEEU, formed 1992, before).
 * - IT: FILCEM formed 2006; FILCEA-CGIL (chemicals) precedes it.
 */
const NAMES_1999: UnionNameMap = {
  ...NAMES_2007,
  UK: {
    manufacturing: "Amalgamated Engineering and Electrical Union",
    automobiles: "Amalgamated Engineering and Electrical Union",
    defense: "Amalgamated Engineering and Electrical Union",
    extraction: "National Union of Mineworkers",
    energy: "GMB",
    chemical_industries: "GMB",
    construction: "Union of Construction, Allied Trades and Technicians",
    agriculture: "Transport and General Workers' Union",
    healthcare: "UNISON",
    retail: "Usdaw",
    logistics: "Transport and General Workers' Union",
    media: "National Union of Journalists",
    entertainment: "BECTU",
    telecommunications: "Communication Workers Union",
    technology: "Manufacturing, Science and Finance",
    financial: "Banking, Insurance and Finance Union",
    real_estate: "Union of Construction, Allied Trades and Technicians",
  },
  DE: {
    ...NAMES_MODERN.DE,
    healthcare: "ÖTV",
    logistics: "ÖTV",
    retail: "Gewerkschaft Handel, Banken und Versicherungen",
    financial: "Gewerkschaft Handel, Banken und Versicherungen",
    media: "IG Medien",
    entertainment: "IG Medien",
    telecommunications: "Deutsche Postgewerkschaft",
  },
  JP: {
    ...NAMES_2007.JP,
    chemical_industries: "Zensen Dōmei",
    retail: "Zensen Dōmei",
    media: "Zensen Dōmei",
    technology: "Zensen Dōmei",
    telecommunications: "Zensen Dōmei",
    entertainment: "Zensen Dōmei",
    agriculture: "Zensen Dōmei",
    real_estate: "Zensen Dōmei",
  },
  IE: {
    ...NAMES_MODERN.IE,
    healthcare: "Irish Nurses Organisation",
    financial: "Irish Bank Officials' Association",
    construction: "Technical Engineering and Electrical Union",
  },
  IT: {
    ...NAMES_2007.IT,
    chemical_industries: "FILCEA-CGIL",
    extraction: "FILCEA-CGIL",
  },
};

/**
 * 1991 era. Diffs from 1999:
 * - US: the union was formally the United Steelworkers of America; OCAW
 *   (merged away 1999) covers chemicals; IBEW stands in for technology and
 *   SAG (pre-AFTRA merger) for entertainment.
 * - UK: AEEU formed 1992, so 1991 keeps the Amalgamated Engineering Union;
 *   CWU formed 1995, so telecoms is the National Communications Union
 *   (1985-1995); COHSE only merged into UNISON in 1993.
 * - DE: IG BAU (1996), IG BCE (1997) and ver.di (2001) post-date 1991; their
 *   predecessors IG Bau-Steine-Erden, IG Bergbau und Energie, IG
 *   Chemie-Papier-Keramik, GGLF and ÖTV are used.
 * - JP: Dōmei dissolved into Rengō in 1989; Zensen Dōmei, Denki Rōren, the
 *   telecom workers' Zendentsū and the coal miners' Tanrō are era-correct.
 * - RU: the AUCCTU reorganised into the General Confederation of Trade
 *   Unions in October 1990, so a 1991 USSR world uses the successor body.
 * - Eastern bloc 1991: CNSLR (Romania, 1990; the National Trade Union Bloc
 *   only appeared mid-1991) and the Czech and Slovak Confederation of Trade
 *   Unions (ČMKOS is post-split, 1993+). KNSB (Bulgaria, 1990), FPB
 *   (Belarus, 1990), MSZOSZ (Hungary, 1990) and Solidarność are all live.
 * - SE: IF Metall (2006), Unionen (2008), Vårdförbundet (1997 name) and
 *   Finansförbundet post-date 1991; Metall, SIF and Svenska
 *   Bankmannaförbundet are used, farm workers still have
 *   Lantarbetareförbundet, and care workers are mapped to Kommunal (the
 *   dominant care-sector union of the day).
 * - IE: Mandate (1994) and TEEU-successor names post-date 1991; IDATU and
 *   IBOA are era-correct, and construction falls back to the generic name.
 * - IT: SLC-CGIL formed 1996 (FILPT before); FLAI (1988), FILT (1980),
 *   FP (1980) and FISAC (1983) already exist. No era-correct entertainment
 *   federation is attestable, so it falls back to the generic name.
 */
const NAMES_1991: UnionNameMap = {
  ...NAMES_1999,
  US: {
    ...NAMES_MODERN.US,
    manufacturing: "United Steelworkers of America",
    chemical_industries: "Oil, Chemical and Atomic Workers Union",
    media: "The Newspaper Guild",
    healthcare: "Service Employees International Union",
    technology: "International Brotherhood of Electrical Workers",
    entertainment: "Screen Actors Guild",
  },
  UK: {
    ...NAMES_1999.UK,
    manufacturing: "Amalgamated Engineering Union",
    automobiles: "Amalgamated Engineering Union",
    defense: "Amalgamated Engineering Union",
    healthcare: "COHSE",
    telecommunications: "National Communications Union",
  },
  DE: {
    ...NAMES_1999.DE,
    chemical_industries: "IG Chemie-Papier-Keramik",
    construction: "IG Bau-Steine-Erden",
    real_estate: "IG Bau-Steine-Erden",
    energy: "IG Bergbau und Energie",
    extraction: "IG Bergbau und Energie",
    agriculture: "Gewerkschaft Gartenbau, Land- und Forstwirtschaft",
  },
  JP: {
    manufacturing: "Japanese Trade Union Confederation",
    automobiles: "Confederation of Japan Automobile Workers' Unions",
    chemical_industries: "Japanese Federation of Synthetic Chemistry Workers' Unions",
    construction: "National Federation of Construction Workers' Unions",
    // Attribution to a single-era energy federation is uncertain; this is the
    // long-standing electric power workers' federation label.
    energy: "Japanese Federation of Electric Wire and Electric Power Workers' Unions",
    extraction: "Japan Coal Miners' Union",
    healthcare: "Japan Federation of Medical Workers' Unions",
    retail: "Zensen Dōmei",
    media: "Japan Federation of Publishing Workers' Unions",
    logistics: "All Japan Seamen's Union",
    technology: "Japanese Federation of Electrical Machine Workers' Unions",
    financial: "National Federation of Finance Industry Workers' Unions",
    telecommunications: "Japan Telecommunications Workers' Union",
  },
  RU: uniform("General Confederation of Trade Unions"),
  RO: uniform("National Confederation of Free Trade Unions of Romania"),
  CS: uniform("Czech and Slovak Confederation of Trade Unions"),
  SE: {
    ...NAMES_MODERN.SE,
    manufacturing: "Metall",
    automobiles: "Metall",
    chemical_industries: "Metall",
    extraction: "Metall",
    defense: "Metall",
    energy: "SIF",
    technology: "SIF",
    telecommunications: "SIF",
    entertainment: "SIF",
    healthcare: "Kommunal",
    financial: "Svenska Bankmannaförbundet",
    agriculture: "Svenska Lantarbetareförbundet",
  },
  IE: {
    manufacturing: "SIPTU",
    automobiles: "SIPTU",
    energy: "SIPTU",
    logistics: "SIPTU",
    technology: "SIPTU",
    healthcare: "Irish Nurses Organisation",
    retail: "Irish Distributive and Administrative Trade Union",
    media: "National Union of Journalists",
    financial: "Irish Bank Officials' Association",
    telecommunications: "Communications Workers' Union",
  },
  IT: {
    manufacturing: "FIOM-CGIL",
    automobiles: "FIOM-CGIL",
    technology: "FIOM-CGIL",
    defense: "FIOM-CGIL",
    chemical_industries: "FILCEA-CGIL",
    extraction: "FILCEA-CGIL",
    construction: "FILLEA-CGIL",
    real_estate: "FILLEA-CGIL",
    energy: "FLAEI-CISL",
    healthcare: "FP-CGIL",
    retail: "Filcams-CGIL",
    media: "FNSI",
    logistics: "FILT-CGIL",
    financial: "FISAC-CGIL",
    telecommunications: "FILPT-CGIL",
    agriculture: "FLAI-CGIL",
  },
  TR: {
    ...NAMES_MODERN.TR,
    // Sağlık-Sen dates from 1995; Sağlık-İş (Türk-İş, 1961) precedes it.
    healthcare: "Sağlık-İş",
  },
};

/**
 * 1979 era. Diffs from 1991:
 * - US: UFCW only formed mid-1979; the Retail Clerks International
 *   Association is the pre-merger union.
 * - UK: AEU was the AUEW 1971-1986; GMB was the General and Municipal
 *   Workers' Union; MSF (1988) was ASTMS; CWU-lineage telecoms was the
 *   Union of Post Office Workers; BIFU was still NUBE at the start of 1979;
 *   farm workers were the NUAAW (renamed from NUAW in 1968); BECTU (1991)
 *   was the ACTT.
 * - DE: IG Medien formed 1989; printing/media was IG Druck und Papier and
 *   white-collar entertainment maps to DAG.
 * - JP: Rengō formed 1989, so the peak body is Sōhyō. Sectorals founded by
 *   1979 (JAW 1972, Zensen Dōmei, Denki Rōren 1953, Zendentsū 1950, Tanrō
 *   1950, Iroren 1957, seamen 1945) are kept; no defensible-era aviation or
 *   entertainment union is attestable, so those fall back to generic names.
 * - USSR/Eastern bloc: AUCCTU (VTsSPS) for the USSR and its republics
 *   (Belarus, the Baltic composite); Poland is the CRZZ because Solidarność
 *   was only founded in August 1980; SZOT (Hungary), UGSR (Romania), the
 *   Central Council of the Bulgarian Trade Unions, and ROH (Czechoslovakia).
 * - BR: CUT formed 1983; the corporatist confederations CNTI (industry,
 *   1946), CNTC (commerce, 1946), CNTTT (land transport) and CONTAG
 *   (rural workers, 1963) are era-correct.
 * - IE: SIPTU formed 1990; the ITGWU is the era's general union, IDATU
 *   (renamed from IUDWC in 1972) covers retail, and the Post Office
 *   Workers' Union covers telecoms.
 * - IT: FP (1980), FILT (1980), FISAC (1983) and FLAI (1988) post-date
 *   1979; Federbraccianti was the CGIL farm labourers' federation.
 * - NG: the NLC (1978) and its industrial affiliates are era-correct; the
 *   modern private-telecom staff association is not.
 */
const NAMES_1979: UnionNameMap = {
  ...NAMES_1991,
  US: {
    ...NAMES_1991.US,
    retail: "Retail Clerks International Association",
  },
  UK: {
    manufacturing: "Amalgamated Union of Engineering Workers",
    automobiles: "Amalgamated Union of Engineering Workers",
    defense: "Amalgamated Union of Engineering Workers",
    extraction: "National Union of Mineworkers",
    energy: "General and Municipal Workers' Union",
    chemical_industries: "General and Municipal Workers' Union",
    construction: "Union of Construction, Allied Trades and Technicians",
    agriculture: "National Union of Agricultural and Allied Workers",
    healthcare: "Confederation of Health Service Employees",
    retail: "Union of Shop, Distributive and Allied Workers",
    logistics: "Transport and General Workers' Union",
    media: "National Union of Journalists",
    entertainment: "Association of Cinematograph, Television and Allied Technicians",
    telecommunications: "Union of Post Office Workers",
    technology: "Association of Scientific, Technical and Managerial Staffs",
    financial: "National Union of Bank Employees",
    real_estate: "Union of Construction, Allied Trades and Technicians",
  },
  DE: {
    ...NAMES_1991.DE,
    media: "IG Druck und Papier",
    entertainment: "Deutsche Angestellten-Gewerkschaft",
  },
  JP: {
    manufacturing: "General Council of Trade Unions of Japan",
    automobiles: "Confederation of Japan Automobile Workers' Unions",
    chemical_industries: "Japanese Federation of Synthetic Chemistry Workers' Unions",
    construction: "National Federation of Construction Workers' Unions",
    energy: "Japanese Federation of Electric Wire and Electric Power Workers' Unions",
    extraction: "Japan Coal Miners' Union",
    healthcare: "Japan Federation of Medical Workers' Unions",
    retail: "Zensen Dōmei",
    media: "Japan Federation of Publishing Workers' Unions",
    logistics: "All Japan Seamen's Union",
    technology: "Japanese Federation of Electrical Machine Workers' Unions",
    financial: "National Federation of Finance Industry Workers' Unions",
    telecommunications: "Japan Telecommunications Workers' Union",
  },
  RU: uniform("All-Union Central Council of Trade Unions"),
  PL: uniform("Central Council of Trade Unions"),
  HU: uniform("National Council of Trade Unions"),
  RO: uniform("General Union of Trade Unions of Romania"),
  BG: uniform("Central Council of the Bulgarian Trade Unions"),
  CS: uniform("Revolutionary Trade Union Movement"),
  // The union republics had no separate union federation of their own: the
  // AUCCTU was a single all-Union body with republican councils under it, so all
  // three report the same name rather than an invented republican confederation.
  UKR: uniform("All-Union Central Council of Trade Unions"),
  BLR: uniform("All-Union Central Council of Trade Unions"),
  BAL: uniform("All-Union Central Council of Trade Unions"),
  BR: {
    manufacturing: "National Confederation of Industrial Workers",
    automobiles: "National Confederation of Industrial Workers",
    chemical_industries: "National Confederation of Industrial Workers",
    extraction: "National Confederation of Industrial Workers",
    energy: "National Confederation of Industrial Workers",
    technology: "National Confederation of Industrial Workers",
    defense: "National Confederation of Industrial Workers",
    retail: "National Confederation of Commerce Workers",
    logistics: "National Confederation of Land Transport Workers",
    agriculture: "CONTAG",
  },
  IE: {
    manufacturing: "Irish Transport and General Workers' Union",
    automobiles: "Irish Transport and General Workers' Union",
    energy: "Irish Transport and General Workers' Union",
    logistics: "Irish Transport and General Workers' Union",
    technology: "Irish Transport and General Workers' Union",
    healthcare: "Irish Nurses Organisation",
    retail: "Irish Distributive and Administrative Trade Union",
    media: "National Union of Journalists",
    financial: "Irish Bank Officials' Association",
    telecommunications: "Post Office Workers' Union",
  },
  IT: {
    manufacturing: "FIOM-CGIL",
    automobiles: "FIOM-CGIL",
    technology: "FIOM-CGIL",
    defense: "FIOM-CGIL",
    chemical_industries: "FILCEA-CGIL",
    extraction: "FILCEA-CGIL",
    construction: "FILLEA-CGIL",
    real_estate: "FILLEA-CGIL",
    energy: "FLAEI-CISL",
    retail: "Filcams-CGIL",
    media: "FNSI",
    telecommunications: "FILPT-CGIL",
    agriculture: "Federbraccianti-CGIL",
  },
  NG: {
    ...NAMES_MODERN.NG,
    telecommunications: "Nigeria Labour Congress",
  },
};

/**
 * 1953 era. Diffs from 1979:
 * - US: the AFL and CIO are still separate (they merge in 1955), so only
 *   individual internationals appear. OCAW formed 1955; the Oil Workers
 *   International Union precedes it. The American Newspaper Guild only took
 *   the shorter name in 1971. The Retail Clerks were the RCIA (renamed from
 *   the Protective Association in 1947). The IAM added "Aerospace" in 1964.
 * - UK: COHSE (1946) replaces the regulator-not-a-union "CPSM"; NUDAW merged
 *   into USDAW in 1947; the AEU predates the AUEW; ACTT was still the
 *   Association of Cine-Technicians until 1956; power workers were the ETU.
 * - DE: IG Bergbau only added "und Energie" in 1960; ÖTV, HBV, DAG, GGLF and
 *   GdED carry their full founding names.
 * - JP: blanket Sōhyō (founded 1950) with the handful of sectorals already
 *   alive in 1953: Zenji (the all-Japan auto workers' union, 1947-1954),
 *   Zendentsū (1950), Tanrō (1950) and the seamen's union (1945).
 * - RO: the CGM only became the UGSR in 1966.
 * - NG: colonial-era Nigeria's labour centre of 1953 is the All-Nigeria
 *   Trade Union Federation (formed during 1953).
 * - TR: Türk-İş (1952) plus the few affiliates already founded (Petrol-İş
 *   1950, TÜMTİS 1949, Genel Maden-İş 1946).
 * - ES: under Franco free trade unions are banned; the only legal body is
 *   the state's Organización Sindical Española (the vertical syndicate).
 * - BR: only the corporatist CNTI/CNTC are defensible; rural unionisation
 *   is pre-legalisation, so agriculture falls back to the generic name.
 * - IE: IDATU was still the Irish Union of Distributive Workers and Clerks.
 */
const NAMES_1953: UnionNameMap = {
  ...NAMES_1979,
  US: {
    manufacturing: "United Steelworkers of America",
    automobiles: "United Auto Workers",
    extraction: "United Mine Workers of America",
    energy: "Utility Workers Union of America",
    construction: "United Brotherhood of Carpenters and Joiners",
    logistics: "International Brotherhood of Teamsters",
    media: "American Newspaper Guild",
    defense: "International Association of Machinists",
    telecommunications: "Communications Workers of America",
    chemical_industries: "Oil Workers International Union",
    entertainment: "Screen Actors Guild",
    retail: "Retail Clerks International Association",
  },
  UK: {
    manufacturing: "Amalgamated Engineering Union",
    automobiles: "Amalgamated Engineering Union",
    extraction: "National Union of Mineworkers",
    energy: "Electrical Trades Union",
    construction: "National Federation of Building Trade Operatives",
    healthcare: "Confederation of Health Service Employees",
    retail: "Union of Shop, Distributive and Allied Workers",
    logistics: "National Union of Railwaymen",
    media: "National Union of Journalists",
    telecommunications: "Union of Post Office Workers",
    chemical_industries: "National Union of General and Municipal Workers",
    technology: "Amalgamated Engineering Union",
    financial: "National Union of Bank Employees",
    entertainment: "Association of Cine-Technicians",
    defense: "Amalgamated Engineering Union",
    agriculture: "National Union of Agricultural Workers",
    real_estate: "National Federation of Building Trade Operatives",
  },
  DE: {
    manufacturing: "IG Metall",
    automobiles: "IG Metall",
    chemical_industries: "IG Chemie-Papier-Keramik",
    construction: "IG Bau-Steine-Erden",
    energy: "IG Bergbau",
    extraction: "IG Bergbau",
    healthcare: "Gewerkschaft Öffentliche Dienste, Transport und Verkehr",
    retail: "Gewerkschaft Handel, Banken und Versicherungen",
    media: "Deutsche Angestellten-Gewerkschaft",
    logistics: "Gewerkschaft der Eisenbahner Deutschlands",
    technology: "IG Metall",
    financial: "Gewerkschaft Handel, Banken und Versicherungen",
    telecommunications: "Deutsche Postgewerkschaft",
    entertainment: "Deutsche Angestellten-Gewerkschaft",
    defense: "IG Metall",
    agriculture: "Gewerkschaft Gartenbau, Land- und Forstwirtschaft",
    real_estate: "IG Bau-Steine-Erden",
  },
  JP: {
    ...uniform("General Council of Trade Unions of Japan"),
    automobiles: "All Japan Automobile Industry Workers' Union",
    telecommunications: "Japan Telecommunications Workers' Union",
    logistics: "All Japan Seamen's Union",
    extraction: "Japan Coal Miners' Union",
  },
  RO: uniform("General Confederation of Labour"),
  NG: uniform("All-Nigeria Trade Union Federation"),
  TR: {
    ...uniform("Türk-İş"),
    chemical_industries: "Petrol-İş",
    logistics: "TÜMTİS",
    extraction: "Genel Maden-İş",
  },
  ES: uniform("Organización Sindical Española"),
  BR: {
    manufacturing: "National Confederation of Industrial Workers",
    automobiles: "National Confederation of Industrial Workers",
    chemical_industries: "National Confederation of Industrial Workers",
    extraction: "National Confederation of Industrial Workers",
    energy: "National Confederation of Industrial Workers",
    technology: "National Confederation of Industrial Workers",
    defense: "National Confederation of Industrial Workers",
    retail: "National Confederation of Commerce Workers",
  },
  IE: {
    ...NAMES_1979.IE,
    retail: "Irish Union of Distributive Workers and Clerks",
  },
};

/** Era-keyed historical union names. Later eras inherit via lookup fallback rules in `getUnionName`. */
export const UNION_NAMES_BY_ERA: Partial<Record<EraId, UnionNameMap>> = {
  "1953": NAMES_1953,
  "1979": NAMES_1979,
  "1991": NAMES_1991,
  "1999": NAMES_1999,
  "2007": NAMES_2007,
  "2019": NAMES_MODERN,
  "2023": NAMES_MODERN,
};
