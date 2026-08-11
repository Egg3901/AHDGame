/**
 * Voter-registration drive (player suggestion #81) — pure helpers.
 *
 * A party chair can allocate a percentage of hourly revenue to a registration
 * drive (mirrors the GOTV budget). Each turn the spend is converted, using the
 * same `$/point` curve as GOTV (`DOLLARS_PER_TURNOUT_POINT`), into a small,
 * bounded per-state boost to `StatePartyOrg.registration`. The boost is drawn
 * from the state's non-party pool (unregistered first, then independent) so the
 * per-state 100% registration-pool invariant is preserved — exactly the inverse
 * of how `regDriftDecay` routes decayed registration back into the pool.
 *
 * These functions are pure (no DB / server imports) so the treasury/HQ UI can
 * reuse them for its estimate readout and the turn processor for application.
 */

/**
 * Per-state, per-turn hard ceiling on the registration boost (percentage
 * points). Kept intentionally small so a large treasury cannot outpace the
 * organic Org→Reg drift system by more than a modest factor: the passive drift
 * ceiling is `PASSIVE_REG_DRIFT_RATE = 0.06 pp/turn`, so this caps a fully
 * funded drive at under ~2× the natural pace. Consistent with GOTV's magnitude
 * (its per-state boost is likewise a fraction of a point per turn).
 */
export const REG_DRIVE_MAX_BOOST_PER_STATE = 0.1 as const;

/**
 * Convert a per-state registration-drive spend into a bounded per-state boost
 * (percentage points). Uses the same dollars-per-point curve as GOTV, then
 * clamps to {@link REG_DRIVE_MAX_BOOST_PER_STATE}.
 *
 * @param perStateSpend - Dollars allocated to this state this turn
 * @param dollarsPerPoint - Dollars required to move one point (GOTV's constant)
 * @returns Registration boost in percentage points (>= 0), capped
 */
export function calculateRegistrationDriveBoost(
  perStateSpend: number,
  dollarsPerPoint: number
): number {
  if (perStateSpend <= 0 || dollarsPerPoint <= 0) return 0;
  return Math.min(perStateSpend / dollarsPerPoint, REG_DRIVE_MAX_BOOST_PER_STATE);
}

/** How much of a registration boost the state pool could actually supply. */
export interface RegistrationDriveDraw {
  /** Registration points actually applied (bounded by available pool). */
  applied: number;
  /** Points drawn from the `unregistered` bucket. */
  fromUnregistered: number;
  /** Points drawn from the `independent` bucket. */
  fromIndependent: number;
}

/**
 * Plan how a registration boost is sourced from a state's non-party pool.
 * Registration drives primarily activate non-voters, so draw from
 * `unregistered` first and fall back to `independent`. The applied amount is
 * bounded by the pool's total capacity so no bucket can go negative and the
 * 100% pool-sum invariant is preserved.
 */
export function planRegistrationDriveDraw(
  boost: number,
  poolUnregistered: number,
  poolIndependent: number
): RegistrationDriveDraw {
  const availableUnregistered = Math.max(0, poolUnregistered);
  const availableIndependent = Math.max(0, poolIndependent);
  const capacity = availableUnregistered + availableIndependent;
  const applied = Math.max(0, Math.min(boost, capacity));
  const fromUnregistered = Math.min(applied, availableUnregistered);
  const fromIndependent = applied - fromUnregistered;
  return { applied, fromUnregistered, fromIndependent };
}
