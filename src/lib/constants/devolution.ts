/**
 * UK Devolution Policy + Independence/Reunification Desire constants.
 *
 * Centralises the tunables for the UK First Minister's Devolution tab so
 * the engine drift processor, the UI breakdown, and the policy-change API
 * route all read from one source of truth. See
 * `docs/design/uk-devolution-policy.md` for the design rationale.
 */

import type { DevolutionPolicy } from "@/lib/db/types/governorOfficeState";

// ─── Region eligibility ───────────────────────────────────────────────────────

/** UK regions whose First Minister has a Devolution Policy. LON is excluded
 *  — the Mayor of London has no devolution axis. */
export const UK_DEVOLUTION_REGIONS: ReadonlySet<string> = new Set(["SCO", "WAL", "NIR"]);

/**
 * Metrics owned EXCLUSIVELY by a dedicated per-turn drift engine. The generic
 * per-turn writers (metric engine, policy-effects decay) iterate metric
 * DEFINITIONS, so a field that stays registered in `metricDefinitions` for
 * display/scoring would otherwise be co-written every turn and fight the drift
 * engine to a standstill. Those writers must skip anything listed here.
 *
 * Keyed as `${categoryId}.${metricId}`.
 *
 * - `governance.independenceDesire` → owned by
 *   `src/lib/turn/independenceDesireDrift.ts`. (The metric-engine node was
 *   removed in the first ownership fix; this set closes the policy-effects
 *   second writer — see docs/design/uk-independence-desire-ownership-fix.md.)
 */
export const DRIFT_OWNED_METRICS: ReadonlySet<string> = new Set(["governance.independenceDesire"]);

export function isUKDevolutionRegion(stateId: string): boolean {
  return UK_DEVOLUTION_REGIONS.has(stateId.toUpperCase());
}

// ─── Policy-change cost + cooldown ───────────────────────────────────────────

/** Office AP cost to change Devolution Policy. */
export const DEVOLUTION_POLICY_CHANGE_AP_COST = 2;

/** Turns the FM must wait between Devolution Policy changes (1.5 game years
 *  at 48 turns/year - gives a meaningful "you committed to this" beat). */
export const DEVOLUTION_POLICY_CHANGE_COOLDOWN_TURNS = 72;

// ─── Per-turn drift drivers ──────────────────────────────────────────────────

// Compatibility exports keep UI and existing callers on the portable rules.
export {
  DEVOLUTION_POLICY_DRIFT,
  DEVOLUTION_POLICY_APPROVAL_DIRECTION,
  APPROVAL_DRIFT_PER_POINT,
  APPROVAL_DRIFT_CAP,
  regionalApprovalDrift,
  nationalApprovalDrift,
  inflationDrift,
  MEAN_REVERSION_TARGET,
  MEAN_REVERSION_RATE,
  meanReversionDrift,
} from "@/lib/governorOffice/devolution/rules";

// ─── First Minister high-desire election bonus ───────────────────────────────

/** Desire value (inclusive) at which the stepped vote-gain bonus first
 *  unlocks for a qualifying First Minister's party. */
export const HIGH_DESIRE_BONUS_THRESHOLD = 60;
/** Band width — desire must climb another full 10pp to unlock the next step. */
export const HIGH_DESIRE_BONUS_BAND_SIZE = 10;
/** Per-band multiplier increment. Bands: 60-69 → +1.5%, 70-79 → +3%,
 *  80-89 → +4.5%, 90-99 → +6%, 100 → +7.5%. */
export const HIGH_DESIRE_BONUS_PER_BAND = 0.015;
/** Cap on the band index (5 bands → max 4). desire=100 yields band 4. */
export const HIGH_DESIRE_BONUS_MAX_BAND = 4;
/** Total number of bands (including the threshold band). Equals MAX_BAND + 1.
 *  Exported so the UI tier strip stays consistent if the band count is
 *  retuned. */
export const HIGH_DESIRE_BONUS_TIER_COUNT = HIGH_DESIRE_BONUS_MAX_BAND + 1;

/**
 * Stepped vote-gain magnitude for qualifying SCO/WAL/NIR elections. The
 * portable election rule decides whether the current First Minister's party
 * qualifies based on the office's devolution policy.
 *
 * | Desire        | Bonus  |
 * | ------------- | ------ |
 * | < 60          | 0      |
 * | 60–69         | +1.5%  |
 * | 70–79         | +3.0%  |
 * | 80–89         | +4.5%  |
 * | 90–99         | +6.0%  |
 * | 100           | +7.5%  |
 *
 * Returns the multiplier as a decimal (e.g. 0.015 for +1.5%).
 */
export function highDesireElectionBonus(desire: number): number {
  if (!Number.isFinite(desire)) return 0;
  if (desire < HIGH_DESIRE_BONUS_THRESHOLD) return 0;
  const rawBand = Math.floor((desire - HIGH_DESIRE_BONUS_THRESHOLD) / HIGH_DESIRE_BONUS_BAND_SIZE);
  const band = Math.min(HIGH_DESIRE_BONUS_MAX_BAND, Math.max(0, rawBand));
  return (band + 1) * HIGH_DESIRE_BONUS_PER_BAND;
}

// ─── UI label resolution ─────────────────────────────────────────────────────

/**
 * Human-readable label for the metric in a given region. SCO/WAL render
 * "Independence Desire"; NIR renders "Reunification Desire". The stored
 * field is the same on both — only the display string differs.
 */
export function getIndependenceMetricLabel(stateId: string): string {
  return stateId.toUpperCase() === "NIR" ? "Reunification Desire" : "Independence Desire";
}

/**
 * Human-readable label for a Devolution Policy option in a given region.
 * NIR's `"independence"` reads "Irish Reunification"; everywhere else
 * uses "Independence". `"anti"` and `"pro"` are region-agnostic.
 */
export function getDevolutionPolicyLabel(stateId: string, policy: DevolutionPolicy): string {
  switch (policy) {
    case "anti":
      return "Anti-Devolution";
    case "pro":
      return "Pro-Devolution";
    case "independence":
      return stateId.toUpperCase() === "NIR" ? "Irish Reunification" : "Pro-Independence";
  }
}
