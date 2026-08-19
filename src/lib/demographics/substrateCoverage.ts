/**
 * G1 gate: does every seeded region have a granular-electorate substrate?
 *
 * `deriveGranularElectorateUnits` returns null when a region has no census
 * entry, no country model, or no cell survives pruning. Today that is a silent
 * degrade to the legacy archetype documents, so a missing census costs a region
 * nothing visible. Once the archetype catalogs are gone the same null is a ZERO
 * ELECTORATE: no units, no votes, no lean.
 *
 * So the deletion cannot be judged safe from the vote path being green — it is
 * green today precisely because the fallback catches the gaps. This module
 * enumerates the real seeded rosters (the same era bundles the seeders write to
 * `states`, not the models own census keys, which would only prove the models
 * agree with themselves) and derives a substrate for each region in each era it
 * seeds in.
 *
 * Consumed by `substrateCoverage.test.ts` (the permanent gate) and by
 * `scripts/audit/substrate-coverage.ts` (the reviewable report).
 */

import type { CountryId } from "@/lib/constants/countries";
import type { State } from "@/lib/db/types";
import { deriveGranularElectorateUnits } from "./granularElectorate";
import { type EraId, presetForEra } from "@/lib/seeds/presetSelector";

/** Every era a world can be seeded into, oldest first. */
export const COVERAGE_ERAS: readonly EraId[] = [
  "1953",
  "1979",
  "1991",
  "1999",
  "2007",
  "2019",
  "2023",
];

/**
 * Per-country region rosters, keyed by the era the bundle was authored for.
 *
 * Thunks rather than static imports: the rosters together pull in every
 * country seed module, and this file is imported by a client-reachable
 * barrel-free path only from tests and scripts. Lazy keeps that cost off any
 * other importer.
 *
 * A country with no bundle for an era falls back to its "2019" bundle, which is
 * exactly what `selectPresetBundle` does at seed time — see the per-country
 * `seedXXRegions` functions.
 */
type RosterThunk = () => Promise<State[]>;

const REGION_ROSTERS: Partial<Record<CountryId, Partial<Record<EraId, RosterThunk>>>> = {
  US: {
    "1953": () => import("@/lib/seeds/reference/states1953").then((m) => m.states1953),
    "1979": () => import("@/lib/seeds/reference/states1979").then((m) => m.states1979),
    "1991": () => import("@/lib/seeds/reference/states1991").then((m) => m.states1991),
    "1999": () => import("@/lib/seeds/reference/states1999").then((m) => m.states1999),
    "2007": () => import("@/lib/seeds/reference/states2007").then((m) => m.states2007),
    "2019": () => import("@/lib/seeds/reference/states").then((m) => m.states),
    "2023": () => import("@/lib/seeds/reference/states2023").then((m) => m.states2023),
  },
  UK: {
    "1953": () => import("@/lib/seeds/uk/ukRegions1953").then((m) => m.ukRegions1953),
    "1979": () => import("@/lib/seeds/uk/ukRegions1979").then((m) => m.ukRegions1979),
    "1991": () => import("@/lib/seeds/uk/ukRegions1991").then((m) => m.ukRegions1991),
    "1999": () => import("@/lib/seeds/uk/ukRegions1999").then((m) => m.ukRegions1999),
    "2007": () => import("@/lib/seeds/uk/ukRegions2007").then((m) => m.ukRegions2007),
    "2019": () => import("@/lib/seeds/uk/ukRegions").then((m) => m.ukRegions),
    "2023": () => import("@/lib/seeds/uk/ukRegions2023").then((m) => m.ukRegions2023),
  },
  DE: {
    "1953": () => import("@/lib/seeds/de/deRegions1953").then((m) => m.deRegions1953),
    "1979": () => import("@/lib/seeds/de/deRegions1979").then((m) => m.deRegions1979),
    "1991": () => import("@/lib/seeds/de/deRegions1991").then((m) => m.deRegions1991),
    "1999": () => import("@/lib/seeds/de/deRegions1999").then((m) => m.deRegions1999),
    "2007": () => import("@/lib/seeds/de/deRegions2007").then((m) => m.deRegions2007),
    "2019": () => import("@/lib/seeds/de/deRegions").then((m) => m.deRegions),
    "2023": () => import("@/lib/seeds/de/deRegions2023").then((m) => m.deRegions2023),
  },
  JP: {
    "1953": () => import("@/lib/seeds/jp/jpRegions1953").then((m) => m.jpRegions1953),
    "1979": () => import("@/lib/seeds/jp/jpRegions1979").then((m) => m.jpRegions1979),
    "1991": () => import("@/lib/seeds/jp/jpRegions1991").then((m) => m.jpRegions1991),
    "1999": () => import("@/lib/seeds/jp/jpRegions1999").then((m) => m.jpRegions1999),
    "2007": () => import("@/lib/seeds/jp/jpRegions2007").then((m) => m.jpRegions2007),
    "2019": () => import("@/lib/seeds/jp/jpRegions").then((m) => m.jpRegions),
    "2023": () => import("@/lib/seeds/jp/jpRegions2023").then((m) => m.jpRegions2023),
  },
  IE: {
    "1953": () => import("@/lib/seeds/ie/ieRegions1953").then((m) => m.ieRegions1953),
    "1979": () => import("@/lib/seeds/ie/ieRegions1979").then((m) => m.ieRegions1979),
    "1991": () => import("@/lib/seeds/ie/ieRegions1991").then((m) => m.ieRegions1991),
    "1999": () => import("@/lib/seeds/ie/ieRegions1999").then((m) => m.ieRegions1999),
    "2007": () => import("@/lib/seeds/ie/ieRegions2007").then((m) => m.ieRegions2007),
    "2019": () => import("@/lib/seeds/ie/ieRegions").then((m) => m.ieRegions),
    "2023": () => import("@/lib/seeds/ie/ieRegions2023").then((m) => m.ieRegions2023),
  },
  BR: {
    "1953": () => import("@/lib/seeds/br/brRegions1953").then((m) => m.brRegions1953),
    "1979": () => import("@/lib/seeds/br/brRegions1979").then((m) => m.brRegions1979),
    "1991": () => import("@/lib/seeds/br/brRegions1991").then((m) => m.brRegions1991),
    "1999": () => import("@/lib/seeds/br/brRegions1999").then((m) => m.brRegions1999),
    "2007": () => import("@/lib/seeds/br/brRegions2007").then((m) => m.brRegions2007),
    "2019": () => import("@/lib/seeds/br/brRegions").then((m) => m.brRegions),
    "2023": () => import("@/lib/seeds/br/brRegions2023").then((m) => m.brRegions2023),
  },
  CN: {
    "1953": () => import("@/lib/seeds/cn/cnRegions1953").then((m) => m.cnRegions1953),
    "1979": () => import("@/lib/seeds/cn/cnRegions1979").then((m) => m.cnRegions1979),
    "1991": () => import("@/lib/seeds/cn/cnRegions1991").then((m) => m.cnRegions1991),
    "1999": () => import("@/lib/seeds/cn/cnRegions1999").then((m) => m.cnRegions1999),
    "2007": () => import("@/lib/seeds/cn/cnRegions2007").then((m) => m.cnRegions2007),
    "2019": () => import("@/lib/seeds/cn/cnRegions").then((m) => m.cnRegions),
    "2023": () => import("@/lib/seeds/cn/cnRegions2023").then((m) => m.cnRegions2023),
  },
  NG: {
    "1953": () => import("@/lib/seeds/ng/ngRegions1953").then((m) => m.ngRegions1953),
    "1979": () => import("@/lib/seeds/ng/ngRegions1979").then((m) => m.ngRegions1979),
    "1991": () => import("@/lib/seeds/ng/ngRegions1991").then((m) => m.ngRegions1991),
    "1999": () => import("@/lib/seeds/ng/ngRegions1999").then((m) => m.ngRegions1999),
    "2007": () => import("@/lib/seeds/ng/ngRegions2007").then((m) => m.ngRegions2007),
    "2019": () => import("@/lib/seeds/ng/ngRegions").then((m) => m.ngRegions),
    "2023": () => import("@/lib/seeds/ng/ngRegions2023").then((m) => m.ngRegions2023),
  },
  HU: {
    "1953": () => import("@/lib/seeds/hu/huRegions1953").then((m) => m.huRegions1953),
    "2019": () => import("@/lib/seeds/hu/huRegions").then((m) => m.huRegions),
  },
  PL: {
    "1953": () => import("@/lib/seeds/pl/plRegions1953").then((m) => m.plRegions1953),
    "2019": () => import("@/lib/seeds/pl/plRegions").then((m) => m.plRegions),
  },
  RO: {
    "1953": () => import("@/lib/seeds/ro/roRegions1953").then((m) => m.roRegions1953),
    "2019": () => import("@/lib/seeds/ro/roRegions").then((m) => m.roRegions),
  },
  YU: {
    "1953": () => import("@/lib/seeds/yu/yuRegions1953").then((m) => m.yuRegions1953),
    "2019": () => import("@/lib/seeds/yu/yuRegions").then((m) => m.yuRegions),
  },
  BG: {
    "1953": () => import("@/lib/seeds/bg/bgRegions1953").then((m) => m.bgRegions1953),
    "2019": () => import("@/lib/seeds/bg/bgRegions").then((m) => m.bgRegions),
  },
  BLR: {
    "1953": () => import("@/lib/seeds/blr/blrRegions1953").then((m) => m.blrRegions1953),
    "2019": () => import("@/lib/seeds/blr/blrRegions").then((m) => m.blrRegions),
  },
  UKR: {
    "1953": () => import("@/lib/seeds/ua/uaRegions1953").then((m) => m.uaRegions1953),
    "2019": () => import("@/lib/seeds/ua/uaRegions").then((m) => m.uaRegions),
  },
  CS: {
    "1953": () => import("@/lib/seeds/cs/csRegions1953").then((m) => m.csRegions1953),
    "2019": () => import("@/lib/seeds/cs/csRegions").then((m) => m.csRegions),
  },
  BAL: {
    "1953": () => import("@/lib/seeds/bal/balRegions1953").then((m) => m.balRegions1953),
    "2019": () => import("@/lib/seeds/bal/balRegions").then((m) => m.balRegions),
  },
  RU: {
    "1953": () => import("@/lib/seeds/ru/ruRegions1953").then((m) => m.ruRegions1953),
    "2019": () => import("@/lib/seeds/ru/ruRegions").then((m) => m.ruRegions),
  },
  FR: {
    "1953": () => import("@/lib/seeds/fr/frRegions1953").then((m) => m.frRegions1953),
    "2019": () => import("@/lib/seeds/fr/frRegions").then((m) => m.frRegions),
  },
  IT: {
    "1953": () => import("@/lib/seeds/it/itRegions1953").then((m) => m.itRegions1953),
    "2019": () => import("@/lib/seeds/it/itRegions").then((m) => m.itRegions),
  },
  ES: {
    "1953": () => import("@/lib/seeds/es/esRegions1953").then((m) => m.esRegions1953),
    "2019": () => import("@/lib/seeds/es/esRegions").then((m) => m.esRegions),
  },
  SE: {
    "1953": () => import("@/lib/seeds/se/seRegions1953").then((m) => m.seRegions1953),
    "2019": () => import("@/lib/seeds/se/seRegions").then((m) => m.seRegions),
  },
  TR: {
    "1953": () => import("@/lib/seeds/tr/trRegions1953").then((m) => m.trRegions1953),
    "2019": () => import("@/lib/seeds/tr/trRegions").then((m) => m.trRegions),
  },
  GR: {
    "1953": () => import("@/lib/seeds/gr/grRegions1953").then((m) => m.grRegions1953),
    "2019": () => import("@/lib/seeds/gr/grRegions").then((m) => m.grRegions),
  },
  AT: {
    "1953": () => import("@/lib/seeds/at/atRegions1953").then((m) => m.atRegions1953),
    "2019": () => import("@/lib/seeds/at/atRegions").then((m) => m.atRegions),
  },
  FI: {
    "1953": () => import("@/lib/seeds/fi/fiRegions1953").then((m) => m.fiRegions1953),
    "2019": () => import("@/lib/seeds/fi/fiRegions").then((m) => m.fiRegions),
  },
  DD: {
    "1953": () => import("@/lib/seeds/dd/ddRegions1953").then((m) => m.ddRegions1953),
    "2019": () => import("@/lib/seeds/dd/ddRegions").then((m) => m.ddRegions),
  },
  SCO: {
    "2019": () => import("@/lib/seeds/sco/scoRegions").then((m) => m.scoRegions),
  },
  WAL: {
    "2019": () => import("@/lib/seeds/wal/walRegions").then((m) => m.walRegions),
  },
};

/** The region ids a country seeds for an era, via the same fallback as seeding. */
export async function regionRosterFor(countryId: CountryId, era: EraId): Promise<string[]> {
  const byEra = REGION_ROSTERS[countryId];
  if (!byEra) return [];
  const thunk = byEra[era] ?? byEra["2019"];
  if (!thunk) return [];
  const regions = await thunk();
  return regions.map((r) => String(r._id));
}

export interface CoverageRow {
  countryId: CountryId;
  era: EraId;
  regionId: string;
  /** null when the region has no substrate at all. */
  units: number | null;
  /** Sum of unit electorate shares; must be ~1 when units exist. */
  shareSum: number | null;
  /** Set when the year-driven path was exercised rather than the preset path. */
  year: number | null;
}

/** An era anchor year is its id — the era ids ARE their anchor years. */
export function anchorYearFor(era: EraId): number {
  return Number(era);
}

/**
 * Derive coverage rows for one country across every era it seeds in.
 *
 * Each region is probed twice: once on the preset path (`year: null`, what a
 * freshly seeded world reads) and once on the year-driven path at the era
 * anchor (what a world reads once the era clock is live). Both must resolve —
 * the year path degrades to the preset path internally, so a null there is a
 * structural gap rather than an interpolation miss.
 */
export async function coverageForCountry(countryId: CountryId): Promise<CoverageRow[]> {
  const rows: CoverageRow[] = [];
  for (const era of COVERAGE_ERAS) {
    const regionIds = await regionRosterFor(countryId, era);
    const preset = presetForEra(era);
    const year = anchorYearFor(era);
    for (const regionId of regionIds) {
      for (const yearCtx of [null, { year, startingYear: year }]) {
        const derived = deriveGranularElectorateUnits(
          countryId,
          regionId,
          preset,
          null,
          null,
          null,
          yearCtx ?? undefined
        );
        rows.push({
          countryId,
          era,
          regionId,
          units: derived ? derived.units.length : null,
          shareSum: derived ? derived.units.reduce((s, u) => s + u.share, 0) : null,
          year: yearCtx ? yearCtx.year : null,
        });
      }
    }
  }
  return rows;
}

/** Rows that would be a zero electorate once the archetype fallback is gone. */
export function failingRows(rows: CoverageRow[]): CoverageRow[] {
  return rows.filter(
    (r) => r.units === null || r.units < 1 || r.shareSum === null || Math.abs(r.shareSum - 1) > 1e-6
  );
}
