/**
 * Pure driver functions for the per-turn popularLegitimacy drift.
 *
 * Each driver takes typed inputs and returns a number in a documented
 * range. No DB access, no side effects — the integration layer
 * (`popularLegitimacyTurn.ts`) sums the components and applies the
 * delta via `adjustPopularLegitimacy`.
 *
 * The slow-buildup tuning principle from the design doc lives here:
 * normal-turn drift bounded to a fraction of a point per component,
 * worst-case totals around -4 (disaster turn), with a +0.2 always-on
 * natural-recovery target.
 *
 * See `docs/superpowers/specs/2026-05-28-one-party-state-collapse-design.md`
 * § "Scalar mechanics" for the drift table.
 */
import type { PopularMoodAxisProfile } from "@/lib/constants/popularMoodProfiles";
import { POPULAR_MOOD_AXES } from "@/lib/constants/popularMoodProfiles";
import { POPULAR_RECOVERY_RATE, POPULAR_RECOVERY_TARGET } from "./popularLegitimacy";
import { repressionLegitimacyCost } from "@/lib/economy/commandEconomyState";

// ── Input types ────────────────────────────────────────────────────────────

export interface EconomicSignals {
  /** Annualised real GDP growth in percent. Neutral ~ 2.5%. */
  gdpGrowthAnnualPct: number;
  /** Change in unemployment vs last turn, percentage points. Neutral = 0. */
  unemploymentDeltaPct: number;
  /** Inflation deviation from the country's target, percentage points. 0 = on target. */
  inflationDeviationFromTargetPct: number;
}

export type PurgeSeverity = "minor" | "moderate" | "major" | "extreme" | "faction";

export interface PurgeEventInput {
  severity: PurgeSeverity;
  /**
   * Category of purge. `"anticorruption"` is treated as a popular
   * *benefit* — gets the intra-party cost but not the popular-legitimacy
   * hit (Phase 5's reform-action menu uses this flag).
   */
  kind: "discipline" | "anticorruption" | "faction" | "ideological";
}

export interface EnactedBillInput {
  /**
   * Bag of axis deltas authored by the bill. Keys may include axes not in
   * the mood profile — those are ignored.
   */
  axisEffects: Record<string, number>;
}

export interface ElectionCredibilitySignals {
  isElectionTurn: boolean;
  /** Effective ruling-party vote multiplier applied this election cycle. */
  opsMultiplier: number;
}

// ── Drivers ────────────────────────────────────────────────────────────────

/**
 * Composite economic drift. Per the design table:
 *   GDP growth contribution:        −0.4..+0.4
 *   Unemployment delta contribution: −0.3..+0.1 (asymmetric — falling unemployment lifts less than rising hurts)
 *   Inflation deviation:             −0.3..0.0 (one-sided cost, magnitude of deviation)
 * Result range: −1.0..+0.5.
 */
export function economicHealthDrift(sig: EconomicSignals): number {
  // GDP: neutral anchor 2.5%; ±5 pct points → ±0.4 saturation.
  const gdpRaw = (sig.gdpGrowthAnnualPct - 2.5) / 12.5;
  const gdp = clamp(gdpRaw, -0.4, 0.4);

  // Unemployment delta: rising hurts more than falling helps.
  //   +5pp → -0.3; -3pp → +0.1.
  let unemp = 0;
  if (sig.unemploymentDeltaPct > 0) {
    unemp = -Math.min(0.3, sig.unemploymentDeltaPct * 0.06);
  } else {
    unemp = Math.min(0.1, -sig.unemploymentDeltaPct * (0.1 / 3));
  }

  // Inflation deviation: only-negative contribution (overshoot AND
  // undershoot both hurt — people notice prices moving either way).
  const inflMag = Math.abs(sig.inflationDeviationFromTargetPct);
  const infl = -Math.min(0.3, inflMag * 0.0375);

  return clamp(gdp + unemp + infl, -1.0, 0.5);
}

/**
 * Per-purge popular cost lookup. `anticorruption` is handled separately
 * (zero popular cost) so it doesn't appear in this table.
 */
const PURGE_POPULAR_COST: Record<PurgeSeverity, number> = {
  minor: -0.1,
  moderate: -0.3,
  major: -0.6,
  extreme: -1.0,
  faction: -0.8,
};

/**
 * Sum of per-purge popular cost. anticorruption-flagged purges are
 * excluded (treated as popular benefit elsewhere). Clamped at -1.5
 * so a single-turn purge-wave can't single-handedly destroy legitimacy.
 */
export function repressionIntensityDrift(purges: PurgeEventInput[]): number {
  let total = 0;
  for (const p of purges) {
    if (p.kind === "anticorruption") continue;
    total += PURGE_POPULAR_COST[p.severity];
  }
  return clamp(total, -1.5, 0);
}

export interface InternalRepressionSignals {
  /** 0 (none) … 1 (heavy) internal-repression lever the government is running. */
  internalRepression: number;
  /** 0..100 goods-shortage index (the still-present cause repression sits atop). */
  shortageIndex: number;
}

/**
 * Command-economy INTERNAL REPRESSION cost. Forcing the second economy down is
 * the hardliner's tool to resist reform, but it burns regime legitimacy, and the
 * cost climbs with BOTH how hard the state represses AND how severe the unfixed
 * shortage is (repressing amid empty shelves is a pressure cooker). Delegates to
 * the shared command-economy kernel so the dashboard readout and this legitimacy
 * hit are the SAME number. Returns a signed delta in [-1, 0]; zero when the
 * country isn't repressing or has no shortage. A no-op for market countries
 * (both signals default to 0).
 */
export function internalRepressionDrift(sig: InternalRepressionSignals | undefined | null): number {
  if (!sig) return 0;
  return repressionLegitimacyCost(sig.internalRepression, sig.shortageIndex);
}

/**
 * Score enacted bills against the country's popular-mood profile.
 * Each bill contributes Σ (profileWeight[axis] × billDelta[axis] × 0.2)
 * for axes the profile defines. Summed across bills then clamped to
 * ±0.8.
 *
 * The 0.2 scale: a single bill pushing 1.0 on every CN-weighted axis
 * yields a raw sum ≈ 4.6 × 0.2 ≈ 0.92, which the clamp pulls to +0.8.
 * Typical bills push 1-2 axes by 0.5, landing ≈ ±0.1 — well inside
 * the band, matching the slow-buildup target.
 */
export function policyPopularityDrift(
  bills: EnactedBillInput[],
  profile: PopularMoodAxisProfile
): number {
  let total = 0;
  for (const bill of bills) {
    for (const axis of POPULAR_MOOD_AXES) {
      const w = profile[axis];
      const d = bill.axisEffects[axis];
      if (typeof d !== "number") continue;
      total += w * d * 0.2;
    }
  }
  return clamp(total, -0.8, 0.8);
}

/**
 * One-shot election-fraud shock. Fires only on election turns where the
 * effective ruling-party vote multiplier exceeded 1.2 (the design's
 * "obviously fraudulent" threshold). Other turns: no contribution.
 */
export function electionCredibilityShock(sig: ElectionCredibilitySignals): number {
  if (!sig.isElectionTurn) return 0;
  if (sig.opsMultiplier <= 1.2) return 0;
  return -2.0;
}

/**
 * Small bleed from intra-party collapse into popular mood. Models
 * "the country can see the regime is fighting itself".
 *
 * Reverse direction (popular → party) is wired in Phase 3 via
 * `popularLegitimacyBleedIntoParty` on `rulingPartyPriorities.ts`.
 */
export function intraPartyCouplingBleed(partyConfidence: number): number {
  if (partyConfidence >= 30) return 0;
  // Must stay below POPULAR_RECOVERY_RATE (0.1), or the two coupling bleeds
  // form an inescapable death spiral once both scalars cross their
  // thresholds: at the old -0.3 the net popular drift was ~-0.15/turn with
  // popular pinned at 0 regardless of econ health, which is what ground CN
  // into the t1061 Stage 3 split (#3165).
  return -0.05;
}

/**
 * Always-on regression toward {@link POPULAR_RECOVERY_TARGET} at
 * {@link POPULAR_RECOVERY_RATE}. Negative when above target, positive
 * when below. Caps the natural death-spiral and rewards stability.
 */
export function naturalRecoveryDrift(current: number): number {
  if (current === POPULAR_RECOVERY_TARGET) return 0;
  return current < POPULAR_RECOVERY_TARGET ? POPULAR_RECOVERY_RATE : -POPULAR_RECOVERY_RATE;
}

// ── Internal ────────────────────────────────────────────────────────────────

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
