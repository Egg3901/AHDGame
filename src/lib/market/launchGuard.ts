import type { Db } from "mongodb";
import type { GameConfig } from "@/lib/db/types/gameConfig";
import { createAdminLog } from "@/lib/adminLog";
import { isMarketSystemMode, marketAtLeast } from "@/lib/market/featureFlag";
import type { MarketSystemMode } from "@/lib/market/modes";

/**
 * Launch guard — automated kill switch for the clearing/capital flip.
 *
 * The clearing/capital revenue legs are already bounded and ramped (see the
 * governor in capital.ts), but the launch is a live experiment on the real
 * economy. This guard turns "flip and watch" into "flip with a floor": each
 * turn it compares aggregate market cap to a reference stamped at the flip and,
 * if the drop exceeds a configured threshold, reverts marketSystemMode ONE TIER
 * DOWN so no human has to be watching. Opt-in (marketGuardEnabled) and only
 * armed while the mode is at or above `clearing`.
 */

export const DEFAULT_GUARD_DROP_PCT = 0.25;
/** Grace window (turns) after the flip before the guard can trip — the ramp
 *  needs a few turns of signal before a drop is meaningful. */
export const DEFAULT_GUARD_GRACE_TURNS = 5;
/** Minimum share of aggregate mcap that must carry a fundamental valuation
 *  before we trust the fundamentals-relative comparison. Below this we fall
 *  back to the raw drawdown so partial data can never silently disarm us. */
export const FUNDAMENTAL_COVERAGE_FLOOR = 0.8;

/**
 * Where the guard reverts to from `mode`.
 *
 * NOT a fixed "ledger": from `plants` that is a TWO-tier drop, and it lands on a
 * tier with no growth mechanism at all — capacity-derived revenue is gone and
 * the compounding nameplate it replaced is not coming back, so the economy would
 * sit flat until a human noticed. `capital` is the nearest tier below plants
 * that still has one (the growth slider is investment, capacity builds), so a
 * plants trip degrades to a working economy rather than a stalled one.
 *
 * clearing/capital keep the historical `ledger` target: ledger is
 * observability-only and never changes balance, which is the correct floor for
 * the tiers whose revenue legs it was originally built to catch.
 */
export function guardRevertTarget(mode: MarketSystemMode): MarketSystemMode {
  return mode === "plants" ? "capital" : "ledger";
}

export interface GuardDecision {
  /** Stamp this as the reference mcap (first armed turn). */
  setReference?: number;
  /** Stamp the matching fundamental mcap, so later turns can tell a repricing
   *  apart from a market break. Emitted ONE TURN AFTER `setReference` (never
   *  alongside it): the fundamental reading available at turn T describes turn
   *  T-1, so this is the first turn it describes the reference turn's state. */
  setReferenceFundamental?: number;
  /** Revert one tier down — the drop breached the threshold. */
  trip?: {
    /** Tier to revert to, resolved from the CURRENT mode (see
     *  {@link guardRevertTarget}). Persisted verbatim by `runLaunchGuard`. */
    revertTo: MarketSystemMode;
    referenceMcap: number;
    currentMcap: number;
    dropPct: number;
    /** True when the drop was measured against fundamentals rather than the
     *  raw launch anchor. */
    fundamentalsAdjusted?: boolean;
  };
}

/**
 * Pure decision: given the mode, config and the current aggregate mcap, decide
 * whether to stamp a reference, trip, or do nothing. No I/O — unit-testable.
 */
export function evaluateLaunchGuard(args: {
  mode: string;
  guardEnabled?: boolean;
  referenceMcap?: number | null;
  referenceTurn?: number | null;
  currentMcap: number;
  currentTurn: number;
  dropPct?: number | null;
  graceTurns?: number | null;
  /** Aggregate fundamental (model) valuation this turn, same units as
   *  currentMcap. Optional — omit to get the raw drawdown behaviour. */
  currentFundamentalMcap?: number | null;
  referenceFundamentalMcap?: number | null;
  /** Share of currentMcap whose corps carried a fundamental price. */
  fundamentalCoverage?: number | null;
}): GuardDecision {
  // Armed on every tier at or above `clearing` — enumerating tier names here
  // silently disarmed the kill switch the moment a higher tier (plants) landed,
  // on exactly the flip that most needs it.
  const armed =
    args.guardEnabled === true &&
    isMarketSystemMode(args.mode) &&
    marketAtLeast(args.mode, "clearing");
  if (!armed || !(args.currentMcap > 0)) return {};

  // First armed turn (or a stale/zero reference): stamp the mcap baseline ONLY.
  //
  // VINTAGE INVARIANT. `currentMcap` is this turn's aggregate, but
  // `currentFundamentalMcap` is computed from `corp.fundamentalSharePrice`,
  // which `recomputeSharePricesAfterBondTurn` only writes in a LATER phase of
  // the same turn — so the fundamental reading the guard sees at turn T is
  // always turn T-1's. Stamping both here would pair mcap(T) with
  // fundamental(T-1). Normally a one-turn skew is noise; on the FLIP turn it is
  // the entire revaluation. (Observed: the plants flip doubled aggregate
  // sectorNPV, so the reference became mcap = post-flip 5.71B against
  // fundamental = pre-flip 4.09B. Every later ratio curFund/refFund was then
  // inflated by the flip factor, clamped to 1 by the `min` below, and the
  // fundamentals leg was permanently disabled — leaving the raw drawdown from
  // the post-flip peak, which tripped at turn 158 by 0.01%.)
  //
  // Deferring the fundamental stamp by one turn makes the pair (mcap(R),
  // fundamental(R)) — same vintage, both post-flip — and the running comparison
  // fundamental(T-1) vs fundamental(R) is then a like-for-like, conservatively
  // lagged ratio.
  if (!(typeof args.referenceMcap === "number" && args.referenceMcap > 0)) {
    return { setReference: args.currentMcap };
  }

  const threshold = typeof args.dropPct === "number" ? args.dropPct : DEFAULT_GUARD_DROP_PCT;

  // The guard exists to catch a *broken flip* — prices decoupling from value —
  // not an honest repricing. When the central bank tightens, share prices fall
  // because sectorNPV is discounted by the prime rate (recomputeSharePrices),
  // and fundamentals fall in lockstep: the market is working, not breaking.
  // So when we have a trustworthy fundamental valuation on both ends, measure
  // the drop against what fundamentals justify rather than the frozen launch
  // anchor. A genuine break still trips, because price falls and fundamentals
  // do not. Falls back to the raw drawdown whenever coverage is thin.
  const refFund = args.referenceFundamentalMcap;
  const curFund = args.currentFundamentalMcap;
  const coverage = args.fundamentalCoverage ?? 0;
  const curFundUsable =
    typeof curFund === "number" && curFund > 0 && coverage >= FUNDAMENTAL_COVERAGE_FLOOR;
  const haveRefFund = typeof refFund === "number" && refFund > 0;

  // The mcap reference is stamped on the first armed turn, which lands before
  // recomputeSharePrices has written that turn's fundamentalSharePrice — so
  // that stamp has no fundamental twin yet, and the guard would sit on raw
  // drawdown forever. Fill in the twin on the FOLLOWING turn, when the reading
  // finally reflects the reference turn's own state (see the vintage invariant
  // above). The mcap reference and its turn are deliberately left ALONE: moving
  // them here is what re-introduced the skew. Gated on the market still being
  // healthy by the raw measure: a genuinely broken flip is already breaching
  // here, and must never be rescued by a fresh baseline.
  if (!haveRefFund && curFundUsable) {
    const rawDrop = 1 - args.currentMcap / args.referenceMcap;
    if (rawDrop < threshold) {
      return { setReferenceFundamental: curFund as number };
    }
  }

  const grace = typeof args.graceTurns === "number" ? args.graceTurns : DEFAULT_GUARD_GRACE_TURNS;
  const since = args.currentTurn - (args.referenceTurn ?? args.currentTurn);
  if (since < grace) return {};

  const fundamentalsUsable = haveRefFund && curFundUsable;

  // Fundamentals may only ever make the guard MORE lenient, never stricter.
  //
  // The naive form (`referenceMcap * curFund/refFund`) reduces the criterion to
  // a fall in the price/fundamental MULTIPLIER, and that multiplier is exactly
  // what applyPriceMultipliers writes from sentiment and order flow — where
  // SENTIMENT_CAP alone permits a market-wide 0.75x. So any broadly negative
  // sentiment window would trip a guard that then PERMANENTLY reverts the market
  // tier, turning a routine market state into a one-way break. Worse, when
  // fundamentals collapse alongside price the expected value shrinks with them
  // and the drop reads as ~zero — meaning a genuine economy-wide death spiral,
  // the exact thing worth catching, would never fire.
  //
  // Clamping to the launch reference keeps the original absolute-drawdown floor
  // intact and uses fundamentals only to EXCUSE a fall that a lower valuation
  // justifies (the prime-rate repricing this was built for).
  const expectedMcap = fundamentalsUsable
    ? Math.min(args.referenceMcap, args.referenceMcap * (curFund / refFund))
    : args.referenceMcap;

  const dropPct = 1 - args.currentMcap / expectedMcap;
  if (dropPct >= threshold) {
    return {
      trip: {
        // `args.mode` passed isMarketSystemMode in the arm check above.
        revertTo: guardRevertTarget(args.mode as MarketSystemMode),
        referenceMcap: expectedMcap,
        currentMcap: args.currentMcap,
        dropPct,
        fundamentalsAdjusted: fundamentalsUsable,
      },
    };
  }
  return {};
}

/**
 * Runtime applier: reads config + the current aggregate mcap, evaluates the
 * guard, and persists the stamp/trip. Call once per turn after mcap is known.
 * Cheap no-op unless the guard is enabled and the mode is at least `clearing`.
 */
export async function runLaunchGuard(
  db: Db,
  currentTurn: number,
  aggregateMcap: number,
  /** Aggregate fundamental valuation + the share of mcap it covers. Omit and
   *  the guard falls back to the raw launch drawdown. */
  fundamentals?: { aggregateFundamentalMcap: number; coverage: number }
): Promise<void> {
  const cfg = await db.collection<GameConfig>("gameConfig").findOne(
    { _id: "default" },
    {
      projection: {
        marketSystemMode: 1,
        marketGuardEnabled: 1,
        marketGuardReferenceMcap: 1,
        marketGuardReferenceTurn: 1,
        marketGuardReferenceFundamentalMcap: 1,
        marketGuardDropPct: 1,
        marketGuardGraceTurns: 1,
      },
    }
  );
  if (!cfg) return;

  const decision = evaluateLaunchGuard({
    mode: cfg.marketSystemMode ?? "off",
    guardEnabled: cfg.marketGuardEnabled,
    referenceMcap: cfg.marketGuardReferenceMcap,
    referenceTurn: cfg.marketGuardReferenceTurn,
    referenceFundamentalMcap: cfg.marketGuardReferenceFundamentalMcap,
    currentMcap: aggregateMcap,
    currentFundamentalMcap: fundamentals?.aggregateFundamentalMcap,
    fundamentalCoverage: fundamentals?.coverage,
    currentTurn,
    dropPct: cfg.marketGuardDropPct,
    graceTurns: cfg.marketGuardGraceTurns,
  });

  // A stamp may set the mcap reference, the fundamental twin, or (on the first
  // armed turn) the mcap reference alone. `marketGuardReferenceTurn` tracks the
  // MCAP reference only — a fundamental-only stamp must not move it, or the
  // grace window would restart a turn after arming.
  if (decision.setReference !== undefined || decision.setReferenceFundamental !== undefined) {
    await db.collection<GameConfig>("gameConfig").updateOne(
      { _id: "default" },
      {
        $set: {
          ...(decision.setReference !== undefined
            ? {
                marketGuardReferenceMcap: decision.setReference,
                marketGuardReferenceTurn: currentTurn,
              }
            : {}),
          ...(decision.setReferenceFundamental !== undefined
            ? { marketGuardReferenceFundamentalMcap: decision.setReferenceFundamental }
            : {}),
        },
      }
    );
    return;
  }

  if (decision.trip) {
    await db.collection<GameConfig>("gameConfig").updateOne(
      { _id: "default" },
      {
        $set: {
          marketSystemMode: decision.trip.revertTo,
          marketSystemModeUpdatedBy: "launch-guard",
          marketSystemModeUpdatedAt: new Date().toISOString(),
          // Same turn stamp the admin route writes: an auto-revert is a mode
          // change like any other, and the soak tooling reads this field to
          // find the flip boundary. Without it an auto-revert would leave the
          // world carrying the turn of the ORIGINAL flip.
          marketSystemModeUpdatedTurn: currentTurn,
          marketGuardEnabled: false,
          marketGuardTrippedAt: new Date().toISOString(),
        },
      }
    );
    await createAdminLog({
      category: "system",
      action: "market_system_auto_reverted",
      username: "launch-guard",
      adminUsername: "launch-guard",
      details:
        `Launch guard auto-reverted market mode to "${decision.trip.revertTo}": ` +
        `aggregate market cap fell ` +
        `${(decision.trip.dropPct * 100).toFixed(1)}% (${
          decision.trip.fundamentalsAdjusted ? "vs fundamentals-implied" : "vs launch"
        } ref ${Math.round(decision.trip.referenceMcap)} → ` +
        `${Math.round(decision.trip.currentMcap)}) at turn ${currentTurn}.`,
    });
  }
}
