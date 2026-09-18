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
import { JP_ADJACENCY_MAP } from "@/lib/countries/jp/geographyFacts";
import { US_ADJACENCY_MAP } from "@/lib/countries/us/geographyFacts";
import { UK_ADJACENCY_MAP } from "@/lib/countries/uk/geographyFacts";
import { DE_ADJACENCY_MAP } from "@/lib/countries/de/geographyFacts";
import { CN_ADJACENCY_MAP } from "@/lib/countries/cn/geographyFacts";
import { IE_ADJACENCY_MAP } from "@/lib/countries/ie/geographyFacts";
import { RU_ADJACENCY_MAP } from "@/lib/countries/ru/geographyFacts";
import { DD_ADJACENCY_MAP } from "@/lib/countries/dd/geographyFacts";
import { NG_ADJACENCY_MAP } from "@/lib/countries/ng/geographyFacts";
import { BR_ADJACENCY_MAP } from "@/lib/countries/br/geographyFacts";
import { FR_ADJACENCY_MAP } from "@/lib/countries/fr/geographyFacts";
import { IT_ADJACENCY_MAP } from "@/lib/countries/it/geographyFacts";
import { ES_ADJACENCY_MAP } from "@/lib/countries/es/geographyFacts";
import { SE_ADJACENCY_MAP } from "@/lib/countries/se/geographyFacts";
import { TR_ADJACENCY_MAP } from "@/lib/countries/tr/geographyFacts";
import { GR_ADJACENCY_MAP } from "@/lib/countries/gr/geographyFacts";
import { AT_ADJACENCY_MAP } from "@/lib/countries/at/geographyFacts";
import { FI_ADJACENCY_MAP } from "@/lib/countries/fi/geographyFacts";

export type AdjacencyMap = Record<string, readonly string[]>;

/**
 * DE 16 Bundesländer. Standard geographic land adjacency. Berlin (BE)
 * is enclaved entirely within Brandenburg (BB) — its only neighbor.
 */

/**
 * CN 7 grouped regions. These are coarse macro-regions; each pair of
 * adjacent macro-regions has at least one provincial border touching.
 */

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

/**
 * DD (East Germany) 6 regions. Reuses the modern eastern-Länder codes
 * shared with the `DE` map (see `ddRegions.ts`), so land adjacency is the
 * DE map restricted to those codes — the West German neighbors those
 * Länder have under `DE` (SH, NI, BY, HE) fall outside DD. East Berlin
 * (BEO) is enclaved within Brandenburg, mirroring DE's BE ↔ BB.
 */

/**
 * Ireland's eight composite planning regions. Borders follow the constituent
 * counties documented in `ieRegions.ts`.
 */

/** Brazil's five IBGE macro-regions. */

/** Nigeria's six geopolitical zones. */

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

/**
 * Italy's eight 1979 macro-regions. Sicily connects to the south across the
 * Strait of Messina. Sardinia connects to Lazio by the Olbia-Civitavecchia
 * ferry route.
 */

/** Spain's eight 1979 macro-regions. Island groups belong to ES_CEN. */

/** Sweden's eight 1979 macro-regions. */

/** Turkey's eight 1979 macro-regions. */

/**
 * Greece's six 1979 macro-regions. The islands connect to Attica through the
 * Piraeus ferry network.
 */

/** Austria's five 1979 macro-regions. Vienna is enclaved within AT_NOE. */

/** Finland's six 1979 macro-regions. */

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
  US: US_ADJACENCY_MAP,
  UK: UK_ADJACENCY_MAP,
  DE: DE_ADJACENCY_MAP,
  JP: JP_ADJACENCY_MAP,
  CN: CN_ADJACENCY_MAP,
  IE: IE_ADJACENCY_MAP,
  BR: BR_ADJACENCY_MAP,
  NG: NG_ADJACENCY_MAP,
  HU: HU_ADJACENCY,
  PL: PL_ADJACENCY,
  RO: RO_ADJACENCY,
  YU: YU_ADJACENCY,
  BG: BG_ADJACENCY,
  UKR: UKR_ADJACENCY,
  BLR: BLR_ADJACENCY,
  CS: CS_ADJACENCY,
  BAL: BAL_ADJACENCY,
  RU: RU_ADJACENCY_MAP,
  FR: FR_ADJACENCY_MAP,
  IT: IT_ADJACENCY_MAP,
  ES: ES_ADJACENCY_MAP,
  SE: SE_ADJACENCY_MAP,
  TR: TR_ADJACENCY_MAP,
  GR: GR_ADJACENCY_MAP,
  AT: AT_ADJACENCY_MAP,
  FI: FI_ADJACENCY_MAP,
  DD: DD_ADJACENCY_MAP,
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
