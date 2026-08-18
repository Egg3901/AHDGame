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

/**
 * Drift contribution per turn from the FM's Devolution Policy choice.
 * Calibrated so a max-positive run (Pro-Indy FM + low regional approval +
 * low PM approval + high inflation) saturates from neutral ~50 to ~95 in
 * roughly two full FM terms (~8 game-years / 384 turns). Independence
 * is meant to be the work of years, not months.
 */
export const DEVOLUTION_POLICY_DRIFT: Record<DevolutionPolicy, number> = {
  anti: -0.04,
  pro: 0,
  independence: 0.05,
};

/**
 * Direction the seated FM's devolved-government approval pulls separation
 * desire, by their devolution policy. Approval is a *mandate* for the FM's
 * stance: a popular unionist FM pulls toward the union (−1), a popular
 * pro-independence FM toward separation (+1); Pro-Devolution is neutral on the
 * national question (0). Used by {@link regionalApprovalDrift}.
 */
export const DEVOLUTION_POLICY_APPROVAL_DIRECTION: Record<DevolutionPolicy, number> = {
  anti: -1,
  pro: 0,
  independence: 1,
};

/** Drift contribution per full percentage point of approval distance from 50.
 *  Below 50 → positive (grievance); above 50 → negative (suppression). */
export const APPROVAL_DRIFT_PER_POINT = 0.001;

/**
 * Linear drift from an approval rating. At 50 the contribution is zero;
 * below 50 it climbs at `APPROVAL_DRIFT_PER_POINT` per full percentage point;
 * above 50 it falls at the same rate. Fractional points are truncated toward
 * zero (48.1 acts as 49), so the driver only ticks up at integer crossings.
 * Unbounded — at 0%/100% the driver hits ±0.050/turn.
 */
function linearApprovalDrift(approval: number): number {
  const distance = Math.floor(Math.abs(approval - 50));
  if (distance === 0) return 0; // avoid signed-zero (−0) when approval ≥ 50 but < 51
  const sign = approval < 50 ? 1 : -1;
  return sign * distance * APPROVAL_DRIFT_PER_POINT;
}

/**
 * Drift from the FM's devolved-government approval, DIRECTIONAL by their
 * devolution policy. The magnitude is the same distance-from-50 ramp as the
 * grievance model, but the SIGN comes from a mandate read × the policy's stance:
 *   - approval ≥ 50 → a mandate (+); below 50 → a rejection (−)
 *   - policy stance: anti −1, pro 0, independence +1
 * So a popular pro-independence FM raises desire, a popular unionist FM lowers
 * it, an unpopular separatist FM lowers it (failing the cause), and an unpopular
 * unionist FM raises it (backlash). Pro-Devolution never moves it.
 */
export function regionalApprovalDrift(approval: number, policy: DevolutionPolicy): number {
  const direction = DEVOLUTION_POLICY_APPROVAL_DIRECTION[policy];
  if (direction === 0) return 0; // Pro-Devolution: neutral on the national question
  const distance = Math.floor(Math.abs(approval - 50));
  if (distance === 0) return 0; // avoid signed-zero at exactly 50
  const mandateSign = approval >= 50 ? 1 : -1;
  return mandateSign * distance * APPROVAL_DRIFT_PER_POINT * direction;
}

/** Drift from national (Westminster) approval — same shape as regional;
 *  an unpopular UK PM fuels regional discontent regardless of who's FM. */
export function nationalApprovalDrift(approval: number): number {
  return linearApprovalDrift(approval);
}

/** Drift from national inflation rate (annualised percent). High inflation
 *  read as Westminster economic mismanagement → push toward independence. */
export function inflationDrift(inflationPercent: number): number {
  if (inflationPercent > 5) return 0.02;
  if (inflationPercent >= 2) return 0;
  return -0.01;
}

/** Slow mean-reversion toward the long-run baseline. Pulls toward 25 (status-
 *  quo unionism / partition acceptance) rather than the mathematical midpoint
 *  of 50 — without sustained pro-indy drivers, sentiment defaults to the
 *  established settlement. Rate is intentionally small so the drift is only
 *  the floor pull, not a fast unwind. */
export const MEAN_REVERSION_TARGET = 25;
export const MEAN_REVERSION_RATE = 0.003;
export function meanReversionDrift(current: number): number {
  if (current > MEAN_REVERSION_TARGET) return -MEAN_REVERSION_RATE;
  if (current < MEAN_REVERSION_TARGET) return MEAN_REVERSION_RATE;
  return 0;
}

// ─── Pro-independence high-desire election bonus ─────────────────────────────

/** Desire value (inclusive) at which the stepped vote-gain bonus first
 *  unlocks for the region's pro-independence party. */
export const PRO_INDY_BONUS_THRESHOLD = 60;
/** Band width — desire must climb another full 10pp to unlock the next step. */
export const PRO_INDY_BONUS_BAND_SIZE = 10;
/** Per-band multiplier increment. Bands: 60-69 → +1.5%, 70-79 → +3%,
 *  80-89 → +4.5%, 90-99 → +6%, 100 → +7.5%. */
export const PRO_INDY_BONUS_PER_BAND = 0.015;
/** Cap on the band index (5 bands → max 4). desire=100 yields band 4. */
export const PRO_INDY_BONUS_MAX_BAND = 4;
/** Total number of bands (including the threshold band). Equals MAX_BAND + 1.
 *  Exported so the UI tier strip stays consistent if the band count is
 *  retuned. */
export const PRO_INDY_BONUS_TIER_COUNT = PRO_INDY_BONUS_MAX_BAND + 1;

/**
 * Stepped vote-gain bonus for the region's pro-independence party in
 * SCO/WAL/NIR general elections. Layered ON TOP of the soft electoral
 * transfer (which redistributes votes between parties) — this one is a
 * pure additive boost to the pro-indy party only, no rival penalty.
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
export function proIndyHighDesireBonus(desire: number): number {
  if (!Number.isFinite(desire)) return 0;
  if (desire < PRO_INDY_BONUS_THRESHOLD) return 0;
  const rawBand = Math.floor((desire - PRO_INDY_BONUS_THRESHOLD) / PRO_INDY_BONUS_BAND_SIZE);
  const band = Math.min(PRO_INDY_BONUS_MAX_BAND, Math.max(0, rawBand));
  return (band + 1) * PRO_INDY_BONUS_PER_BAND;
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
