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
 * Per-country adjacency map. Coming-soon countries (BR, IE, NG) ship with
 * empty maps — the F4 picker just shows the chair's home state until
 * those countries activate and their adjacency data is filled in.
 */
export const STATE_ADJACENCY: Readonly<Record<CountryId, AdjacencyMap>> = {
  US: US_ADJACENCY,
  UK: UK_ADJACENCY,
  DE: DE_ADJACENCY,
  JP: JP_ADJACENCY,
  CN: CN_ADJACENCY,
  IE: {},
  BR: {},
  NG: {},
  HU: {},
  PL: {},
  RO: {},
  YU: {},
  BG: {},
  UKR: {},
  BLR: {},
  CS: {},
  BAL: {},
  RU: RU_ADJACENCY,
  FR: {},
  IT: {},
  ES: {},
  SE: {},
  TR: {},
  GR: {},
  AT: {},
  FI: {},
  DD: DD_ADJACENCY,
  SCO: {},
  WAL: {},
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
