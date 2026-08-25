/**
 * Per-country state/region geographic adjacency.
 *
 * Used by the founding-cohort picker in charter creation (`F4` redesign)
 * to constrain which states the player can place founding NPPs in beyond
 * the chair's home state itself.
 *
 * Invariants:
 *   - Symmetric: if `A ∈ STATE_ADJACENCY[country][B]` then
 *     `B ∈ STATE_ADJACENCY[country][A]`. Enforced by tests.
 *   - State IDs match the documents in `<countryRegions>.ts` seeds.
 *   - Sea-border edges are included case-by-case where there's a
 *     historic / ferry / cultural-territorial relationship (see per-
 *     country comments below).
 *
 * Lookups via `adjacentStates(country, id)` rather than direct map access
 * — returns `[]` for unknown country/state instead of `undefined`.
 *
 * See `docs/plans/archive/2026-05/2026-05-22-f4-founding-cohort-redesign.md`.
 */

import type { CountryId } from "./countries";

type AdjacencyMap = Record<string, readonly string[]>;

/**
 * US 50 states + DC. Standard contiguous-state adjacency from the
 * Census Bureau's adjacency file plus two sea-border edges by F4-redesign
 * convention:
 *   - AK ↔ WA: ferry / cultural-territorial relationship.
 *   - MI ↔ WI: Lake Michigan crossing (Lake Express ferry).
 * HI is standalone (no adjacencies).
 */
const US_ADJACENCY: AdjacencyMap = {
  AL: ["FL", "GA", "MS", "TN"],
  AK: ["WA"], // sea-border by convention
  AZ: ["CA", "CO", "NM", "NV", "UT"],
  AR: ["LA", "MS", "MO", "OK", "TN", "TX"],
  CA: ["AZ", "NV", "OR"],
  CO: ["AZ", "KS", "NE", "NM", "OK", "UT", "WY"],
  CT: ["MA", "NY", "RI"],
  DE: ["MD", "NJ", "PA"],
  DC: ["MD", "VA"],
  FL: ["AL", "GA"],
  GA: ["AL", "FL", "NC", "SC", "TN"],
  HI: [], // standalone
  ID: ["MT", "NV", "OR", "UT", "WA", "WY"],
  IL: ["IN", "IA", "KY", "MO", "WI"],
  IN: ["IL", "KY", "MI", "OH"],
  IA: ["IL", "MN", "MO", "NE", "SD", "WI"],
  KS: ["CO", "MO", "NE", "OK"],
  KY: ["IL", "IN", "MO", "OH", "TN", "VA", "WV"],
  LA: ["AR", "MS", "TX"],
  ME: ["NH"],
  MD: ["DE", "DC", "PA", "VA", "WV"],
  MA: ["CT", "NH", "NY", "RI", "VT"],
  MI: ["IN", "OH", "WI"], // WI via Lake Michigan (Lake Express ferry)
  MN: ["IA", "ND", "SD", "WI"],
  MS: ["AL", "AR", "LA", "TN"],
  MO: ["AR", "IL", "IA", "KS", "KY", "NE", "OK", "TN"],
  MT: ["ID", "ND", "SD", "WY"],
  NE: ["CO", "IA", "KS", "MO", "SD", "WY"],
  NV: ["AZ", "CA", "ID", "OR", "UT"],
  NH: ["ME", "MA", "VT"],
  NJ: ["DE", "NY", "PA"],
  NM: ["AZ", "CO", "OK", "TX", "UT"],
  NY: ["CT", "MA", "NJ", "PA", "VT"],
  NC: ["GA", "SC", "TN", "VA"],
  ND: ["MN", "MT", "SD"],
  OH: ["IN", "KY", "MI", "PA", "WV"],
  OK: ["AR", "CO", "KS", "MO", "NM", "TX"],
  OR: ["CA", "ID", "NV", "WA"],
  PA: ["DE", "MD", "NJ", "NY", "OH", "WV"],
  RI: ["CT", "MA"],
  SC: ["GA", "NC"],
  SD: ["IA", "MN", "MT", "NE", "ND", "WY"],
  TN: ["AL", "AR", "GA", "KY", "MS", "MO", "NC", "VA"],
  TX: ["AR", "LA", "NM", "OK"],
  UT: ["AZ", "CO", "ID", "NV", "NM", "WY"],
  VT: ["MA", "NH", "NY"],
  VA: ["DC", "KY", "MD", "NC", "TN", "WV"],
  WA: ["AK", "ID", "OR"], // AK by sea-border convention
  WV: ["KY", "MD", "OH", "PA", "VA"],
  WI: ["IA", "IL", "MI", "MN"], // MI via Lake Michigan
  WY: ["CO", "ID", "MT", "NE", "SD", "UT"],
};

/**
 * UK 12 regions (9 ENG sub-regions + SCO + WAL + NIR). The codebase
 * models UK at this regional grain, not at the 650-constituency level —
 * so adjacency stays manageable.
 *
 * Sea-border edges:
 *   - NIR ↔ SCO (Stranraer/Cairnryan ↔ Belfast ferry).
 *   - NIR ↔ NWE (Liverpool ↔ Belfast ferry).
 * WAL ↔ NIR not included (no direct ferry; Holyhead routes go to ROI).
 */
const UK_ADJACENCY: AdjacencyMap = {
  // England sub-regions (geographic land borders)
  LON: ["SEE", "EAE"],
  SEE: ["LON", "SWE", "EAE"],
  SWE: ["SEE", "WMI", "WAL"],
  EAE: ["LON", "SEE", "EMI", "YHU"],
  EMI: ["EAE", "WMI", "YHU"],
  WMI: ["SWE", "EMI", "NWE", "WAL"],
  YHU: ["EAE", "EMI", "NWE", "NEE"],
  NWE: ["WMI", "YHU", "NEE", "WAL", "NIR"], // NIR via Liverpool-Belfast ferry
  NEE: ["YHU", "NWE", "SCO"],
  // Devolved nations
  SCO: ["NEE", "NIR"], // NIR via Stranraer-Belfast ferry
  WAL: ["SWE", "WMI", "NWE"],
  NIR: ["SCO", "NWE"], // sea borders only
};

/**
 * DE 16 Bundesländer. Standard geographic land adjacency. Berlin (BE)
 * is enclaved entirely within Brandenburg (BB) — its only neighbor.
 */
const DE_ADJACENCY: AdjacencyMap = {
  SH: ["HH", "MV", "NI"],
  HH: ["SH", "NI"],
  BRE: ["NI"],
  NI: ["SH", "HH", "BRE", "MV", "BB", "ST", "TH", "HE", "NW"],
  MV: ["SH", "NI", "BB"],
  BB: ["MV", "NI", "ST", "SN", "BE"],
  BE: ["BB"], // enclaved within Brandenburg
  ST: ["NI", "BB", "SN", "TH"],
  SN: ["BB", "ST", "TH", "BY"],
  TH: ["NI", "ST", "SN", "BY", "HE"],
  BY: ["BW", "HE", "TH", "SN"],
  BW: ["BY", "HE", "RP"],
  HE: ["NI", "NW", "RP", "BW", "BY", "TH"],
  RP: ["NW", "HE", "BW", "SL"],
  SL: ["RP"],
  NW: ["NI", "HE", "RP"],
};

/**
 * JP 8 regions. Mainland adjacencies via land + the inland Seto sea
 * bridges/ferries (KNS↔SHI, CGK↔SHI, CGK↔KYU). HOK↔TOH via the
 * Tsugaru Strait (Seikan Tunnel ferries / rail).
 */
const JP_ADJACENCY: AdjacencyMap = {
  HOK: ["TOH"], // sea via Tsugaru Strait
  TOH: ["HOK", "KAN"],
  KAN: ["TOH", "CHU"],
  CHU: ["KAN", "KNS"],
  KNS: ["CHU", "CGK", "SHI"], // SHI via Awaji bridges
  CGK: ["KNS", "SHI", "KYU"], // SHI via Seto-Ohashi; KYU via Kanmon Strait
  SHI: ["KNS", "CGK"],
  KYU: ["CGK"],
};

/**
 * CN 7 grouped regions. These are coarse macro-regions; each pair of
 * adjacent macro-regions has at least one provincial border touching.
 */
const CN_ADJACENCY: AdjacencyMap = {
  DB: ["HB"],
  HB: ["DB", "XB", "HZ", "HD"],
  HD: ["HB", "HZ", "HN"],
  HZ: ["HB", "HD", "XB", "XN", "HN"],
  HN: ["HZ", "HD", "XN"],
  XN: ["HZ", "HN", "XB"],
  XB: ["HB", "HZ", "XN"],
};

/**
 * RU (USSR) 17 macro-regions — ten RSFSR economic macro-regions plus seven
 * grouped union republics (see `ruRegions.ts`). Ukraine, Byelorussia and the
 * Baltics used to be RU regions and are separate countries now, so their edges
 * are gone from this map. Land adjacency at the
 * macro-region grain; a pair is adjacent when any constituent oblast/
 * republic borders touch. One sea-border edge by F4-redesign convention:
 *   - TRA ↔ CAS: Baku–Krasnovodsk Caspian rail ferry (the historic
 *     freight/passenger link between Transcaucasia and Central Asia).
 * NCA ↔ KAZ (Caspian only, no service) is deliberately excluded.
 */
const RU_ADJACENCY: AdjacencyMap = {
  // RSFSR macro-regions
  CEN: ["NWR", "NOR", "VOL", "CBE"],
  NWR: ["CEN", "NOR"],
  NOR: ["NWR", "CEN", "VOL", "URA", "WSB"],
  CBE: ["CEN", "VOL", "NCA"],
  VOL: ["NOR", "CEN", "CBE", "NCA", "URA", "KAZ"],
  NCA: ["CBE", "VOL", "TRA"],
  URA: ["NOR", "VOL", "WSB", "KAZ"],
  WSB: ["NOR", "URA", "ESB", "KAZ"],
  ESB: ["WSB", "FEA"],
  FEA: ["ESB"],
  // Union republics (grouped)
  KAZ: ["VOL", "URA", "WSB", "CAS"],
  TRA: ["NCA", "CAS"], // CAS via Baku–Krasnovodsk Caspian ferry
  CAS: ["KAZ", "TRA"],
  // MOL is an EXCLAVE of RU's region graph. The Moldavian SSR bordered only the
  // Ukrainian SSR and Romania; Ukraine is its own country now, so Moldova has no
  // RU-owned neighbour left. The empty list is correct, not missing data: this
  // map is land adjacency WITHIN a country's own regions.
  MOL: [],
};

/**
 * DD (East Germany) 6 regions. Reuses the modern eastern-Länder codes
 * shared with the `DE` map (see `ddRegions.ts`), so land adjacency is the
 * DE map restricted to those codes — the West German neighbors those
 * Länder have under `DE` (SH, NI, BY, HE) fall outside DD. East Berlin
 * (BEO) is enclaved within Brandenburg, mirroring DE's BE ↔ BB.
 */
const DD_ADJACENCY: AdjacencyMap = {
  BEO: ["BB"], // enclaved within Brandenburg
  MV: ["BB"],
  BB: ["BEO", "MV", "ST", "SN"],
  ST: ["BB", "SN", "TH"],
  SN: ["BB", "ST", "TH"],
  TH: ["ST", "SN"],
};

/**
 * Ireland's eight composite planning regions. Borders follow the constituent
 * counties documented in `ieRegions.ts`.
 */
const IE_ADJACENCY: AdjacencyMap = {
  DUB: ["KIL"],
  KIL: ["DUB", "MID", "WEX", "DON"],
  MID: ["KIL", "WEX", "LIM", "GAL", "DON"],
  WEX: ["KIL", "MID", "LIM", "COR"],
  LIM: ["MID", "WEX", "COR", "GAL"],
  COR: ["WEX", "LIM"],
  GAL: ["MID", "LIM", "DON"],
  DON: ["KIL", "MID", "GAL"],
};

/** Brazil's five IBGE macro-regions. */
const BR_ADJACENCY: AdjacencyMap = {
  NORTE: ["NORDESTE", "CENTRO_OESTE"],
  NORDESTE: ["NORTE", "CENTRO_OESTE", "SUDESTE"],
  CENTRO_OESTE: ["NORTE", "NORDESTE", "SUDESTE", "SUL"],
  SUDESTE: ["NORDESTE", "CENTRO_OESTE", "SUL"],
  SUL: ["CENTRO_OESTE", "SUDESTE"],
};

/** Nigeria's six geopolitical zones. */
const NG_ADJACENCY: AdjacencyMap = {
  NORTH_WEST: ["NORTH_EAST", "NORTH_CENTRAL"],
  NORTH_EAST: ["NORTH_WEST", "NORTH_CENTRAL"],
  NORTH_CENTRAL: ["NORTH_WEST", "NORTH_EAST", "SOUTH_WEST", "SOUTH_SOUTH", "SOUTH_EAST"],
  SOUTH_WEST: ["NORTH_CENTRAL", "SOUTH_SOUTH"],
  SOUTH_SOUTH: ["NORTH_CENTRAL", "SOUTH_WEST", "SOUTH_EAST"],
  SOUTH_EAST: ["NORTH_CENTRAL", "SOUTH_SOUTH"],
};

/** Hungary's six 1979 macro-regions. Budapest is enclaved within Pest. */
const HU_ADJACENCY: AdjacencyMap = {
  HU_BUD: ["HU_PES"],
  HU_PES: ["HU_BUD", "HU_TRW", "HU_NOR", "HU_ALF"],
  HU_TRW: ["HU_PES", "HU_TRS", "HU_ALF"],
  HU_TRS: ["HU_TRW", "HU_ALF"],
  HU_NOR: ["HU_PES", "HU_ALF"],
  HU_ALF: ["HU_PES", "HU_TRW", "HU_TRS", "HU_NOR"],
};

/** Poland's eight 1979 macro-regions. */
const PL_ADJACENCY: AdjacencyMap = {
  PL_MAZ: ["PL_LOD", "PL_WLK", "PL_POM", "PL_EAS"],
  PL_LOD: ["PL_MAZ", "PL_MAL", "PL_SLK", "PL_WLK", "PL_EAS"],
  PL_MAL: ["PL_LOD", "PL_SLK", "PL_EAS"],
  PL_SLK: ["PL_LOD", "PL_MAL", "PL_DSL", "PL_WLK"],
  PL_DSL: ["PL_SLK", "PL_WLK", "PL_POM"],
  PL_WLK: ["PL_MAZ", "PL_LOD", "PL_SLK", "PL_DSL", "PL_POM"],
  PL_POM: ["PL_MAZ", "PL_DSL", "PL_WLK", "PL_EAS"],
  PL_EAS: ["PL_MAZ", "PL_LOD", "PL_MAL", "PL_POM"],
};

/** Romania's seven 1979 historic-province regions. */
const RO_ADJACENCY: AdjacencyMap = {
  RO_BUC: ["RO_MUN"],
  RO_MUN: ["RO_BUC", "RO_OLT", "RO_TRA", "RO_MOL", "RO_DOB"],
  RO_OLT: ["RO_MUN", "RO_TRA", "RO_VST"],
  RO_TRA: ["RO_MUN", "RO_OLT", "RO_VST", "RO_MOL"],
  RO_VST: ["RO_OLT", "RO_TRA", "RO_MOL"],
  RO_MOL: ["RO_MUN", "RO_TRA", "RO_VST", "RO_DOB"],
  RO_DOB: ["RO_MUN", "RO_MOL"],
};

/** Yugoslavia's six republics and two Serbian autonomous provinces. */
const YU_ADJACENCY: AdjacencyMap = {
  YU_SLO: ["YU_CRO"],
  YU_CRO: ["YU_SLO", "YU_BIH", "YU_VOJ", "YU_MNE"],
  YU_BIH: ["YU_CRO", "YU_SRB", "YU_MNE"],
  YU_SRB: ["YU_BIH", "YU_VOJ", "YU_KOS", "YU_MNE", "YU_MKD"],
  YU_VOJ: ["YU_CRO", "YU_SRB"],
  YU_KOS: ["YU_SRB", "YU_MNE", "YU_MKD"],
  YU_MNE: ["YU_CRO", "YU_BIH", "YU_SRB", "YU_KOS"],
  YU_MKD: ["YU_SRB", "YU_KOS"],
};

/** Bulgaria's five 1979 geographic regions. */
const BG_ADJACENCY: AdjacencyMap = {
  BG_SOF: ["BG_NOR", "BG_THR", "BG_SW"],
  BG_NOR: ["BG_SOF", "BG_COA", "BG_THR"],
  BG_COA: ["BG_NOR", "BG_THR"],
  BG_THR: ["BG_SOF", "BG_NOR", "BG_COA", "BG_SW"],
  BG_SW: ["BG_SOF", "BG_THR"],
};

/** Ukraine's six 1953 and 1979 macro-regions. */
const UKR_ADJACENCY: AdjacencyMap = {
  UKR_KYI: ["UKR_WES", "UKR_POD", "UKR_DNI"],
  UKR_WES: ["UKR_KYI", "UKR_POD"],
  UKR_POD: ["UKR_KYI", "UKR_WES", "UKR_DNI", "UKR_SOU"],
  UKR_DON: ["UKR_DNI"],
  UKR_DNI: ["UKR_KYI", "UKR_POD", "UKR_DON", "UKR_SOU"],
  UKR_SOU: ["UKR_POD", "UKR_DNI"],
};

/** Byelorussia's six oblasts. */
const BLR_ADJACENCY: AdjacencyMap = {
  BLR_MIN: ["BLR_HOM", "BLR_VIT", "BLR_MOG", "BLR_BRE", "BLR_GRO"],
  BLR_HOM: ["BLR_MIN", "BLR_MOG", "BLR_BRE"],
  BLR_VIT: ["BLR_MIN", "BLR_MOG", "BLR_GRO"],
  BLR_MOG: ["BLR_MIN", "BLR_HOM", "BLR_VIT"],
  BLR_BRE: ["BLR_MIN", "BLR_HOM", "BLR_GRO"],
  BLR_GRO: ["BLR_MIN", "BLR_VIT", "BLR_BRE"],
};

/** Czechoslovakia's three historic lands plus enclaved Prague. */
const CS_ADJACENCY: AdjacencyMap = {
  CS_PRG: ["CS_BOH"],
  CS_BOH: ["CS_PRG", "CS_MOR"],
  CS_MOR: ["CS_BOH", "CS_SVK"],
  CS_SVK: ["CS_MOR"],
};

/** Baltic republics, ordered north to south. */
const BAL_ADJACENCY: AdjacencyMap = {
  BAL_LTU: ["BAL_LVA"],
  BAL_LVA: ["BAL_LTU", "BAL_EST"],
  BAL_EST: ["BAL_LVA"],
};

/** France's eight 1979 macro-regions. */
const FR_ADJACENCY: AdjacencyMap = {
  FR_IDF: ["FR_NOR", "FR_EST", "FR_CEN", "FR_OUE"],
  FR_NOR: ["FR_IDF", "FR_EST", "FR_OUE"],
  FR_EST: ["FR_IDF", "FR_NOR", "FR_CEN", "FR_ARA"],
  FR_OUE: ["FR_IDF", "FR_NOR", "FR_CEN", "FR_SOU"],
  FR_SOU: ["FR_OUE", "FR_CEN", "FR_ARA", "FR_MED"],
  FR_ARA: ["FR_EST", "FR_CEN", "FR_SOU", "FR_MED"],
  FR_MED: ["FR_SOU", "FR_ARA"],
  FR_CEN: ["FR_IDF", "FR_EST", "FR_OUE", "FR_SOU", "FR_ARA"],
};

/**
 * Italy's eight 1979 macro-regions. Sicily connects to the south across the
 * Strait of Messina. Sardinia connects to Lazio by the Olbia-Civitavecchia
 * ferry route.
 */
const IT_ADJACENCY: AdjacencyMap = {
  IT_NW: ["IT_NE", "IT_TUS"],
  IT_NE: ["IT_NW", "IT_TUS"],
  IT_TUS: ["IT_NW", "IT_NE", "IT_LAZ", "IT_SUD"],
  IT_LAZ: ["IT_TUS", "IT_CAM", "IT_SUD", "IT_SAR"],
  IT_CAM: ["IT_LAZ", "IT_SUD"],
  IT_SUD: ["IT_TUS", "IT_LAZ", "IT_CAM", "IT_SIC"],
  IT_SIC: ["IT_SUD"], // Strait of Messina ferry
  IT_SAR: ["IT_LAZ"], // Olbia-Civitavecchia ferry
};

/** Spain's eight 1979 macro-regions. Island groups belong to ES_CEN. */
const ES_ADJACENCY: AdjacencyMap = {
  ES_MAD: ["ES_CEN"],
  ES_CAT: ["ES_VAL", "ES_NOR"],
  ES_AND: ["ES_VAL", "ES_CEN"],
  ES_VAL: ["ES_CAT", "ES_AND", "ES_CEN", "ES_NOR"],
  ES_PVB: ["ES_CEN", "ES_NOR"],
  ES_GAL: ["ES_CEN", "ES_NOR"],
  ES_NOR: ["ES_CAT", "ES_VAL", "ES_PVB", "ES_GAL", "ES_CEN"],
  ES_CEN: ["ES_MAD", "ES_AND", "ES_VAL", "ES_PVB", "ES_GAL", "ES_NOR"],
};

/** Sweden's eight 1979 macro-regions. */
const SE_ADJACENCY: AdjacencyMap = {
  SE_STH: ["SE_EAS", "SE_UPP"],
  SE_GOT: ["SE_SKA", "SE_SML", "SE_EAS", "SE_VML"],
  SE_SKA: ["SE_GOT", "SE_SML"],
  SE_EAS: ["SE_STH", "SE_GOT", "SE_SML", "SE_VML", "SE_UPP"],
  SE_SML: ["SE_GOT", "SE_SKA", "SE_EAS"],
  SE_VML: ["SE_GOT", "SE_EAS", "SE_UPP"],
  SE_NOR: ["SE_UPP"],
  SE_UPP: ["SE_STH", "SE_EAS", "SE_VML", "SE_NOR"],
};

/** Turkey's eight 1979 macro-regions. */
const TR_ADJACENCY: AdjacencyMap = {
  TR_IST: ["TR_IZM", "TR_BLA", "TR_CEN"],
  TR_ANK: ["TR_BLA", "TR_CEN"],
  TR_IZM: ["TR_IST", "TR_MED", "TR_CEN"],
  TR_MED: ["TR_IZM", "TR_CEN", "TR_ESA", "TR_SEA"],
  TR_BLA: ["TR_IST", "TR_ANK", "TR_CEN", "TR_ESA"],
  TR_ESA: ["TR_BLA", "TR_CEN", "TR_MED", "TR_SEA"],
  TR_SEA: ["TR_MED", "TR_ESA"],
  TR_CEN: ["TR_IST", "TR_ANK", "TR_IZM", "TR_MED", "TR_BLA", "TR_ESA"],
};

/**
 * Greece's six 1979 macro-regions. The islands connect to Attica through the
 * Piraeus ferry network.
 */
const GR_ADJACENCY: AdjacencyMap = {
  GR_ATT: ["GR_EPC", "GR_PEL", "GR_ISL"],
  GR_MAC: ["GR_THE", "GR_EPC"],
  GR_THE: ["GR_MAC", "GR_EPC"],
  GR_EPC: ["GR_ATT", "GR_MAC", "GR_THE", "GR_PEL"],
  GR_PEL: ["GR_ATT", "GR_EPC"],
  GR_ISL: ["GR_ATT"], // Piraeus ferry network
};

/** Austria's five 1979 macro-regions. Vienna is enclaved within AT_NOE. */
const AT_ADJACENCY: AdjacencyMap = {
  AT_VIE: ["AT_NOE"],
  AT_NOE: ["AT_VIE", "AT_OOE", "AT_STK"],
  AT_OOE: ["AT_NOE", "AT_STK", "AT_TYR"],
  AT_STK: ["AT_NOE", "AT_OOE", "AT_TYR"],
  AT_TYR: ["AT_OOE", "AT_STK"],
};

/** Finland's six 1979 macro-regions. */
const FI_ADJACENCY: AdjacencyMap = {
  FI_UUS: ["FI_SW", "FI_HAM", "FI_EAS"],
  FI_SW: ["FI_UUS", "FI_HAM", "FI_OST"],
  FI_HAM: ["FI_UUS", "FI_SW", "FI_EAS", "FI_OST"],
  FI_EAS: ["FI_UUS", "FI_HAM", "FI_OST"],
  FI_OST: ["FI_SW", "FI_HAM", "FI_EAS", "FI_LAP"],
  FI_LAP: ["FI_OST"],
};

/** Scotland's seven post-secession sub-regions. */
const SCO_ADJACENCY: AdjacencyMap = {
  GLA: ["HIG", "TAY", "CSC", "STH"],
  LOT: ["CSC", "STH"],
  HIG: ["GLA", "GRA", "TAY"],
  GRA: ["HIG", "TAY"],
  TAY: ["GLA", "HIG", "GRA", "CSC"],
  STH: ["GLA", "LOT", "CSC"],
  CSC: ["GLA", "LOT", "TAY", "STH"],
};

/** Wales's six post-secession sub-regions. */
const WAL_ADJACENCY: AdjacencyMap = {
  CDF: ["SWA", "VAL", "MWA"],
  SWA: ["CDF", "VAL", "MWA", "NWW"],
  VAL: ["CDF", "SWA", "MWA"],
  MWA: ["CDF", "SWA", "VAL", "NWW", "NEW"],
  NWW: ["SWA", "MWA", "NEW"],
  NEW: ["MWA", "NWW"],
};

/**
 * Per-country adjacency map. Every country includes its full seeded region
 * vocabulary, including countries and breakaway nations that are not active in
 * every preset.
 */
export const STATE_ADJACENCY: Readonly<Record<CountryId, AdjacencyMap>> = {
  US: US_ADJACENCY,
  UK: UK_ADJACENCY,
  DE: DE_ADJACENCY,
  JP: JP_ADJACENCY,
  CN: CN_ADJACENCY,
  IE: IE_ADJACENCY,
  BR: BR_ADJACENCY,
  NG: NG_ADJACENCY,
  HU: HU_ADJACENCY,
  PL: PL_ADJACENCY,
  RO: RO_ADJACENCY,
  YU: YU_ADJACENCY,
  BG: BG_ADJACENCY,
  UKR: UKR_ADJACENCY,
  BLR: BLR_ADJACENCY,
  CS: CS_ADJACENCY,
  BAL: BAL_ADJACENCY,
  RU: RU_ADJACENCY,
  FR: FR_ADJACENCY,
  IT: IT_ADJACENCY,
  ES: ES_ADJACENCY,
  SE: SE_ADJACENCY,
  TR: TR_ADJACENCY,
  GR: GR_ADJACENCY,
  AT: AT_ADJACENCY,
  FI: FI_ADJACENCY,
  DD: DD_ADJACENCY,
  SCO: SCO_ADJACENCY,
  WAL: WAL_ADJACENCY,
};

/**
 * Return the list of state/region IDs adjacent to `stateId` in `country`.
 * Empty array when the country isn't in the map (coming-soon) or the
 * state isn't present (unknown ID, no entry seeded).
 *
 * Caller is responsible for prepending the chair's home state itself to
 * the picker options — adjacency does NOT include the input state.
 */
export function adjacentStates(country: CountryId, stateId: string): readonly string[] {
  return STATE_ADJACENCY[country]?.[stateId] ?? [];
}
