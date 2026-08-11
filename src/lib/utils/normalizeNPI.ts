/**
 * Soft diminishing-returns normalization for state-level political influence.
 *
 * Maps raw PI (0..∞) to a 0..1 multiplier via `sqrt(min(100, max(0, pi))/100)`.
 * Hard-capped at 1.0 — state primary scoring already clamps PI to 100, and the
 * general-election appeal multiplier saturates at 1.0 as well. The sqrt shape
 * gives meaningful separation at the high end (PI=85 vs PI=99 ≈ 0.073 spread,
 * or ~1.8 pts out of 25 in the primary infScore) while still flattening
 * compared to a pure linear curve at the low end.
 *
 * Results:
 *   PI=0   → 0.0
 *   PI=25  → 0.5
 *   PI=50  → 0.707
 *   PI=85  → 0.922
 *   PI=99  → 0.995
 *   PI≥100 → 1.0  (capped)
 *
 * Presidential primary reach uses {@link normalizeNationalReachPresidentialPrimary}
 * (linear-up-to-cap) and is NOT affected by this curve.
 */
export function normalizeNPI(npi: number): number {
  const clamped = Math.min(100, Math.max(0, npi));
  return Math.sqrt(clamped / 100);
}

/**
 * Raw NPI → effective national reach on a 0–100 mental scale (returned as 0–1).
 *
 * Used for **US presidential primaries** only (stagger votes, projections, and
 * `calcPresidentPrimaryScore`).
 *
 * Curve: diminishing returns via `1 − exp(−PI/45)`.
 *   PI=25  → 0.426
 *   PI=55  → 0.706
 *   PI=80  → 0.831
 *   PI=100 → 0.892
 *   PI=200 → 0.988
 *
 * The diminishing shape keeps Support / Favorability / Org levers competitive
 * against a moderate PI gap. The previous linear-up-to-cap curve (held behind
 * the flag below — toggle to `false` to restore) gave PI an outsized monopoly:
 * a 25-pt PI gap produced a 1.45× reach advantage that Support's `[0.6, 1.4]`
 * multiplier could not overcome. Simulation P3 (2026-05-23) showed that under
 * the linear curve a +35-pt Support insurgent lost 41-59 to a +25-pt PI
 * establishment — inconsistent with real primary dynamics (Sanders 2016 NH,
 * Trump 2016). Under the diminishing curve the same matchup is competitive.
 *
 * General-election presidential reach still uses {@link normalizeNPI} (sqrt curve, capped at 1.0).
 *
 * Equivalent "score" for UI: `Math.round(100 * normalizeNationalReachPresidentialPrimary(npi))`.
 */
export const PRESIDENTIAL_PRIMARY_NATIONAL_REACH_TAU = 45;
export const PRESIDENTIAL_PRIMARY_TEMP_NPI_CAP = 100;
export const PRESIDENTIAL_PRIMARY_USE_DIMINISHING_RETURNS = true;

export function normalizeNationalReachPresidentialPrimary(npi: number): number {
  const x = Math.max(0, npi);
  if (!PRESIDENTIAL_PRIMARY_USE_DIMINISHING_RETURNS) {
    return Math.min(PRESIDENTIAL_PRIMARY_TEMP_NPI_CAP, x) / PRESIDENTIAL_PRIMARY_TEMP_NPI_CAP;
  }
  return 1 - Math.exp(-x / PRESIDENTIAL_PRIMARY_NATIONAL_REACH_TAU);
}

/**
 * Raw `character.partyInfluence` → 0–1 on the presidential-primary party-clout
 * lever (multiply by the presidential primary party-influence weight, currently
 * 30, for the snapshot component score).
 *
 * Replaces home-state party organization as the primary "party standing" input:
 * home-state org is near-constant across same-party rivals (it's THE SAME PARTY),
 * so it never differentiated candidates; a candidate's own accumulated party
 * influence does. NPPs (no `partyInfluence` field) pass 0 here by convention.
 *
 * Curve: **linear, uncapped**, using {@link PRESIDENTIAL_PRIMARY_PARTY_INFLUENCE_SCALE}
 * as the reference point (partyInfluence == SCALE → 1.0). partyInfluence has no
 * hard ceiling in-game (accumulates unbounded; live values exceed 200), so the
 * map is deliberately uncapped: influence above the reference scale keeps
 * paying off linearly (normalized > 1.0) rather than being silently clipped.
 * Values at/below the scale are unchanged from the previous capped behavior, so
 * this is a strict widening of the lever's top end. Still NOT a diminishing-
 * returns curve: DR re-creates the saturation that made national reach a dead
 * differentiator (see #934 audit).
 *
 * Also feeds the state-by-state presidential-primary vote weight via
 * `MAX_PARTY_INFLUENCE_BONUS_PRIMARY` in the election engine (so the vote-weight
 * bonus is likewise no longer ceilinged at that constant).
 */
export const PRESIDENTIAL_PRIMARY_PARTY_INFLUENCE_SCALE = 150;

export function normalizePartyInfluencePresidentialPrimary(partyInfluence: number): number {
  const x = Math.max(0, partyInfluence);
  return x / PRESIDENTIAL_PRIMARY_PARTY_INFLUENCE_SCALE;
}
