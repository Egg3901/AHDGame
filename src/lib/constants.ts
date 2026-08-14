/**
 * Barrel re-export + US visual assets.
 *
 * This file coexists with the `constants/` directory intentionally:
 * - Defines US_STATES, STATE_IMAGES, STATE_FLAGS, PARTY_LOGOS, STATE_DESCRIPTORS
 * - Re-exports from constants/states, constants/cabinet, constants/turnTime
 * - 47+ files import from `@/lib/constants` — do not move without updating all of them
 *
 * The `constants/` directory contains modular constant files (countries, states, cabinet, etc.).
 */

/**
 * All US state abbreviations in alphabetical order
 */
export const US_STATES = [
  "AL",
  "AK",
  "AZ",
  "AR",
  "CA",
  "CO",
  "CT",
  "DE",
  "FL",
  "GA",
  "HI",
  "ID",
  "IL",
  "IN",
  "IA",
  "KS",
  "KY",
  "LA",
  "ME",
  "MD",
  "MA",
  "MI",
  "MN",
  "MS",
  "MO",
  "MT",
  "NE",
  "NV",
  "NH",
  "NJ",
  "NM",
  "NY",
  "NC",
  "ND",
  "OH",
  "OK",
  "OR",
  "PA",
  "RI",
  "SC",
  "SD",
  "TN",
  "TX",
  "UT",
  "VT",
  "VA",
  "WA",
  "WV",
  "WI",
  "WY",
] as const;

export type StateAbbreviation = (typeof US_STATES)[number];

/**
 * Representative landmark/landscape photos for each state.
 * All URLs verified via the Wikipedia pageimages API. Freely licensed via Wikimedia Commons.
 */
export const STATE_IMAGES: Record<string, string> = {
  AL: "https://upload.wikimedia.org/wikipedia/commons/thumb/2/23/Birmingham_cityscape_view_2010.jpg/1280px-Birmingham_cityscape_view_2010.jpg",
  AK: "https://upload.wikimedia.org/wikipedia/commons/thumb/9/91/Wonder_Lake_and_Denali.jpg/1280px-Wonder_Lake_and_Denali.jpg",
  AZ: "https://upload.wikimedia.org/wikipedia/commons/thumb/3/31/Canyon_River_Tree_%28165872763%29.jpeg/1280px-Canyon_River_Tree_%28165872763%29.jpeg",
  AR: "https://upload.wikimedia.org/wikipedia/commons/thumb/f/f7/Morning_on_the_Buffalo_River.jpg/1280px-Morning_on_the_Buffalo_River.jpg",
  CA: "https://upload.wikimedia.org/wikipedia/commons/thumb/b/bf/Golden_Gate_Bridge_as_seen_from_Battery_East.jpg/1280px-Golden_Gate_Bridge_as_seen_from_Battery_East.jpg",
  CO: "https://upload.wikimedia.org/wikipedia/commons/thumb/3/3e/Rocky_Mountain_National_Park_in_September_2011_-_Glacier_Gorge_from_Bear_Lake.JPG/1280px-Rocky_Mountain_National_Park_in_September_2011_-_Glacier_Gorge_from_Bear_Lake.JPG",
  CT: "https://upload.wikimedia.org/wikipedia/commons/3/30/House_of_Mark_Twain.jpg",
  DE: "https://upload.wikimedia.org/wikipedia/commons/thumb/6/67/Rehoboth_Beach_boardwalk_looking_north_toward_Rehoboth_Avenue.jpg/1280px-Rehoboth_Beach_boardwalk_looking_north_toward_Rehoboth_Avenue.jpg",
  FL: "https://upload.wikimedia.org/wikipedia/commons/thumb/5/5f/Lake-eola-park-orlando-florida.jpg/1280px-Lake-eola-park-orlando-florida.jpg",
  GA: "https://upload.wikimedia.org/wikipedia/commons/thumb/c/c8/A2ATL20250614-0721_%28cropped%29.jpg/1280px-A2ATL20250614-0721_%28cropped%29.jpg",
  HI: "https://upload.wikimedia.org/wikipedia/commons/thumb/9/93/Diamond_Head_Hawaii_From_Round_Top_Rd.JPG/1280px-Diamond_Head_Hawaii_From_Round_Top_Rd.JPG",
  ID: "https://upload.wikimedia.org/wikipedia/commons/thumb/b/b1/Shoshone_Falls%2C_Idaho.jpg/1280px-Shoshone_Falls%2C_Idaho.jpg",
  IL: "https://upload.wikimedia.org/wikipedia/commons/thumb/a/a5/Chicago_River_ferry_b.jpg/1280px-Chicago_River_ferry_b.jpg",
  IN: "https://upload.wikimedia.org/wikipedia/commons/thumb/9/95/Indianapolis-1872528.jpg/1280px-Indianapolis-1872528.jpg",
  IA: "https://upload.wikimedia.org/wikipedia/commons/thumb/b/b5/Big_bear_mound_at_Effigy_Mounds_State_Park.jpg/1280px-Big_bear_mound_at_Effigy_Mounds_State_Park.jpg",
  KS: "https://upload.wikimedia.org/wikipedia/commons/thumb/e/e3/Sunset_falls_across_the_beautiful_Flint_Hills_%28f0f6c731-1dd8-b71b-0b88-d326127c9973%29.jpg/1280px-Sunset_falls_across_the_beautiful_Flint_Hills_%28f0f6c731-1dd8-b71b-0b88-d326127c9973%29.jpg",
  KY: "https://upload.wikimedia.org/wikipedia/commons/thumb/7/70/Mammoth_Cave_Rotunda_%28USGS_Lwt02830%29.jpg/1280px-Mammoth_Cave_Rotunda_%28USGS_Lwt02830%29.jpg",
  LA: "https://upload.wikimedia.org/wikipedia/commons/8/8f/French_Quarter%2C_looking_north_with_Mississippi_River_to_the_right_2011.jpg",
  ME: "https://upload.wikimedia.org/wikipedia/commons/thumb/c/c7/Bar_Harbor_Main_Street_DSC_0950_AD.JPG/1280px-Bar_Harbor_Main_Street_DSC_0950_AD.JPG",
  MD: "https://upload.wikimedia.org/wikipedia/commons/thumb/1/12/Some_Annapolis_commercial_strip.jpg/1280px-Some_Annapolis_commercial_strip.jpg",
  MA: "https://upload.wikimedia.org/wikipedia/commons/thumb/9/96/ISH_WC_Boston4.jpg/1280px-ISH_WC_Boston4.jpg",
  MI: "https://upload.wikimedia.org/wikipedia/commons/thumb/4/45/Detroit_Skyline_from_Windsor_2025-09-01.jpg/1280px-Detroit_Skyline_from_Windsor_2025-09-01.jpg",
  MN: "https://upload.wikimedia.org/wikipedia/commons/thumb/3/31/Minneapolis_Skyline_looking_south.jpg/1280px-Minneapolis_Skyline_looking_south.jpg",
  MS: "https://upload.wikimedia.org/wikipedia/commons/thumb/0/05/Eola_view%2C_U.S._Courthouse%2C_Natchez%2C_Mississippi_LCCN2010719141.tif/lossy-page1-1280px-Eola_view%2C_U.S._Courthouse%2C_Natchez%2C_Mississippi_LCCN2010719141.tif.jpg",
  MO: "https://upload.wikimedia.org/wikipedia/commons/thumb/0/00/St_Louis_night_expblend_cropped.jpg/1280px-St_Louis_night_expblend_cropped.jpg",
  MT: "https://upload.wikimedia.org/wikipedia/commons/thumb/5/51/Mountain_Goat_at_Hidden_Lake.jpg/1280px-Mountain_Goat_at_Hidden_Lake.jpg",
  NE: "https://upload.wikimedia.org/wikipedia/commons/thumb/b/b6/Chimney_Rock_NE.jpg/1280px-Chimney_Rock_NE.jpg",
  NV: "https://upload.wikimedia.org/wikipedia/commons/thumb/e/ee/Las_Vegas_Strip_09_2017_4897.jpg/1280px-Las_Vegas_Strip_09_2017_4897.jpg",
  NH: "https://upload.wikimedia.org/wikipedia/commons/thumb/6/68/Sandwich_Range.jpg/1280px-Sandwich_Range.jpg",
  NJ: "https://upload.wikimedia.org/wikipedia/commons/thumb/b/b5/Cape_May_Beach_Ave_from_the_sea_3.JPG/1280px-Cape_May_Beach_Ave_from_the_sea_3.JPG",
  NM: "https://upload.wikimedia.org/wikipedia/commons/thumb/4/4f/Taos_Pueblo_2017-05-05.jpg/1280px-Taos_Pueblo_2017-05-05.jpg",
  NY: "https://upload.wikimedia.org/wikipedia/commons/thumb/7/7a/View_of_Empire_State_Building_from_Rockefeller_Center_New_York_City_dllu_%28cropped%29.jpg/1280px-View_of_Empire_State_Building_from_Rockefeller_Center_New_York_City_dllu_%28cropped%29.jpg",
  NC: "https://upload.wikimedia.org/wikipedia/commons/0/0c/Cape_hatteras_lighthouse_img_0529.jpg",
  ND: "https://upload.wikimedia.org/wikipedia/commons/thumb/3/34/View_of_Theodore_Roosevelt_National_Park.jpg/1280px-View_of_Theodore_Roosevelt_National_Park.jpg",
  OH: "https://upload.wikimedia.org/wikipedia/commons/thumb/5/5c/Downtown_Cincinnati_viewed_from_Devou_Park_%28cropped%29.jpg/1280px-Downtown_Cincinnati_viewed_from_Devou_Park_%28cropped%29.jpg",
  OK: "https://upload.wikimedia.org/wikipedia/commons/thumb/6/66/Downtown_Oklahoma_City_skyline_at_twilight.jpg/1280px-Downtown_Oklahoma_City_skyline_at_twilight.jpg",
  OR: "https://upload.wikimedia.org/wikipedia/commons/thumb/0/01/Crater_Lake_winter_pano2.jpg/1280px-Crater_Lake_winter_pano2.jpg",
  PA: "https://upload.wikimedia.org/wikipedia/commons/thumb/d/d6/Ascending_the_Duquesne_Incline.jpg/1280px-Ascending_the_Duquesne_Incline.jpg",
  RI: "https://upload.wikimedia.org/wikipedia/commons/thumb/e/ec/Providence_RI_skyline.jpg/1280px-Providence_RI_skyline.jpg",
  SC: "https://upload.wikimedia.org/wikipedia/commons/thumb/2/2e/East_Battery_Street_Charleston_Aug2010.jpg/1280px-East_Battery_Street_Charleston_Aug2010.jpg",
  SD: "https://upload.wikimedia.org/wikipedia/commons/thumb/8/87/Mount_Rushmore_detail_view_%28100MP%29.jpg/1280px-Mount_Rushmore_detail_view_%28100MP%29.jpg",
  TN: "https://upload.wikimedia.org/wikipedia/commons/thumb/e/e4/Parthenon_Nashville.png/1280px-Parthenon_Nashville.png",
  TX: "https://upload.wikimedia.org/wikipedia/commons/thumb/a/a3/Texas_medical_center.jpg/1280px-Texas_medical_center.jpg",
  UT: "https://upload.wikimedia.org/wikipedia/commons/thumb/f/f0/Delicate_arch_sunset.jpg/1280px-Delicate_arch_sunset.jpg",
  VT: "https://upload.wikimedia.org/wikipedia/commons/thumb/b/bb/NewEngland_Fall.jpg/1280px-NewEngland_Fall.jpg",
  VA: "https://upload.wikimedia.org/wikipedia/commons/thumb/7/7c/A_downtown_view_of_Richmond%2C_VA.jpg/1280px-A_downtown_view_of_Richmond%2C_VA.jpg",
  WA: "https://upload.wikimedia.org/wikipedia/commons/thumb/5/58/Seattle_Center_as_night_falls.jpg/1280px-Seattle_Center_as_night_falls.jpg",
  WV: "https://upload.wikimedia.org/wikipedia/commons/thumb/1/11/New_River_Gorge_Bridge.jpg/1280px-New_River_Gorge_Bridge.jpg",
  WI: "https://upload.wikimedia.org/wikipedia/commons/thumb/b/b4/Milwaukee_Skyline_w_New_NW_Mutual_Building_2025_by_Isaac_Rowlett.jpg/1280px-Milwaukee_Skyline_w_New_NW_Mutual_Building_2025_by_Isaac_Rowlett.jpg",
  WY: "https://upload.wikimedia.org/wikipedia/commons/7/73/Grand_Canyon_of_yellowstone.jpg",
};

/**
 * Generic fallback used when a state has no entry in `STATE_IMAGES` (e.g.
 * DC, territories, or any future ID added without a hand-picked image).
 * Statue of Liberty — neutral and works for any US-context banner.
 */
const US_DEFAULT_IMAGE =
  "https://upload.wikimedia.org/wikipedia/commons/thumb/a/a1/Statue_of_Liberty_7.jpg/1280px-Statue_of_Liberty_7.jpg";

/**
 * Get a representative landmark/landscape photo for a US state. Mirrors the
 * `getUKRegionImage` / `getJPRegionImage` / `getDERegionImage` helpers so a
 * country-agnostic dispatcher (e.g. the Governor's Office page banner) can
 * resolve every country's region image with a uniform call signature.
 */
export function getUSStateImage(stateId: string): string {
  return STATE_IMAGES[stateId] ?? US_DEFAULT_IMAGE;
}

export {
  STATE_FLAGS,
  getCountryFlagUrl,
  getCountryFlagUrlForEra,
  resolveCountryFlagCode,
} from "./constants/flags";

/**
 * Official descriptors for each state (e.g. "State of", "Commonwealth of")
 */
export const STATE_DESCRIPTORS: Record<string, string> = {
  KY: "The Commonwealth of",
  MA: "The Commonwealth of",
  PA: "The Commonwealth of",
  VA: "The Commonwealth of",
  // Default for others is "The State of"
};

export function getStateDescriptor(stateId: string, regionLabel?: string): string {
  if (STATE_DESCRIPTORS[stateId]) return STATE_DESCRIPTORS[stateId];
  if (regionLabel) return `The ${regionLabel} of`;
  return "The State of";
}

/**
 * Official mottos for US states and DC.
 */
export const STATE_MOTTOS: Record<string, string> = {
  AL: "We Dare Defend Our Rights",
  AK: "North to the Future",
  AZ: "God Enriches",
  AR: "The People Rule",
  CA: "Eureka",
  CO: "Nothing Without Providence",
  CT: "He Who Transplanted Still Sustains",
  DE: "Liberty and Independence",
  FL: "In God We Trust",
  GA: "Wisdom, Justice, Moderation",
  HI: "The Life of the Land is Perpetuated in Righteousness",
  ID: "Let It Be Perpetual",
  IL: "State Sovereignty, National Union",
  IN: "The Crossroads of America",
  IA: "Our Liberties We Prize and Our Rights We Will Maintain",
  KS: "To the Stars Through Difficulties",
  KY: "United We Stand, Divided We Fall",
  LA: "Union, Justice, and Confidence",
  ME: "I Lead",
  MD: "Manly Deeds, Womanly Words",
  MA: "By the Sword We Seek Peace, but Peace Only Under Liberty",
  MI: "If You Seek a Pleasant Peninsula, Look About You",
  MN: "Star of the North",
  MS: "By Valor and Arms",
  MO: "The Welfare of the People Shall Be the Supreme Law",
  MT: "Gold and Silver",
  NE: "Equality Before the Law",
  NV: "Battle Born",
  NH: "Live Free or Die",
  NJ: "Liberty and Prosperity",
  NM: "It Grows as It Goes",
  NY: "Ever Upward",
  NC: "To Be Rather Than to Seem",
  ND: "Liberty and Union, Now and Forever, One and Inseparable",
  OH: "With God, All Things Are Possible",
  OK: "Labor Conquers All Things",
  OR: "She Flies with Her Own Wings",
  PA: "Virtue, Liberty, and Independence",
  RI: "Hope",
  SC: "While I Breathe, I Hope",
  SD: "Under God the People Rule",
  TN: "Agriculture and Commerce",
  TX: "Friendship",
  UT: "Industry",
  VT: "Freedom and Unity",
  VA: "Thus Always to Tyrants",
  WA: "By and By",
  WV: "Mountaineers Are Always Free",
  WI: "Forward",
  WY: "Equal Rights",
  DC: "Justice for All",
};

/**
 * Party logos. Keys use format `${countryId}:${abbreviation}` (e.g.
 * `"US:DEM"`, `"UK:CON"`). Abbreviations are stable across reset
 * presets — they're defined on the seed itself in each `xxParties.ts`
 * file. Keying by `sequentialId` instead would alias preset-specific
 * defaults onto each other's logos: on a fresh `1991-default` boot the
 * filtered seed list collapses and e.g. DE's PDS would land at the
 * `sequentialId` Die Linke holds under `2019-default`, inheriting the
 * wrong asset.
 *
 * Wikimedia URLs point at the **original SVG file** (not the rendered
 * `/thumb/<N>px-…png`). Wikimedia started returning 400 on
 * `upload.wikimedia.org/.../thumb/...` thumbnail-render paths in 2026,
 * so we link the source SVGs directly. Browsers render SVG-via-`<img>`
 * fine, and `bypassNextImageOptimization` already short-circuits the
 * Next image proxy for these URLs (the proxy doesn't reliably follow
 * the 302 hop).
 *
 * To add new entries, find the file on Wikimedia Commons / Wikipedia and
 * use the path under `/wikipedia/commons/X/XX/Filename.svg` — drop
 * `/thumb` and any trailing `/<N>px-...` segment.
 */
export const PARTY_LOGOS: Record<string, string> = {
  // US parties
  "US:DEM": "https://upload.wikimedia.org/wikipedia/commons/0/02/DemocraticLogo.svg",
  "US:REP": "https://upload.wikimedia.org/wikipedia/commons/9/9b/Republicanlogo.svg",
  // UK parties (2019-default + 1991-default)
  "UK:LAB":
    "https://assets.lbc.co.uk/2016/29/labour-party-logo---lbc-1468834582-editorial-long-form-0.jpg",
  "UK:CON": "https://upload.wikimedia.org/wikipedia/en/a/a0/Conservatives_logo.svg",
  "UK:LD":
    "https://upload.wikimedia.org/wikipedia/commons/8/8a/British_party_Liberal_Democrats.svg",
  "UK:SNP": "https://upload.wikimedia.org/wikipedia/commons/1/1b/Scottish_National_Party_Logo.svg",
  "UK:PC": "https://upload.wikimedia.org/wikipedia/commons/3/39/British_party_Plaid_Cymru.svg",
  "UK:GRN":
    "https://upload.wikimedia.org/wikipedia/en/a/ab/Green_Party_of_England_and_Wales_logo.svg",
  "UK:RUK": "https://upload.wikimedia.org/wikipedia/commons/6/68/Reform_UK_BBC_Logo.svg",
  "UK:DUP":
    "https://upload.wikimedia.org/wikipedia/commons/1/16/Democratic_Unionist_Party_wordmark.svg",
  "UK:SF": "https://upload.wikimedia.org/wikipedia/commons/8/83/Sinn_F%C3%A9in_wordmark.svg",
  // 1991-only: UUP logo lives on English Wikipedia (fair-use), not Commons.
  "UK:UUP":
    "https://en.wikipedia.org/wiki/Special:FilePath/Ulster_Unionist_Party_logo_%282017%29.svg",
  // DE parties (2019-default + 1991-default). Some reuse the official
  // party flag SVG since the flag *is* the canonical brand asset on
  // Wikimedia Commons.
  "DE:SPD":
    "https://upload.wikimedia.org/wikipedia/commons/d/df/Flag_of_the_Social_Democratic_Party_of_Germany.svg",
  "DE:CDU": "https://upload.wikimedia.org/wikipedia/commons/9/97/Flag_of_CDU_2023.svg",
  "DE:CSU":
    "https://upload.wikimedia.org/wikipedia/commons/a/aa/Flag_of_the_Christian_Social_Union_in_Bavaria.svg",
  "DE:GRN":
    "https://upload.wikimedia.org/wikipedia/commons/5/51/B%C3%BCndnis_90_-_Die_Gr%C3%BCnen_Logo_%28transparent%29.svg",
  "DE:FDP": "https://upload.wikimedia.org/wikipedia/commons/4/47/Logo_fdp_bundestagsfraktion.svg",
  "DE:LNK": "https://commons.wikimedia.org/wiki/Special:FilePath/Logo_Die_Linke_%282023%29.svg",
  "DE:AFD": "https://commons.wikimedia.org/wiki/Special:FilePath/AfD_Logo_2021.svg",
  // 1991-only: PDS (Partei des Demokratischen Sozialismus, 1989-2007 SED successor).
  "DE:PDS": "https://commons.wikimedia.org/wiki/Special:FilePath/PDS-Logo.svg",
  // JP parties (2019-default + 1991-default)
  "JP:LDP":
    "https://commons.wikimedia.org/wiki/Special:FilePath/Liberal_Democratic_Party_%28Japan%29_Emblem.svg",
  "JP:CDP":
    "https://commons.wikimedia.org/wiki/Special:FilePath/%E6%96%B0%E3%83%BB%E7%AB%8B%E6%86%B2%E6%B0%91%E4%B8%BB%E5%85%9A_%E3%83%AD%E3%82%B4.svg",
  "JP:KMT": "https://commons.wikimedia.org/wiki/Special:FilePath/Logo_of_Komeito.svg",
  "JP:JCP": "https://commons.wikimedia.org/wiki/Special:FilePath/Flag_of_JCP.svg",
  "JP:ISH": "https://commons.wikimedia.org/wiki/Special:FilePath/Nippon_Ishin_no_Kai-2021.svg",
  "JP:DPFP":
    "https://commons.wikimedia.org/wiki/Special:FilePath/Logo_of_Democratic_Party_For_the_People.svg",
  // 1991-only: JSP (日本社会党) and DSP (民社党).
  "JP:JSP":
    "https://commons.wikimedia.org/wiki/Special:FilePath/%E6%97%A5%E6%9C%AC%E7%A4%BE%E4%BC%9A%E5%85%9A%E3%83%AD%E3%82%B4.svg",
  "JP:DSP": "https://commons.wikimedia.org/wiki/Special:FilePath/Flag_of_DSPJ.svg",
  // IE parties (2019-default + 1991-default)
  "IE:FG": "https://commons.wikimedia.org/wiki/Special:FilePath/Fine_Gael_logo_2009.svg",
  "IE:FF":
    "https://commons.wikimedia.org/wiki/Special:FilePath/Fianna_F%C3%A1il_logo_%282024%29.svg",
  "IE:SF": "https://upload.wikimedia.org/wikipedia/commons/8/83/Sinn_F%C3%A9in_wordmark.svg",
  "IE:LAB":
    "https://commons.wikimedia.org/wiki/Special:FilePath/The_logo_of_Labour_Party_in_Ireland_2021.svg",
  "IE:GP": "https://commons.wikimedia.org/wiki/Special:FilePath/Green_Party_%28Ireland%29_logo.svg",
  // 1991-only: WP (logo on English Wikipedia fair-use) and PD.
  "IE:WP": "https://en.wikipedia.org/wiki/Special:FilePath/Workers%27_Party_%28Ireland%29_logo.png",
  "IE:PD":
    "https://commons.wikimedia.org/wiki/Special:FilePath/Logo_of_the_Progressive_Democrats_%28Ireland%29%2C_circa_2000s.png",
  // BR parties (2019-default + 1991-default)
  "BR:PT": "https://commons.wikimedia.org/wiki/Special:FilePath/PT_%28Brazil%29_logo_2021.svg",
  "BR:PL":
    "https://commons.wikimedia.org/wiki/Special:FilePath/Partido_Liberal_%28Brazil%29_logo.svg",
  "BR:MDB":
    "https://commons.wikimedia.org/wiki/Special:FilePath/Brazilian_Democratic_Movement_logo.svg",
  "BR:UNIÃO": "https://commons.wikimedia.org/wiki/Special:FilePath/Uni%C3%A3o_Brasil_logo.svg",
  "BR:PSD": "https://commons.wikimedia.org/wiki/Special:FilePath/PSD_Brazil_logo.svg",
  // 1991-only: post-redemocratization roster from the 1990 election. PSB
  // logo lives on English Wikipedia (fair-use); the rest are on Commons.
  // PMDB uses its 2000-2017 mark, the last era-stable PMDB asset before
  // the 2017 rebrand to MDB.
  "BR:PMDB": "https://commons.wikimedia.org/wiki/Special:FilePath/PMDB_2000_a_2017.svg",
  "BR:PFL":
    "https://commons.wikimedia.org/wiki/Special:FilePath/Partido_da_Frente_Liberal_logo_%281985-2005%29.svg",
  "BR:PDT": "https://commons.wikimedia.org/wiki/Special:FilePath/PDT_logo_2026_%28cropped%29.png",
  "BR:PDS":
    "https://commons.wikimedia.org/wiki/Special:FilePath/Partido_Democr%C3%A1tico_Social_logo.svg",
  "BR:PTB":
    "https://commons.wikimedia.org/wiki/Special:FilePath/Logomarca_Partido_Trabalhista_Brasileiro.png",
  "BR:PRN":
    "https://commons.wikimedia.org/wiki/Special:FilePath/Logo_do_Partido_da_Renova%C3%A7%C3%A3o_Nacional_%281989-2000%29.png",
  "BR:PSB":
    "https://en.wikipedia.org/wiki/Special:FilePath/Logo_of_the_Brazilian_Socialist_Party.svg",
  "BR:PCDOB": "https://commons.wikimedia.org/wiki/Special:FilePath/PCdoB_logo.svg",
  // CN — only CCP has a clean SVG on Commons. The minor united-front
  // parties (CDL, CNDCA) don't have distinct logo SVGs available;
  // they fall through to the colored-circle placeholder.
  "CN:CCP":
    "https://commons.wikimedia.org/wiki/Special:FilePath/Flag_of_the_Communist_Party_of_China.svg",
  // RU (the USSR in 1979) — the CPSU has no distinct party-flag SVG on Commons
  // separate from the state flag, so use the Soviet state emblem (its de facto
  // party/regime mark in a one-party state). Distinct from the country flag.
  "RU:CPSU":
    "https://commons.wikimedia.org/wiki/Special:FilePath/Coat_of_arms_of_the_Soviet_Union_%281956%E2%80%931991%29.svg",
  // DD — East Germany's National Front bloc (1953/1979 presets). All five
  // marks are the GDR-era parties, not their West German namesakes: DD:CDU
  // is the eastern bloc CDU, and DD:NDPD is the GDR National Democrats
  // (1948-1990), unrelated to the post-war West German NPD.
  "DD:SED":
    "https://commons.wikimedia.org/wiki/Special:FilePath/Sozialistische_Einheitspartei_Deutschlands_Logo.svg",
  "DD:CDU": "https://commons.wikimedia.org/wiki/Special:FilePath/Logo_der_CDU_%28DDR%29.svg",
  "DD:LDPD": "https://commons.wikimedia.org/wiki/Special:FilePath/LDPD_Emblem.svg",
  "DD:NDPD": "https://commons.wikimedia.org/wiki/Special:FilePath/DEU_NDPD_Logo.svg",
  "DD:DBD":
    "https://commons.wikimedia.org/wiki/Special:FilePath/Demokratische_BauernPartei_Deutschlands_Logo.svg",
};

// Re-export canonical state constants (single source of truth)
export {
  HOUSE_SEATS,
  UK_COMMONS_SEATS,
  UK_COMMONS_SEATS_1953,
  UK_REGIONAL_COUNCIL_SEATS,
  TOTAL_UK_COMMONS_SEATS,
  TOTAL_UK_COMMONS_SEATS_1953,
  JP_SHUGIIN_SEATS,
  TOTAL_JP_SHUGIIN_SEATS,
  JP_SANGIIN_SEATS,
  TOTAL_JP_SANGIIN_SEATS,
  DE_WAHLKREIS_SEATS,
  TOTAL_DE_WAHLKREIS_SEATS,
  TOTAL_DE_BUNDESTAG_SEATS,
  DE_LANDTAG_SEATS,
  CN_NPC_SEATS,
  TOTAL_CN_NPC_SEATS,
  CN_NPC_SEATS_1953,
  TOTAL_CN_NPC_SEATS_1953,
  CN_PEOPLES_CONGRESS_SEATS,
  TOTAL_CN_PEOPLES_CONGRESS_SEATS,
  CN_PEOPLES_CONGRESS_SEATS_1953,
  TOTAL_CN_PEOPLES_CONGRESS_SEATS_1953,
  getCnNpcSeats,
  getCnPeoplesCongressSeats,
  SENATE_CLASSES_BY_STATE as SENATE_CLASSES,
  STATE_SENATE_SEATS,
  TOTAL_HOUSE_SEATS,
  TOTAL_SENATE_SEATS,
  ELECTORAL_VOTES,
  ELECTORAL_VOTE_UNITS,
  TOTAL_ELECTORAL_VOTES,
  ELECTORAL_MAJORITY,
  UNIT_LEAN,
  HOUSE_SEATS_1991,
  ELECTORAL_VOTES_1991,
  ELECTORAL_VOTE_UNITS_1991,
  getHouseSeats,
  getUkCommonsSeats,
  getTotalUkCommonsSeats,
  getElectoralVotes,
  getElectoralVoteUnits,
} from "./constants/states";

export { CABINET_POSITIONS, getCabinetPositionById } from "./constants/cabinet";
export type { CabinetPositionId } from "./constants/cabinet";

export {
  MS_PER_TURN,
  TURNS_PER_YEAR,
  SENATE_STAGGER_TURNS,
  STARTING_YEAR,
} from "./constants/turnTime";
