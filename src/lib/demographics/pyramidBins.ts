import type { AgeSexVector } from "./cohortVector";

const LAST_INDEX = 100;

export interface PyramidBand {
  label: string;
  ageLo: number;
  ageHi: number; // inclusive; LAST_INDEX for the open-ended top band
  male: number;
  female: number;
  malePct: number; // % of total population (both sexes, all bands)
  femalePct: number;
}

export interface AgePyramid {
  bands: PyramidBand[];
  total: number;
  /** Largest single male/female cell percent — used to scale the bar axis. */
  maxCellPct: number;
}

function sumBand(arr: number[], lo: number, hi: number): number {
  let total = 0;
  for (let age = lo; age <= hi; age++) total += arr[age] ?? 0;
  return total;
}

/**
 * Bin a single-year age×sex vector into bands for a population pyramid. Full
 * bands of `bandSize` years run from age 0 up to `topAge`; the final band is
 * open-ended ("85+") and absorbs everything from `topAge` through index 100
 * (avoids a long thin tail of near-empty single bands at the top). Percents are
 * of the TOTAL population (both sexes) so the two wings are comparable on one axis.
 */
export function buildAgePyramid(vector: AgeSexVector, bandSize = 5, topAge = 85): AgePyramid {
  const total = sumBand(vector.male, 0, LAST_INDEX) + sumBand(vector.female, 0, LAST_INDEX);
  const denom = total > 0 ? total : 1;
  const bands: PyramidBand[] = [];
  let maxCellPct = 0;

  const push = (lo: number, hi: number, label: string) => {
    const male = sumBand(vector.male, lo, hi);
    const female = sumBand(vector.female, lo, hi);
    const malePct = (male / denom) * 100;
    const femalePct = (female / denom) * 100;
    maxCellPct = Math.max(maxCellPct, malePct, femalePct);
    bands.push({ label, ageLo: lo, ageHi: hi, male, female, malePct, femalePct });
  };

  for (let lo = 0; lo < topAge; lo += bandSize) {
    const hi = lo + bandSize - 1;
    push(lo, hi, `${lo}–${hi}`);
  }
  push(topAge, LAST_INDEX, `${topAge}+`);

  return { bands, total, maxCellPct };
}
