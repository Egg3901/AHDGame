import type { EraId } from "@/lib/seeds/presetSelector";
import { marginToLean } from "@/lib/data/2020ElectionResults";
import { ELECTION_2020_MARGIN } from "@/lib/data/2020ElectionResults";
import { ELECTION_1988_MARGIN } from "@/lib/data/1988ElectionResults";
import { ELECTION_1980_MARGIN } from "@/lib/data/1980ElectionResults";
import { ELECTION_2000_MARGIN } from "@/lib/data/2000ElectionResults";
import { ELECTION_2008_MARGIN } from "@/lib/data/2008ElectionResults";
import { ELECTION_2024_MARGIN } from "@/lib/data/2024ElectionResults";
import { ELECTION_1952_MARGIN } from "@/lib/data/1952ElectionResults";
import { deriveRegionLeans } from "./deriveRegionLeans";

/**
 * ELECTION-BASELINE RECONSTRUCTION
 * ================================
 * The seed-readiness principle: leans are not hard-set per region. Instead the
 * demographic seed should, on its own, reconstruct the *approximate* result of
 * the real election nearest the era — the same election that seeds initial
 * party Org in `statePartyOrg.ts`. This module is the shared oracle: it maps a
 * country×era to its real by-region margin table and scores the derived leans
 * against it.
 *
 * Margin convention (matches every table in `src/lib/data/*ElectionResults.ts`):
 *   positive = the LEFT party (Dem) won the region, negative = the RIGHT party.
 * Derived `display` lean convention (from `deriveRegionLeans`):
 *   negative = left, positive = right.
 * So `marginToLean(margin) = -margin/10` puts both on the same −5..+5 axis and
 * `leanToMargin(lean) = -lean*10` projects a derived lean back to a margin.
 *
 * Keep `ELECTION_BASELINES` in sync with `PRESET_MARGINS` in
 * `src/lib/seeds/reference/statePartyOrg.ts`.
 */

export interface ElectionBaseline {
  /** Real by-region margin table (Dem% − Rep%). */
  margins: Record<string, number>;
  /** Provenance string for reporting. */
  election: string;
}

/**
 * Per country×era real-election baseline. Only countries whose by-region
 * results we have curated appear here; absent cells degrade to qualitative
 * (sign-anchor) checks and are reported as a completeness gap by the audit.
 */
export const ELECTION_BASELINES: Partial<Record<string, Partial<Record<EraId, ElectionBaseline>>>> =
  {
    US: {
      "1953": {
        margins: ELECTION_1952_MARGIN,
        election: "US 1952 presidential (Stevenson v Eisenhower)",
      },
      "1979": { margins: ELECTION_1980_MARGIN, election: "US 1980 presidential (Carter v Reagan)" },
      "1991": { margins: ELECTION_1988_MARGIN, election: "US 1988 presidential (Dukakis v Bush)" },
      "1999": { margins: ELECTION_2000_MARGIN, election: "US 2000 presidential (Gore v Bush)" },
      "2007": { margins: ELECTION_2008_MARGIN, election: "US 2008 presidential (Obama v McCain)" },
      "2019": { margins: ELECTION_2020_MARGIN, election: "US 2020 presidential (Biden v Trump)" },
      "2023": { margins: ELECTION_2024_MARGIN, election: "US 2024 presidential (Harris v Trump)" },
    },
  };

export function getElectionBaseline(country: string, era: EraId): ElectionBaseline | undefined {
  return ELECTION_BASELINES[country]?.[era];
}

/** Project a derived display lean (−5..+5) back to a presidential margin (Dem−Rep). */
export function leanToMargin(lean: number): number {
  return -lean * 10;
}

export interface ReconstructionResult {
  country: string;
  era: EraId;
  election: string;
  /** Regions scored (present in both the derived leans and the margin table). */
  n: number;
  /** Fraction of decisive regions whose derived lean sign matches the winner. */
  signAgreement: number;
  /** Mean absolute error between projected margin and real margin (pts). */
  meanAbsMarginError: number;
  /** Spearman rank correlation between derived lean and real lean (−1..1). */
  rankCorrelation: number;
  /** Regions where the derived sign disagrees with a decisive real result. */
  signMisses: Array<{ regionId: string; realMargin: number; derivedLean: number }>;
  /** Regions in the margin table but missing from the derived leans. */
  missingRegions: string[];
}

/**
 * Score the derived seed leans for a country×era against the real election.
 * Returns null when no curated baseline exists for the cell.
 *
 * @param decisiveThreshold Regions with |real margin| ≤ this (pts) are treated
 *   as genuine toss-ups and excluded from the sign-agreement count, so a derived
 *   D+0.3 vs a real R+0.3 in a coin-flip state isn't scored as a "miss".
 */
export function reconstructBaseline(
  country: string,
  era: EraId,
  decisiveThreshold = 2
): ReconstructionResult | null {
  const baseline = getElectionBaseline(country, era);
  if (!baseline) return null;

  const derived = deriveRegionLeans(country, era);
  const byId = new Map(derived.map((r) => [r.regionId, r.display]));

  const pairs: Array<{ regionId: string; realMargin: number; realLean: number; lean: number }> = [];
  const missingRegions: string[] = [];
  for (const [regionId, realMargin] of Object.entries(baseline.margins)) {
    const lean = byId.get(regionId);
    if (lean === undefined) {
      missingRegions.push(regionId);
      continue;
    }
    pairs.push({ regionId, realMargin, realLean: marginToLean(realMargin), lean });
  }

  const n = pairs.length;
  const decisive = pairs.filter((p) => Math.abs(p.realMargin) > decisiveThreshold);
  const signMisses = decisive
    .filter((p) => Math.sign(p.lean) !== Math.sign(p.realLean) && p.lean !== 0)
    .map((p) => ({ regionId: p.regionId, realMargin: p.realMargin, derivedLean: p.lean }));
  const signAgreement =
    decisive.length === 0 ? 1 : (decisive.length - signMisses.length) / decisive.length;

  const meanAbsMarginError =
    n === 0 ? 0 : pairs.reduce((s, p) => s + Math.abs(leanToMargin(p.lean) - p.realMargin), 0) / n;

  const rankCorrelation = spearman(
    pairs.map((p) => p.lean),
    pairs.map((p) => p.realLean)
  );

  return {
    country,
    era,
    election: baseline.election,
    n,
    signAgreement,
    meanAbsMarginError,
    rankCorrelation,
    signMisses,
    missingRegions,
  };
}

/** Spearman rank correlation; returns 0 for degenerate inputs. */
function spearman(a: number[], b: number[]): number {
  if (a.length < 2 || a.length !== b.length) return 0;
  const ra = rank(a);
  const rb = rank(b);
  const n = a.length;
  const mean = (n + 1) / 2;
  let cov = 0;
  let va = 0;
  let vb = 0;
  for (let i = 0; i < n; i++) {
    const da = ra[i] - mean;
    const db = rb[i] - mean;
    cov += da * db;
    va += da * da;
    vb += db * db;
  }
  if (va === 0 || vb === 0) return 0;
  return cov / Math.sqrt(va * vb);
}

/** Average-rank (ties shared) ranking, 1-based. */
function rank(xs: number[]): number[] {
  const idx = xs.map((x, i) => ({ x, i })).sort((p, q) => p.x - q.x);
  const ranks = new Array<number>(xs.length);
  let i = 0;
  while (i < idx.length) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1].x === idx[i].x) j++;
    const avg = (i + j) / 2 + 1; // average of 1-based ranks i+1..j+1
    for (let k = i; k <= j; k++) ranks[idx[k].i] = avg;
    i = j + 1;
  }
  return ranks;
}
