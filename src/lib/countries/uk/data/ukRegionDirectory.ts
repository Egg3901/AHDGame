/**
 * United Kingdom political structure constants.
 *
 * Defines the UK's four nations, major regions, and key political entities
 * to support the multi-country expansion.
 */

export interface UKNation {
  id: string;
  name: string;
  capital: string;
  population: number;
  /** Devolved parliament/assembly? */
  devolvedBody?: string;
  /** Number of Westminster constituencies */
  constituencies: number;
}

export const UK_NATIONS: UKNation[] = [
  {
    id: "ENG",
    name: "England",
    capital: "London",
    population: 56_550_000,
    constituencies: 543,
  },
  {
    id: "SCO",
    name: "Scotland",
    capital: "Edinburgh",
    population: 5_440_000,
    devolvedBody: "Scottish Parliament",
    constituencies: 57,
  },
  {
    id: "WAL",
    name: "Wales",
    capital: "Cardiff",
    population: 3_170_000,
    devolvedBody: "Senedd Cymru",
    constituencies: 32,
  },
  {
    id: "NIR",
    name: "Northern Ireland",
    capital: "Belfast",
    population: 1_920_000,
    devolvedBody: "Northern Ireland Assembly",
    constituencies: 18,
  },
];

/** Total Westminster House of Commons seats */
export const UK_TOTAL_CONSTITUENCIES = 650;

/**
 * Major English regions (used for regional politics and metrics).
 * These correspond broadly to NUTS1 statistical regions.
 */
export interface UKRegion {
  id: string;
  name: string;
  /** Adjective form used for party names, e.g. "Scottish Labour Party" */
  adjective: string;
  nationId: string;
  constituencies: number;
  /** Devolved legislature name override (e.g. "Scottish Parliament"). Defaults to "Regional Council". */
  councilName?: string;
}

export const UK_REGIONS: UKRegion[] = [
  { id: "LON", name: "London", adjective: "London", nationId: "ENG", constituencies: 75 },
  {
    id: "SEE",
    name: "South East England",
    adjective: "South East",
    nationId: "ENG",
    constituencies: 91,
  },
  {
    id: "SWE",
    name: "South West England",
    adjective: "South West",
    nationId: "ENG",
    constituencies: 58,
  },
  {
    id: "EAE",
    name: "East of England",
    adjective: "East of England",
    nationId: "ENG",
    constituencies: 61,
  },
  {
    id: "EMI",
    name: "East Midlands",
    adjective: "East Midlands",
    nationId: "ENG",
    constituencies: 47,
  },
  {
    id: "WMI",
    name: "West Midlands",
    adjective: "West Midlands",
    nationId: "ENG",
    constituencies: 57,
  },
  {
    id: "YHU",
    name: "Yorkshire & the Humber",
    adjective: "Yorkshire",
    nationId: "ENG",
    constituencies: 54,
  },
  {
    id: "NWE",
    name: "North West England",
    adjective: "North West",
    nationId: "ENG",
    constituencies: 75,
  },
  {
    id: "NEE",
    name: "North East England",
    adjective: "North East",
    nationId: "ENG",
    constituencies: 27,
  },
  {
    id: "SCO",
    name: "Scotland",
    adjective: "Scottish",
    nationId: "SCO",
    constituencies: 57,
    councilName: "Scottish Parliament",
  },
  {
    id: "WAL",
    name: "Wales",
    adjective: "Welsh",
    nationId: "WAL",
    constituencies: 32,
    councilName: "Senedd Cymru",
  },
  {
    id: "NIR",
    name: "Northern Ireland",
    adjective: "Northern Irish",
    nationId: "NIR",
    constituencies: 18,
    councilName: "Northern Ireland Assembly",
  },
];

/** Look up the regional council/legislature name for a UK region. Falls back to "Regional Council". */
export function getUKCouncilName(regionId: string): string {
  const region = UK_REGIONS.find((r) => r.id === regionId);
  return region?.councilName ?? "Regional Council";
}

/** Get the region-specific party name, e.g. "Scottish Labour Party" or "Welsh Conservative Party". */
export function getRegionalPartyName(stateId: string, partyName: string): string {
  const region = UK_REGIONS.find((r) => r.id === stateId);
  if (!region) return `${stateId} ${partyName}`;
  return `${region.adjective} ${partyName}`;
}

/**
 * UK major political parties (Westminster).
 */
export interface UKParty {
  id: string;
  name: string;
  shortName: string;
  color: string;
  ideology: string;
  founded: number;
}

export const UK_PARTIES: UKParty[] = [
  {
    id: "LAB",
    name: "Labour Party",
    shortName: "Labour",
    color: "#E4003B",
    ideology: "Centre-left, social democracy",
    founded: 1900,
  },
  {
    id: "CON",
    name: "Conservative Party",
    shortName: "Conservative",
    color: "#0087DC",
    ideology: "Centre-right, conservatism",
    founded: 1834,
  },
  {
    id: "LD",
    name: "Liberal Democrats",
    shortName: "Lib Dems",
    color: "#FAA61A",
    ideology: "Centre, liberal democracy",
    founded: 1988,
  },
  {
    id: "SNP",
    name: "Scottish National Party",
    shortName: "SNP",
    color: "#FFF95D",
    ideology: "Centre-left, Scottish independence",
    founded: 1934,
  },
  {
    id: "PC",
    name: "Plaid Cymru",
    shortName: "Plaid",
    color: "#3F8428",
    ideology: "Centre-left, Welsh independence",
    founded: 1925,
  },
  {
    id: "GREEN",
    name: "Green Party",
    shortName: "Green",
    color: "#02A95B",
    ideology: "Left-wing, environmentalism",
    founded: 1990,
  },
  {
    id: "REF",
    name: "Reform UK",
    shortName: "Reform",
    color: "#12B6CF",
    ideology: "Right-wing, national conservatism",
    founded: 2018,
  },
];

/**
 * Electoral system used in Westminster general elections.
 * FPTP — First Past the Post for all UK constituencies.
 */
export const UK_ELECTORAL_SYSTEM = "fptp" as const;

/** Executive structure */
export const UK_EXECUTIVE = {
  headOfGovernment: "Prime Minister",
  headOfState: "Monarch",
  cabinet: "Cabinet",
  government: "The Sovereign's Government",
} as const;

/** Nation flag emojis for region hero display */
export const UK_NATION_FLAGS: Record<string, string> = {
  ENG: "🏴󠁧󠁢󠁥󠁮󠁧󠁿",
  SCO: "🏴󠁧󠁢󠁳󠁣󠁴󠁿",
  WAL: "🏴󠁧󠁢󠁷󠁬󠁳󠁿",
  NIR: "🇬🇧",
};

/** Representative images for UK regions (Wikimedia Commons) */
export const UK_REGION_IMAGES: Record<string, string> = {
  LON: "https://upload.wikimedia.org/wikipedia/commons/thumb/3/37/London_Tower_Bridge_22.jpg/1280px-London_Tower_Bridge_22.jpg",
  SEE: "https://upload.wikimedia.org/wikipedia/commons/thumb/7/74/White_Cliffs_of_Dover_02.JPG/1280px-White_Cliffs_of_Dover_02.JPG",
  SWE: "https://upload.wikimedia.org/wikipedia/commons/thumb/a/aa/Stonehenge_from_the_north.jpg/1280px-Stonehenge_from_the_north.jpg",
  EAE: "https://upload.wikimedia.org/wikipedia/commons/thumb/e/ea/Selwyn_College_Old_Court%2C_Cambridge%2C_UK_-_Diliff.jpg/1280px-Selwyn_College_Old_Court%2C_Cambridge%2C_UK_-_Diliff.jpg",
  EMI: "https://upload.wikimedia.org/wikipedia/commons/thumb/8/8c/Near_Hathersage%2C_Peak_District_8_%28cropped%2C_edited%29.jpg/1280px-Near_Hathersage%2C_Peak_District_8_%28cropped%2C_edited%29.jpg",
  WMI: "https://upload.wikimedia.org/wikipedia/commons/thumb/8/8a/Birmingham-Skyline-from-Edgbaston-crop.jpg/1280px-Birmingham-Skyline-from-Edgbaston-crop.jpg",
  YHU: "https://upload.wikimedia.org/wikipedia/commons/thumb/a/a5/York_-_York_Minster_-_20230327180611.jpg/1280px-York_-_York_Minster_-_20230327180611.jpg",
  NWE: "https://upload.wikimedia.org/wikipedia/commons/thumb/1/1b/View_of_Liverpool_%282%29_-_geograph.org.uk_-_6738599.jpg/1280px-View_of_Liverpool_%282%29_-_geograph.org.uk_-_6738599.jpg",
  NEE: "https://upload.wikimedia.org/wikipedia/commons/thumb/3/3c/131369_Cathedral_Church_of_Christ%2C_Blessed_Mary_the_Virgin_and_St_Cuthbert_of_Durham%2C_seen_from_the_River_Wear_Durham_20240523_0365.jpg/1280px-131369_Cathedral_Church_of_Christ%2C_Blessed_Mary_the_Virgin_and_St_Cuthbert_of_Durham%2C_seen_from_the_River_Wear_Durham_20240523_0365.jpg",
  SCO: "https://upload.wikimedia.org/wikipedia/commons/thumb/e/ef/Edinburgh_Castle_Rock.jpg/1280px-Edinburgh_Castle_Rock.jpg",
  WAL: "https://upload.wikimedia.org/wikipedia/commons/thumb/d/d2/Moel_Siabod_from_y_Grib_Goch%2C_Parc_Cenedlaethol_Eryri_%28Snowdonia_National_Park%29%2C_Gywnedd%2C_Cymru_%28Wales%29_02.jpg/1280px-Moel_Siabod_from_y_Grib_Goch%2C_Parc_Cenedlaethol_Eryri_%28Snowdonia_National_Park%29%2C_Gywnedd%2C_Cymru_%28Wales%29_02.jpg",
  NIR: "https://upload.wikimedia.org/wikipedia/commons/thumb/2/21/20120830_Giant%27s_Causeway.jpg/1280px-20120830_Giant%27s_Causeway.jpg",
};

const UK_DEFAULT_IMAGE =
  "https://upload.wikimedia.org/wikipedia/commons/thumb/3/37/London_Tower_Bridge_22.jpg/1280px-London_Tower_Bridge_22.jpg";

export function getUKRegionImage(regionId: string): string {
  return UK_REGION_IMAGES[regionId] ?? UK_DEFAULT_IMAGE;
}
