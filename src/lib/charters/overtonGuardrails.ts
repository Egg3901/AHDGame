/**
 * Overton-window guardrails for Phase 6 party charters.
 *
 * Per Phase 6 D2, each platform axis is bounded to `[-60, +60]`.
 * The `AMENDMENT_MAX_DELTA_PER_AXIS` constant + `validateAmendmentDeltas`
 * helper were retired in the 2026-05-22 amendments-via-CommitteeProposal
 * redesign — post-ratification platform changes now flow through
 * `CommitteeProposal.positionShift` (±1 per proposal, per-axis 336-turn
 * cooldown), so the ±10/axis guardrail is no longer relevant.
 *
 * See `docs/plans/archive/2026-05/2026-05-22-amendments-via-committee-proposals.md`.
 */

import type { PartyCharterPlatform } from "@/lib/db/types";

/** Lower bound for any platform axis. */
export const PLATFORM_AXIS_MIN = -60 as const;
/** Upper bound for any platform axis. */
export const PLATFORM_AXIS_MAX = 60 as const;

/**
 * Clamp a single axis to the Overton bounds defensively. Used at draft-
 * creation time so even a pathological client can't slide past `±60`.
 */
export function clampPlatformAxis(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.max(PLATFORM_AXIS_MIN, Math.min(PLATFORM_AXIS_MAX, value));
}

/** Apply `clampPlatformAxis` to every axis on a platform. */
export function clampPlatform(platform: PartyCharterPlatform): PartyCharterPlatform {
  return {
    economic: clampPlatformAxis(platform.economic),
    social: clampPlatformAxis(platform.social),
  };
}
