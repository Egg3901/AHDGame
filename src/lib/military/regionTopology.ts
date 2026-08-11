import type { RegionCode } from "./types";

/**
 * Home strategic region for every sovereign state, keyed by ISO 3166-1 alpha-2,
 * plus the game's non-ISO CountryId codes (UK, SCO, WAL, DD, CS, YU, UKR, BLR,
 * BAL) so any
 * playable country resolves directly. Exhaustive over the current CountryId union
 * (guarded by a test) — adding a country forces adding its region here.
 * `sat` (South Atlantic) and `arc` (Arctic) have no sovereign home nation.
 */
export const COUNTRY_HOME_REGION: Record<string, RegionCode> = {
  // North America (noa)
  US: "noa",
  CA: "noa",
  MX: "noa",
  // South America (sam)
  BR: "sam",
  AR: "sam",
  CL: "sam",
  CO: "sam",
  VE: "sam",
  PE: "sam",
  EC: "sam",
  BO: "sam",
  PY: "sam",
  UY: "sam",
  GY: "sam",
  SR: "sam",
  // Central America & Caribbean (cac)
  GT: "cac",
  BZ: "cac",
  SV: "cac",
  HN: "cac",
  NI: "cac",
  CR: "cac",
  PA: "cac",
  CU: "cac",
  JM: "cac",
  HT: "cac",
  DO: "cac",
  BS: "cac",
  TT: "cac",
  BB: "cac",
  AG: "cac",
  DM: "cac",
  GD: "cac",
  KN: "cac",
  LC: "cac",
  VC: "cac",
  // Western Europe (weu) — ISO + game UK/SCO/WAL
  GB: "weu",
  UK: "weu",
  SCO: "weu",
  WAL: "weu",
  IE: "weu",
  FR: "weu",
  DE: "weu",
  NL: "weu",
  BE: "weu",
  LU: "weu",
  CH: "weu",
  AT: "weu",
  PT: "weu",
  ES: "weu",
  SE: "weu",
  NO: "weu",
  DK: "weu",
  FI: "weu",
  AD: "weu",
  MC: "weu",
  LI: "weu",
  SM: "weu",
  VA: "weu",
  // Eastern Europe (eeu) — ISO + game DD/CS/YU/UKR/BLR/BAL
  RU: "eeu",
  UA: "eeu",
  PL: "eeu",
  BY: "eeu",
  CZ: "eeu",
  SK: "eeu",
  HU: "eeu",
  RO: "eeu",
  BG: "eeu",
  MD: "eeu",
  EE: "eeu",
  LV: "eeu",
  LT: "eeu",
  RS: "eeu",
  HR: "eeu",
  SI: "eeu",
  BA: "eeu",
  ME: "eeu",
  MK: "eeu",
  XK: "eeu",
  AL: "eeu",
  DD: "eeu",
  CS: "eeu",
  YU: "eeu",
  // The union republics use the game's CountryId codes, not the ISO codes UA/BY
  // above: those stay because the map data still carries them.
  UKR: "eeu",
  BLR: "eeu",
  BAL: "eeu",
  // Mediterranean (med)
  IT: "med",
  GR: "med",
  MT: "med",
  CY: "med",
  // North Africa (naf)
  MA: "naf",
  DZ: "naf",
  TN: "naf",
  LY: "naf",
  EG: "naf",
  EH: "naf",
  // Sub-Saharan Africa (ssa)
  NG: "ssa",
  GH: "ssa",
  CI: "ssa",
  SN: "ssa",
  ML: "ssa",
  BF: "ssa",
  NE: "ssa",
  GN: "ssa",
  GW: "ssa",
  GM: "ssa",
  SL: "ssa",
  LR: "ssa",
  CV: "ssa",
  BJ: "ssa",
  TG: "ssa",
  MR: "ssa",
  CM: "ssa",
  TD: "ssa",
  CF: "ssa",
  GA: "ssa",
  CG: "ssa",
  CD: "ssa",
  GQ: "ssa",
  ST: "ssa",
  AO: "ssa",
  ZM: "ssa",
  ZW: "ssa",
  MW: "ssa",
  MZ: "ssa",
  BW: "ssa",
  NA: "ssa",
  ZA: "ssa",
  LS: "ssa",
  SZ: "ssa",
  KE: "ssa",
  TZ: "ssa",
  UG: "ssa",
  RW: "ssa",
  BI: "ssa",
  ET: "ssa",
  ER: "ssa",
  DJ: "ssa",
  SO: "ssa",
  SS: "ssa",
  SD: "ssa",
  MG: "ssa",
  // Middle East (mea)
  TR: "mea",
  SA: "mea",
  IR: "mea",
  IQ: "mea",
  IL: "mea",
  PS: "mea",
  JO: "mea",
  LB: "mea",
  SY: "mea",
  KW: "mea",
  QA: "mea",
  AE: "mea",
  BH: "mea",
  OM: "mea",
  YE: "mea",
  // Central Asia (cas)
  KZ: "cas",
  UZ: "cas",
  TM: "cas",
  KG: "cas",
  TJ: "cas",
  AF: "cas",
  // South Asia (sas)
  IN: "sas",
  PK: "sas",
  BD: "sas",
  LK: "sas",
  NP: "sas",
  BT: "sas",
  MV: "sas",
  // East Asia (eas)
  CN: "eas",
  JP: "eas",
  KP: "eas",
  KR: "eas",
  TW: "eas",
  MN: "eas",
  // Southeast Asia (sea)
  VN: "sea",
  TH: "sea",
  KH: "sea",
  LA: "sea",
  MM: "sea",
  MY: "sea",
  SG: "sea",
  ID: "sea",
  PH: "sea",
  BN: "sea",
  TL: "sea",
  // Indian Ocean (ior)
  MU: "ior",
  SC: "ior",
  KM: "ior",
  // Western Pacific (wpa)
  FM: "wpa",
  PW: "wpa",
  MH: "wpa",
  NR: "wpa",
  // South Pacific (spa)
  AU: "spa",
  NZ: "spa",
  PG: "spa",
  FJ: "spa",
  SB: "spa",
  VU: "spa",
  WS: "spa",
  TO: "spa",
  TV: "spa",
  KI: "spa",
  // North Atlantic (nat)
  IS: "nat",
};

/** The home region of a country code (ISO α-2 or a game CountryId), or undefined. */
export function homeRegionOf(country: string): RegionCode | undefined {
  return COUNTRY_HOME_REGION[country];
}

const inverse: Partial<Record<RegionCode, string[]>> = {};
/** Country codes whose home region is `region` (memoized inverse of the map). */
export function countriesInRegion(region: RegionCode): string[] {
  if (Object.keys(inverse).length === 0) {
    for (const [country, r] of Object.entries(COUNTRY_HOME_REGION)) {
      (inverse[r] ??= []).push(country);
    }
  }
  return inverse[region] ?? [];
}

/** Symmetric neighbour graph over the 19 strategic regions (a test verifies symmetry). */
export const REGION_ADJACENCY: Record<RegionCode, RegionCode[]> = {
  arc: ["noa", "nat", "eeu"],
  noa: ["arc", "nat", "cac"],
  nat: ["arc", "noa", "weu"],
  cac: ["noa", "sam"],
  sam: ["cac", "sat"],
  sat: ["sam", "ssa"],
  weu: ["nat", "eeu", "med"],
  eeu: ["arc", "weu", "cas", "mea"],
  med: ["weu", "naf", "mea"],
  naf: ["med", "mea", "ssa"],
  ssa: ["sat", "naf", "mea", "ior"],
  mea: ["eeu", "med", "naf", "ssa", "cas", "sas"],
  cas: ["eeu", "mea", "sas", "eas"],
  sas: ["mea", "cas", "eas", "sea", "ior"],
  eas: ["cas", "sas", "sea", "wpa"],
  sea: ["sas", "eas", "wpa", "spa", "ior"],
  ior: ["ssa", "sas", "sea"],
  wpa: ["eas", "sea", "spa"],
  spa: ["sea", "wpa"],
};

/** Regions bordering `region`. */
export function regionNeighbors(region: RegionCode): RegionCode[] {
  return REGION_ADJACENCY[region] ?? [];
}

/** Whether two regions border each other. */
export function areAdjacent(a: RegionCode, b: RegionCode): boolean {
  return (REGION_ADJACENCY[a] ?? []).includes(b);
}
