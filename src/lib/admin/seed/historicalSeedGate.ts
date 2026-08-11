/**
 * The gate that decides whether a bootstrap run seeds the preset's AUTHORED
 * historical officeholder roster (`seedHistoricalOfficials` → `getPresetSeats`).
 *
 * Extracted from `bootstrapGameWorld` so the decision is unit-testable without
 * a live MongoDB, because it silently ate every authored legislature.
 *
 * The bug it exists to prevent
 * ---------------------------
 * The gate's INTENT is "only seat the historical world when the world is
 * genuinely empty — never double-seat on top of an existing population". Its
 * original implementation asked that question with counts taken *in the middle
 * of the bootstrap*:
 *
 *     const [officialsCount, nppsCount] = await Promise.all([
 *       db.collection("electedOfficials").countDocuments(),
 *       db.collection("npps").countDocuments({ retiredAt: null }),
 *     ]);
 *     ...
 *     } else if (preIteration || (officialsCount === 0 && nppsCount === 0)) {
 *
 * By that point `seedNGGovernors` (a few steps earlier in the same bootstrap)
 * has ALWAYS inserted Nigerian governor officials + NPPs, so both counts are
 * non-zero on a genuinely fresh world and the gate falls to the skip branch
 * every time. Consequence: on the full bootstrap path `getPresetSeats` never
 * ran, so every authored chamber — most visibly the US 83rd Congress under
 * `1953-default` (House 213 D / 221 R / 1 I, Senate 47 D / 48 R / 1 I) — was
 * never seated. Chambers then came up empty and, in the headless sim, were
 * filled by `backfillMissingSeats` weighting seats by statePartyOrg
 * organization × registration: a 1953 US with Solid-South registration
 * produced a fabricated 343 D / 92 R House and an 81 D / 15 R Senate, i.e. the
 * exact inverse of the historical result.
 *
 * The fix is to ask the question with counts snapshotted BEFORE any seeder in
 * this run has written, which is what `preExistingOfficials` /
 * `preExistingNpps` mean. Re-running the seed itself is safe regardless:
 * `seedHistoricalOfficials` passes `skipAlreadySeatedChambers`, so an
 * already-seated (countryId, officeType) chamber converges instead of
 * appending a second parallel roster.
 */

import type { BootstrapMode } from "@/lib/admin/bootstrapGameWorld";

export type HistoricalSeedGateInput = {
  /** `"vacant"` worlds get `initializeOfficials` instead — never the roster. */
  mode: BootstrapMode;
  /**
   * Pre-iteration founding reset. Always seeds, in `"priors"` mode: that only
   * creates the unseated candidate pool (no `electedOfficials`), so there is no
   * double-seat risk even when country seeders already ran.
   */
  preIteration: boolean;
  /**
   * `electedOfficials` count captured BEFORE any seeder in this bootstrap run.
   * Must NOT be re-read mid-run — that is the bug documented above.
   */
  preExistingOfficials: number;
  /** Live (`retiredAt: null`) `npps` count captured before any seeder ran. */
  preExistingNpps: number;
};

export function shouldSeedHistoricalOfficials(input: HistoricalSeedGateInput): boolean {
  if (input.mode === "vacant") return false;
  if (input.preIteration) return true;
  return input.preExistingOfficials === 0 && input.preExistingNpps === 0;
}
