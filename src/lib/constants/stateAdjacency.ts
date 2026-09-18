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
import { PL_ADJACENCY_MAP } from "@/lib/countries/pl/geographyFacts";
import { HU_ADJACENCY_MAP } from "@/lib/countries/hu/geographyFacts";
import { RO_ADJACENCY_MAP } from "@/lib/countries/ro/geographyFacts";
import { YU_ADJACENCY_MAP } from "@/lib/countries/yu/geographyFacts";
import { BG_ADJACENCY_MAP } from "@/lib/countries/bg/geographyFacts";
import { CS_ADJACENCY_MAP } from "@/lib/countries/cs/geographyFacts";
import { SCO_ADJACENCY_MAP } from "@/lib/countries/sco/geographyFacts";
import { WAL_ADJACENCY_MAP } from "@/lib/countries/wal/geographyFacts";
import { BLR_ADJACENCY_MAP } from "@/lib/countries/blr/geographyFacts";
import { UKR_ADJACENCY_MAP } from "@/lib/countries/ukr/geographyFacts";
import { BAL_ADJACENCY_MAP } from "@/lib/countries/bal/geographyFacts";

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

/** Poland's eight 1979 macro-regions. */

/** Romania's seven 1979 historic-province regions. */

/** Yugoslavia's six republics and two Serbian autonomous provinces. */

/** Bulgaria's five 1979 geographic regions. */

/** Ukraine's six 1953 and 1979 macro-regions. */

/** Byelorussia's six oblasts. */

/** Czechoslovakia's three historic lands plus enclaved Prague. */

/** Baltic republics, ordered north to south. */

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

/** Wales's six post-secession sub-regions. */

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
  HU: HU_ADJACENCY_MAP,
  PL: PL_ADJACENCY_MAP,
  RO: RO_ADJACENCY_MAP,
  YU: YU_ADJACENCY_MAP,
  BG: BG_ADJACENCY_MAP,
  UKR: UKR_ADJACENCY_MAP,
  BLR: BLR_ADJACENCY_MAP,
  CS: CS_ADJACENCY_MAP,
  BAL: BAL_ADJACENCY_MAP,
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
  SCO: SCO_ADJACENCY_MAP,
  WAL: WAL_ADJACENCY_MAP,
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
