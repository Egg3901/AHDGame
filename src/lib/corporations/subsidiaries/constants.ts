/**
 * Subsidiary-corporations constants (feature-gated).
 *
 * Turn scale: 1 turn ≈ 1 real hour (hourly cron), 48 turns = 1 game year.
 */

/**
 * Voting-power threshold a parent must exceed to formalize / manage a subsidiary.
 * Must stay in sync with SUBSIDIARY_OWNERSHIP_THRESHOLD_PERCENT in
 * corporateOwnership.ts (both express "> this % of VOTING power").
 */
export const SUBSIDIARY_FORMALIZATION_THRESHOLD_PERCENT = 50;

/** Anti-flip-flap: min turns between formalize and release (≈1 real day). */
export const SUBSIDIARY_MIN_AGE_TURNS = 24;

/** One capital injection ≤ 25% of parent liquid capital. */
export const SUBSIDIARY_CAPITAL_INJECTION_MAX_PCT_OF_PARENT_LIQUID = 0.25;
/** Per-subsidiary cooldown between capital injections (≈1 real day). */
export const SUBSIDIARY_CAPITAL_INJECTION_COOLDOWN_TURNS = 24;

/** Spin-off cooldown per parent (≈7 real days). */
export const SPIN_OFF_COOLDOWN_TURNS = 168;
/** Spin-off modest fixed cost in ₳ (anchor units). */
export const SPIN_OFF_BASE_COST_ANCHOR = 500_000;
/**
 * Spin-off additional per-sector transfer fee in ₳, charged for each
 * sector of the chosen type moved into the new corp. Total cost is
 * SPIN_OFF_BASE_COST_ANCHOR + SPIN_OFF_PER_SECTOR_COST_ANCHOR × (# sectors moved).
 */
export const SPIN_OFF_PER_SECTOR_COST_ANCHOR = 100_000;

/** Total spin-off cost in ₳ for moving `sectorCount` sectors. */
export function spinOffCostAnchor(sectorCount: number): number {
  return SPIN_OFF_BASE_COST_ANCHOR + SPIN_OFF_PER_SECTOR_COST_ANCHOR * Math.max(0, sectorCount);
}

// Synergy constants intentionally omitted (deferred, separate flag).
