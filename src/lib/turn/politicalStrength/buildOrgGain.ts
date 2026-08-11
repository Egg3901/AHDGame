import {
  BUILD_ORG_BASE_GAIN,
  BUILD_ORG_CATCHUP_BONUS,
  BUILD_ORG_DIMINISHING_PIVOT,
  BUILD_ORG_DIMINISHING_THRESHOLD,
  BUILD_ORG_PS_EFFECTIVE_CEILING,
  BUILD_ORG_PS_LEVERAGE_CEILING,
  BUILD_ORG_PS_LEVERAGE_FLOOR,
  CONTEST_LOW_ORG_TAPER,
  POACH_ORG_SHARE_WEIGHT,
  RIVAL_POACH_HEADROOM_WEIGHT,
} from "./strengthConstants";

/**
 * Unified Build Org gain model (2026-06-24 spec). A single action grows the
 * spender's Org% in a state by drawing from the Unaffiliated pool AND poaching
 * rivals at once — replacing the old separate Build Org + Contest actions.
 *
 *   gain = BASE × throttle × ownDiminishing × effectiveLeverage
 *
 * where effectiveLeverage = clamp(FLOOR, EFFECTIVE_CEILING, rawLeverage + catchupAddend).
 * Catchup is additive (not multiplicative) so a trailing party at the PS floor
 * (0.5) reaches neutral (1.0) rather than the old penalised 0.5 × 1.5 = 0.75.
 *
 * sourced from two reservoirs, apportioned by weight:
 *  - **pool** — the unaffiliated share (`100 − Σ party Org`).
 *  - **rivals** — each rival's poachable Org, sized by a blend of the rival's
 *    Org size and the spender's PS advantage over it (× low-Org taper × defense
 *    shield). The dominant rival is always a target by virtue of its share even
 *    at PS parity — no rival is fully immune just by out-reserving the spender.
 *
 * Carve invariant: `throttle = max(poolWeight, rivalWeight)` (not the sum), so
 * in an open state the total matches the legacy pool-only Build, while a
 * saturated state still yields gain by poaching. Org is conserved — the spender
 * gains exactly what the pool + rivals lose.
 */

/** A rival party's state-level Org + PS, plus an optional defense shield. */
export interface RivalState {
  partyId: string;
  /** Rival's current Org% in this state (0–100). */
  orgPct: number;
  /** Rival's current PS reserve (state pool). */
  ps: number;
  /**
   * Defense multiplier on what can be poached from this rival. `0.5` for an
   * abandoned default-party stronghold (unmanned shield), else `1`. Defaults to
   * `1` when omitted.
   */
  shield?: number;
}

/** Per-rival poach outcome from a single unified Build Org click. */
export interface RivalPoach {
  partyId: string;
  /** Org% removed from this rival (≥ 0, ≤ the rival's current Org). */
  loss: number;
  /** Pre-apportionment poachable weight (Org × psAdvantage × lowOrgDamp × shield). */
  poachable: number;
}

export interface UnifiedBuildOrgInput {
  /** Spender's current Org% in this state. */
  ownOrgPct: number;
  /** Spender's current PS reserve. */
  ownPS: number;
  /** Sum of all party Org% in this state (incl. the spender). */
  totalPartyOrgPct: number;
  /** Highest rival Org% in this state (catch-up factor). */
  rivalLeadOrgPct: number;
  /** Average PS across rivals present with PS > 0. `0` ⇒ leverage neutral. */
  avgRivalPS: number;
  /** Every rival party present in this state with Org > 0. */
  rivals: RivalState[];
}

export interface UnifiedBuildOrgBreakdown {
  /** Spender's total Org% gain this click = poolGain + Σ rivalPoaches.loss. */
  totalGain: number;
  /** Org% drawn from the Unaffiliated pool (≤ pool availability). */
  poolGain: number;
  /** Per-rival poach outcomes (same order as input rivals; rivals exposing 0 Org included with loss 0). */
  rivalPoaches: RivalPoach[];
  factors: {
    base: number;
    /** Pool weight (unaffiliated share) — surfaced as the "Open pool" factor. */
    headroom: number;
    ownDiminishing: number;
    psLeverage: number;
    catchup: number;
  };
}

/**
 * Unified Build Org gain — draws from the Unaffiliated pool AND poaches rivals
 * in one click (2026-06-24 spec). Carve model: the total gain uses
 * `throttle = max(poolWeight, rivalWeight)` so in an open state it equals the
 * legacy pool-only Build, while a saturated state still yields gain by poaching.
 * The gain is apportioned across the pool and each rival by their weight; each
 * rival's loss is sized by a blend of the rival's Org size and the spender's PS
 * advantage over it (× low-Org taper × defense shield), so the dominant rival is
 * a primary target even at PS parity.
 *
 * Pure function — no DB. `priorityBonus` is applied by the caller. Org is
 * conserved: `totalGain === poolGain + Σ rivalPoaches.loss`.
 */
export function calcUnifiedBuildOrg(input: UnifiedBuildOrgInput): UnifiedBuildOrgBreakdown {
  const ownOrg = Math.max(0, input.ownOrgPct);
  const effectiveOrg = Math.max(0, ownOrg - BUILD_ORG_DIMINISHING_THRESHOLD);
  const ownDiminishing = BUILD_ORG_DIMINISHING_PIVOT / (BUILD_ORG_DIMINISHING_PIVOT + effectiveOrg);

  const rawLeverage =
    input.avgRivalPS > 0
      ? Math.max(
          BUILD_ORG_PS_LEVERAGE_FLOOR,
          Math.min(BUILD_ORG_PS_LEVERAGE_CEILING, input.ownPS / input.avgRivalPS)
        )
      : 1;

  // Additive catchup (2026-06-28): catchupAddend is added to rawLeverage,
  // not multiplied. This ensures a trailing party at the PS floor (0.5) reaches
  // neutral (0.5+0.5=1.0) rather than the old penalised 0.5×1.5=0.75.
  const catchupAddend = input.rivalLeadOrgPct > input.ownOrgPct ? BUILD_ORG_CATCHUP_BONUS : 0;
  const effectiveLeverage = Math.min(BUILD_ORG_PS_EFFECTIVE_CEILING, rawLeverage + catchupAddend);

  const poolAvailablePct = Math.max(0, 100 - input.totalPartyOrgPct);
  const poolWeight = poolAvailablePct / 100;

  // Per-rival poachable Org (% points): how much each rival exposes. The exposed
  // fraction blends the rival's Org SIZE with the spender's PS advantage
  // (2026-06-25) so the dominant party is a primary target by virtue of its share
  // even at PS parity, instead of being immune whenever its PS ≥ the spender's:
  //   exposure = W·orgIntensity + (1 − W)·psAdvantage,  orgIntensity = org / leadOrg.
  const leadRivalOrg = Math.max(0, input.rivalLeadOrgPct);
  const poachables = input.rivals.map((r) => {
    const rivalOrg = Math.max(0, r.orgPct);
    const psAdvantage =
      input.ownPS > 0 ? Math.max(0, Math.min(1, (input.ownPS - r.ps) / input.ownPS)) : 0;
    const orgIntensity = leadRivalOrg > 0 ? Math.min(1, rivalOrg / leadRivalOrg) : 0;
    const exposure =
      POACH_ORG_SHARE_WEIGHT * orgIntensity + (1 - POACH_ORG_SHARE_WEIGHT) * psAdvantage;
    const lowOrgDamp = Math.max(0, Math.min(1, rivalOrg / CONTEST_LOW_ORG_TAPER));
    const shield = r.shield ?? 1;
    return {
      partyId: r.partyId,
      rivalOrg,
      poachable: rivalOrg * exposure * lowOrgDamp * shield,
    };
  });

  const sumPoachable = poachables.reduce((s, p) => s + p.poachable, 0);
  const rivalWeight = (sumPoachable / 100) * RIVAL_POACH_HEADROOM_WEIGHT;
  const throttle = Math.max(poolWeight, rivalWeight);
  const denom = poolWeight + rivalWeight;

  const factors = {
    base: BUILD_ORG_BASE_GAIN,
    headroom: poolWeight,
    ownDiminishing,
    // psLeverage = raw PS ratio (before catchup), for UI display.
    // catchup = addend (0 or 0.5); effectiveLeverage = psLeverage + catchup.
    psLeverage: rawLeverage,
    catchup: catchupAddend,
  };

  // Nothing to take (empty pool AND no poachable rival) ⇒ zero gain.
  if (denom <= 0 || throttle <= 0) {
    return {
      totalGain: 0,
      poolGain: 0,
      rivalPoaches: poachables.map((p) => ({
        partyId: p.partyId,
        loss: 0,
        poachable: p.poachable,
      })),
      factors,
    };
  }

  const grossGain = BUILD_ORG_BASE_GAIN * throttle * ownDiminishing * effectiveLeverage;

  // Apportion the gain across the pool and each rival by weight. Clamp the pool
  // slice at the pool's availability and each rival slice at its current Org.
  const poolGain = Math.max(0, Math.min(grossGain * (poolWeight / denom), poolAvailablePct));

  const rivalPoaches: RivalPoach[] = poachables.map((p) => {
    const share = (p.poachable / 100) * RIVAL_POACH_HEADROOM_WEIGHT;
    const rawLoss = grossGain * (share / denom);
    const loss = Math.max(0, Math.min(rawLoss, p.rivalOrg));
    return { partyId: p.partyId, loss, poachable: p.poachable };
  });

  const totalGain = poolGain + rivalPoaches.reduce((s, p) => s + p.loss, 0);

  return { totalGain, poolGain, rivalPoaches, factors };
}
