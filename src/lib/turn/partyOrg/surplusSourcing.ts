/**
 * Shared Reg surplus sourcing — pure helpers, no DB / server imports.
 *
 * Both passive Org→Reg drift (`regDriftDecay`) and the paid Registration
 * Drive (`demographicTurnoutTurn`) need the same rule for "where does a
 * registration gain come from once the state's Independent + Unregistered
 * pool is empty?". Keeping that rule in one place stops the two mechanisms
 * from drifting apart, and keeping this module free of `getDb` lets the
 * treasury/HQ UI reuse the drive helpers without pulling server code into the
 * browser bundle.
 */

/** A party's Org / Reg standing in one state. */
export interface SurplusPartyView {
  rowId: string;
  partyId: string;
  orgPct: number;
  regPct: number;
}

/** A planned Reg movement for one party. */
export interface SurplusPartyDelta {
  partyId: string;
  rowId: string;
  delta: number;
  newReg: number;
}

/**
 * Source a registration shortfall from parties whose Reg sits ABOVE their
 * target (`max(0, Org − lag)`), in proportion to each party's surplus.
 *
 * Why this exists: drift only ever drew from the non-party pool, and once a
 * state's Independent + Unregistered buckets are exhausted (every US state by
 * live turn ~140) the capacity cap scaled every climb to zero. From then on
 * the only mover was the 0.004 pp/turn decay, and registration was frozen
 * against parties that had built real Org. Organised opposition is exactly the
 * "real political cause" seeded registration is meant to respond to, so the
 * shortfall comes from the over-registered incumbents instead of nowhere.
 *
 * Bounds:
 *   - a party never gives more than its surplus (Reg never drops below target);
 *   - a relieved party (e.g. the governor's, for passive drift) contributes at
 *     `(1 − relief.factor)` weight;
 *   - a state where no party is below target has no shortfall and is untouched,
 *     so an unchallenged Solid South seed stays as durable as before.
 *
 * Returns negative deltas for the sourced parties (their total is
 * `-min(shortfall, Σ surplus)`) so they merge into the caller's deltas and
 * ledger exactly like any other movement.
 */
export function sourceFromSurplus(
  views: SurplusPartyView[],
  climbers: SurplusPartyDelta[],
  shortfall: number,
  regLagBelowOrg: number = 0,
  relief?: { partyId: string; factor: number }
): SurplusPartyDelta[] {
  if (shortfall <= 0) return [];
  const climbing = new Set(climbers.map((d) => d.partyId));
  const donors = views
    .filter((p) => !climbing.has(p.partyId))
    .map((p) => {
      const target = Math.max(0, p.orgPct - regLagBelowOrg);
      const surplus = p.regPct - target;
      const weight = relief && p.partyId === relief.partyId ? Math.max(0, 1 - relief.factor) : 1;
      return { view: p, surplus, weight, drawn: 0 };
    })
    .filter((d) => d.surplus > 0 && d.weight > 0);
  if (donors.length === 0) return [];

  // Water-fill: distribute by (surplus × weight), cap each donor at its
  // surplus, and re-spread any remainder over the donors still under cap.
  let remaining = Math.min(
    shortfall,
    donors.reduce((sum, d) => sum + d.surplus, 0)
  );
  const EPS = 1e-12;
  while (remaining > EPS) {
    const open = donors.filter((d) => d.surplus - d.drawn > EPS);
    if (open.length === 0) break;
    const totalWeight = open.reduce((sum, d) => sum + (d.surplus - d.drawn) * d.weight, 0);
    if (totalWeight <= 0) break;
    const batch = remaining;
    for (const d of open) {
      const share = (batch * (d.surplus - d.drawn) * d.weight) / totalWeight;
      const take = Math.min(share, d.surplus - d.drawn);
      d.drawn += take;
      remaining -= take;
    }
  }

  return donors
    .filter((d) => d.drawn > 0)
    .map((d) => ({
      partyId: d.view.partyId,
      rowId: d.view.rowId,
      delta: -d.drawn,
      newReg: d.view.regPct - d.drawn,
    }));
}
