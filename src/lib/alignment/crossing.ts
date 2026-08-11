/**
 * Era crossing: re-project a nation's shares onto the poles of the era it has
 * just entered. Runs ONCE per crossing, guarded by the stored era key, so a
 * long-running game converts cleanly instead of drifting between two
 * vocabularies — or re-converting every turn forever.
 */
import {
  polesForYear,
  resolveAlignmentEra,
  type AlignmentPoleId,
} from "@/lib/constants/alignmentEras";
import { normalizeShares, type AlignmentShares } from "./normalize";

export interface EraCrossingResult {
  shares: AlignmentShares;
  eraKey: string;
  crossed: boolean;
}

export function applyEraCrossing(params: {
  shares: AlignmentShares;
  storedEraKey: string;
  year: number;
}): EraCrossingResult {
  const era = resolveAlignmentEra(params.year);
  if (era.key === params.storedEraKey) {
    return { shares: params.shares, eraKey: params.storedEraKey, crossed: false };
  }

  const poles = polesForYear(params.year);
  const next: Partial<Record<AlignmentPoleId, number>> = {};
  // Seed every surviving pole at zero so a pole nobody inherits into — Beijing
  // in 1991 — reads as a real zero rather than an absence.
  for (const pole of poles) next[pole] = 0;

  for (const [from, value] of Object.entries(params.shares.shares) as [AlignmentPoleId, number][]) {
    // A pole that survives the era keeps its own share; one that is superseded
    // hands it to its declared successor. Anything with neither is dropped, and
    // normalizeShares returns it to the uncommitted pool.
    const target = poles.includes(from) ? from : era.inherit[from];
    if (target && poles.includes(target)) next[target] = (next[target] ?? 0) + value;
  }

  return { shares: normalizeShares(next, poles), eraKey: era.key, crossed: true };
}
