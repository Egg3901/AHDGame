/**
 * Major / Minor party tier system (D5, 2026-06-18).
 *
 * A party's tier drives its national Political-Strength cap and a player-facing
 * badge. Custom parties start Minor; default parties are seeded per country/era.
 * Tier is purely Org-footprint-driven (offices do not factor in):
 *
 *  - **Minor** cap = `clamp(BASE, nationalCap, BASE + PER_REGION × earnedRegions)`.
 *    A region is *earned* (+10 cap) at ≥ EARN% Org and *lost* only when Org drops
 *    below LOSE% (hysteresis — sticky in the LOSE–EARN band).
 *  - **Major** cap = the standard national cap (`nationalCapForCountry`).
 *
 *  - **Graduation** Minor → Major: ≥ EARN% Org in ≥ ⌈regions/3⌉ regions.
 *  - **Demotion** Major → Minor: < LOSE% Org in ≥ ⌈2·regions/3⌉ regions opens a
 *    `MAJOR_DEMOTION_GRACE_TURNS` warning countdown, cancelled only by regaining
 *    the graduation condition; on expiry the party is demoted and its Minor cap
 *    recomputed.
 *
 * Pure functions only — no DB. The turn phase resolves the Org-by-region input
 * and persists the results.
 */

export type PartyTier = "major" | "minor";

/**
 * Read-time tier resolver with a fallback for legacy rows whose `tier` hasn't
 * been seeded/healed yet: default parties → `major` (matches the pre-tier "Major
 * Party" badge), custom parties → `minor`. Once seeding (7c) + heal (7e) run,
 * the stored `tier` is authoritative and the fallback never applies.
 */
export function resolvePartyTier(party: { tier?: PartyTier; isDefault?: boolean }): PartyTier {
  if (party.tier === "major" || party.tier === "minor") return party.tier;
  return party.isDefault ? "major" : "minor";
}

// ─── Tunable constants ───────────────────────────────────────────────────────

/** Minor-party base national PS cap (custom parties start here). */
export const MINOR_PARTY_BASE_PS_CAP = 100 as const;
/** Extra Minor-party PS cap per region held at ≥ EARN% Org. */
export const MINOR_PARTY_PS_CAP_PER_REGION = 10 as const;
/** Org% at or above which a region is "earned" (counts for cap + graduation). */
export const TIER_EARN_REGION_ORG_PCT = 20 as const;
/** Org% below which an earned region is lost (hysteresis floor). */
export const TIER_LOSE_REGION_ORG_PCT = 10 as const;
/** Fraction of a country's regions that must be earned to graduate to Major. */
export const TIER_GRADUATION_REGION_FRACTION = 1 / 3;
/** Fraction of regions that must be below LOSE% to trigger the demotion warning. */
export const TIER_DEMOTION_REGION_FRACTION = 2 / 3;
/** Turns a Major party may sit at-risk before demotion (240 = locked default). */
export const MAJOR_DEMOTION_GRACE_TURNS = 240 as const;

// ─── Thresholds ──────────────────────────────────────────────────────────────

/** Regions at ≥ EARN% needed to graduate (⌈regions/3⌉). */
export function graduationThreshold(regionCount: number): number {
  return Math.ceil(regionCount * TIER_GRADUATION_REGION_FRACTION);
}

/** Regions below LOSE% needed to open the demotion warning (⌈2·regions/3⌉). */
export function demotionThreshold(regionCount: number): number {
  return Math.ceil(regionCount * TIER_DEMOTION_REGION_FRACTION);
}

// ─── Earned regions (hysteresis) ─────────────────────────────────────────────

/**
 * Recompute the set of "earned" regions from the previous set and the current
 * per-region Org. A region is added at ≥ EARN%; an already-earned region is kept
 * while ≥ LOSE% (sticky band) and dropped below LOSE% or when it has no Org entry
 * at all (presence lost). Returns a sorted, de-duplicated array (deterministic).
 */
export function updateEarnedRegions(
  prevEarned: Iterable<string>,
  orgByRegion: Map<string, number>
): string[] {
  const prev = new Set(prevEarned);
  const next = new Set<string>();
  for (const [region, org] of orgByRegion) {
    if (org >= TIER_EARN_REGION_ORG_PCT) {
      next.add(region);
    } else if (prev.has(region) && org >= TIER_LOSE_REGION_ORG_PCT) {
      next.add(region); // sticky LOSE–EARN band
    }
  }
  return [...next].sort();
}

// ─── Cap resolution ──────────────────────────────────────────────────────────

/** Minor-party cap: base + per-region, clamped to the national cap. */
export function minorPartyPsCap(earnedRegionCount: number, nationalCap: number): number {
  const raw =
    MINOR_PARTY_BASE_PS_CAP + MINOR_PARTY_PS_CAP_PER_REGION * Math.max(0, earnedRegionCount);
  return Math.min(nationalCap, raw);
}

/** National PS cap for a party given its tier + earned-region count. */
export function resolvePartyPsCap(
  tier: PartyTier,
  earnedRegionCount: number,
  nationalCap: number
): number {
  return tier === "major" ? nationalCap : minorPartyPsCap(earnedRegionCount, nationalCap);
}

// ─── Tier transitions ────────────────────────────────────────────────────────

export interface TierTransitionInput {
  currentTier: PartyTier;
  /** This party's Org% keyed by region id. Absent regions are treated as 0%. */
  orgByRegion: Map<string, number>;
  /** Total regions in the country (denominator for the fraction thresholds). */
  regionCount: number;
  /** Existing demotion-warning start turn, or null when not at-risk. */
  warningStartedTurn: number | null;
  currentTurn: number;
  /** Override the grace period (defaults to MAJOR_DEMOTION_GRACE_TURNS). */
  graceTurns?: number;
  /**
   * When true, the party is pinned Major and never warned/demoted — used for
   * one-party-state ruling parties (`regimeStatus === "ruling"`), where demoting
   * the sole governing party is nonsensical.
   */
  exemptFromDemotion?: boolean;
}

export interface TierTransitionResult {
  tier: PartyTier;
  /** null = no active warning. */
  warningStartedTurn: number | null;
  /** True when the tier flipped this evaluation. */
  changed: boolean;
  reason: "graduated" | "demoted" | "warning-started" | "warning-cleared" | "none";
}

export function resolveTierTransition(input: TierTransitionInput): TierTransitionResult {
  const grace = input.graceTurns ?? MAJOR_DEMOTION_GRACE_TURNS;

  // OPS ruling parties are pinned Major — never warned or demoted.
  if (input.exemptFromDemotion) {
    return {
      tier: "major",
      warningStartedTurn: null,
      changed: input.currentTier !== "major",
      reason:
        input.currentTier !== "major"
          ? "graduated"
          : input.warningStartedTurn != null
            ? "warning-cleared"
            : "none",
    };
  }

  let atEarn = 0;
  let atLose = 0;
  for (const org of input.orgByRegion.values()) {
    if (org >= TIER_EARN_REGION_ORG_PCT) atEarn++;
    if (org >= TIER_LOSE_REGION_ORG_PCT) atLose++;
  }
  const meetsGraduation = atEarn >= graduationThreshold(input.regionCount);
  // Regions below LOSE% includes those with no Org entry at all (→ 0%).
  const belowLose = input.regionCount - atLose;
  const atRisk = belowLose >= demotionThreshold(input.regionCount);

  if (input.currentTier === "minor") {
    if (meetsGraduation) {
      return { tier: "major", warningStartedTurn: null, changed: true, reason: "graduated" };
    }
    return { tier: "minor", warningStartedTurn: null, changed: false, reason: "none" };
  }

  // Major party.
  if (meetsGraduation) {
    // Healthy / recovered — clear any pending warning.
    return {
      tier: "major",
      warningStartedTurn: null,
      changed: false,
      reason: input.warningStartedTurn != null ? "warning-cleared" : "none",
    };
  }

  // Not meeting graduation. A warning runs once opened (by an at-risk reading)
  // and is only cancelled by regaining graduation (handled above) — per the
  // locked rule, climbing out of the at-risk band alone does NOT cancel it.
  const warningActive = input.warningStartedTurn != null;
  if (atRisk && !warningActive) {
    return {
      tier: "major",
      warningStartedTurn: input.currentTurn,
      changed: false,
      reason: "warning-started",
    };
  }
  if (warningActive) {
    if (input.currentTurn - (input.warningStartedTurn as number) >= grace) {
      return { tier: "minor", warningStartedTurn: null, changed: true, reason: "demoted" };
    }
    return {
      tier: "major",
      warningStartedTurn: input.warningStartedTurn,
      changed: false,
      reason: "none",
    };
  }
  // Below graduation but not at-risk and no warning → stays Major (grandfathered).
  return { tier: "major", warningStartedTurn: null, changed: false, reason: "none" };
}
