export type Pool = "left" | "right" | "grey";

export interface PoolPercents {
  left: number;
  right: number;
  grey: number;
}

export interface PoolRegRow {
  partyId: string;
  registration?: number;
}

/** Map a party's economic position to an ideological pool. Explicit override wins. */
export function getPartyPool(party: { economicPosition: number; pool?: Pool }): Pool {
  if (party.pool) return party.pool;
  if (party.economicPosition <= -1) return "left";
  if (party.economicPosition >= 1) return "right";
  return "grey";
}

/**
 * Aggregate per-party registration into left/right/grey percentages.
 * - `poolOf` resolves a partyId to its pool.
 * - Grey absorbs `independent` + `unregistered` from the pool doc; when the
 *   doc is absent, grey is the residual to 100%.
 * - Result is normalized to sum to 100 (guards dirty/overshooting data).
 */
export function aggregatePoolPercents(
  rows: PoolRegRow[],
  poolOf: (partyId: string) => Pool,
  poolDoc?: { independent: number; unregistered: number } | null
): PoolPercents {
  let left = 0;
  let right = 0;
  let greyParties = 0;
  for (const row of rows) {
    const reg = row.registration ?? 0;
    const pool = poolOf(row.partyId);
    if (pool === "left") left += reg;
    else if (pool === "right") right += reg;
    else greyParties += reg;
  }

  let grey: number;
  if (poolDoc) {
    grey = greyParties + poolDoc.independent + poolDoc.unregistered;
  } else {
    grey = Math.max(0, 100 - left - right - greyParties) + greyParties;
  }

  const total = left + right + grey;
  if (total <= 0) return { left: 0, right: 0, grey: 100 };
  return {
    left: (left / total) * 100,
    right: (right / total) * 100,
    grey: (grey / total) * 100,
  };
}

/**
 * Below this combined left+right share, a state has effectively no two-party
 * registration signal (e.g. a seed with no `statePartyOrg` rows, or parties that
 * all bin to grey). Callers should fall back to a PVI/neutral split instead of
 * shipping an all-grey budget.
 */
export const MIN_TWO_PARTY_PERCENT = 2;

/** Grey share of the neutral fallback split (≈ 6 of every 16 squares). */
const FALLBACK_GREY_PERCENT = 37.5;
/** PVI magnitude that maps the neutral split to a fully one-sided two-party share. */
const FALLBACK_PVI_FULL_SCALE = 30;

/**
 * Derive left/right/grey percentages from cookPVI when party registration is
 * missing. Positive average PVI tilts right, negative tilts left; absent or zero
 * PVI yields a neutral split (≈ 5L / 6G / 5R per 16 squares) so a state is never
 * shipped as monochromatic grey.
 */
export function derivePoolPercentsFromPvi(pvis: (number | null)[] | null): PoolPercents {
  const vals = (pvis ?? []).filter((p): p is number => typeof p === "number" && p !== 0);
  let tilt = 0;
  if (vals.length > 0) {
    const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
    tilt = Math.max(-1, Math.min(1, avg / FALLBACK_PVI_FULL_SCALE));
  }
  const half = (100 - FALLBACK_GREY_PERCENT) / 2;
  return {
    left: half * (1 - tilt),
    right: half * (1 + tilt),
    grey: FALLBACK_GREY_PERCENT,
  };
}
