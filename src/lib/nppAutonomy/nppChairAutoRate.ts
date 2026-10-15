import type { EuroPolicyIndicators } from "@/lib/currency/euro/rules";
import type { Db, ObjectId } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { CentralBank, RateChangeRecord } from "@/lib/db/types/centralBank";
import { SYSTEM_RATE_ACTOR } from "@/lib/centralBank/rateHistory";
import type { FederalBudget } from "@/lib/db/types/budget";
import type { StateMetrics } from "@/lib/db/types/stateMetrics";
import { COUNTRY_CONFIGS } from "@/lib/constants/countries";
import { isCommandEconomy } from "@/lib/constants/commandEconomy";
import { getEraMonetaryBaseline } from "@/lib/constants/monetaryEra";
import { getInflationTarget } from "@/lib/budget/inflation";
import { getNationalBudgetId } from "@/lib/bonds/sovereign";
import { getNationalDocId } from "@/lib/constants/nationalScope";
import {
  NPP_CHAIR_STEP_FRACTION,
  NPP_CHAIR_TARGET_GROWTH,
  MAX_RATE_CUT_DELTA,
  maxHikeDeltaFor,
  PRIME_RATE_CEILING,
  GOVERNMENT_RATE_IDLE_TURNS,
  RATE_CHANGE_COOLDOWN_TURNS,
  RATE_HISTORY_MAX,
  snapToPrimeRateGrid,
} from "@/lib/db/types/centralBank";
import { chairAlignmentPolicy, type ChairAlignment } from "@/lib/centralBank/chairAlignment";
import {
  computeNppChairActivityTarget,
  computeNppChairRateTarget,
} from "@/lib/nppAutonomy/rules/chairRateTarget";
import { nationalOutputGap } from "@/lib/metricEngine/outputTrend";
import type { State } from "@/lib/db/types/state";
export { computeNppChairRateTarget } from "@/lib/nppAutonomy/rules/chairRateTarget";
import { isBankGovernmentControlled } from "@/lib/centralBank/governance";
import type { ExchangeRate, InterventionPolicy } from "@/lib/db/types/exchangeRate";
import {
  INITIAL_RATES,
  INTERVENTION_POLICY_COOLDOWN_TURNS,
  RATE_CEILING_MULTIPLIER,
  RATE_FLOOR_MULTIPLIER,
} from "@/lib/constants/currencies";
import {
  defenceAction,
  defenceBand,
  type DefenceAction,
} from "@/lib/nppAutonomy/v6/rules/currencyDefence";
import { NPP_ENGINE_LEVEL } from "@/lib/nppAutonomy/engineVersion";
import { nppAutonomyAtLeast } from "@/lib/nppAutonomy/featureFlag";
import {
  FX_LOOKBACK_TURNS,
  fxDepreciation,
  fxRateAdjustment,
} from "@/lib/nppAutonomy/v6/rules/fxRateResponse";

/**
 * Bounded step toward the target: 0.5x the gap, clamped to [-1.75, +0.75].
 * `alignment` scales hike vs. cut speed before the clamp (hawk hikes faster /
 * cuts slower; dove the inverse).
 *
 * When `inflationGap` (inflation minus target) is at least
 * NPP_CHAIR_HIGH_INFLATION_GAP the hike clamp widens to
 * NPP_CHAIR_HIGH_INFLATION_HIKE_DELTA so the rate can catch up with runaway
 * inflation in a few meetings instead of years. The step is still 0.5x the gap,
 * so it shrinks as the rate closes in, and cuts are untouched. Hikes never
 * carry the rate past PRIME_RATE_CEILING.
 */
export function computeNppChairRateStep(params: {
  currentRate: number;
  targetRate: number;
  alignment?: ChairAlignment | null;
  inflationGap?: number;
}): number {
  const policy = chairAlignmentPolicy(params.alignment);
  const desired = params.targetRate - params.currentRate;
  let step = NPP_CHAIR_STEP_FRACTION * desired;
  step *= step >= 0 ? policy.hikeStepMult : policy.cutStepMult;
  const hikeCap = maxHikeDeltaFor(params.inflationGap);
  const headroom = Math.max(0, PRIME_RATE_CEILING - params.currentRate);
  return Math.max(-MAX_RATE_CUT_DELTA, Math.min(hikeCap, headroom, step));
}

function finiteOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/**
 * Per-turn autonomous rate setting for chairMode === "npp" banks. Reads the same
 * inflation/gdp sources as computeScrutinyDelta (federalBudget.economicFactors.inflationRate
 * and stateMetrics.economic.gdpGrowth.value, keyed by getNationalBudgetId / getNationalDocId),
 * computes a Taylor-rule target, and moves primeRate toward it by a bounded step, respecting
 * the existing 6-turn cooldown and lastRateChangeTurn tracking. No-op when within cooldown,
 * when the step is ~0, or when the bank is not governed by an NPP technocrat chair. When the
 * rate belongs to the government, it only acts on standing advice after the government has
 * left the rate alone for GOVERNMENT_RATE_IDLE_TURNS (see `isStandingAdviceDue`).
 *
 * No chairInfamy character debit — the NPP has no character to penalize.
 */
export async function processNppChairAutoRate(
  db: Db,
  bank: Pick<
    CentralBank,
    | "_id"
    | "chairMode"
    | "primeRate"
    | "lastRateChangeTurn"
    | "lastStandingAdviceTurn"
    | "chairAlignment"
    | "governmentControlled"
    | "chairNppId"
  >,
  countryId: CountryId,
  currentTurn: number,
  /**
   * CURRENT in-game year (gameState.currentYear) — resolves era-authored CB
   * anchors, graduating as the world's clock advances. Absent → modern
   * anchors (fail-safe).
   */
  currentYear: number | null | undefined,
  /** GameConfig.commandEconomyEnabled — default OFF / fail-safe when omitted. */
  commandEconomyEnabled: boolean | undefined,
  /**
   * Era START year (gameState.startingYear) — resolves whether the government,
   * not the bank, holds the rate. This is the START year, not `currentYear`:
   * see `isBankGovernmentControlled`, where a transfer of monetary power is a
   * statute the calendar must never pass on the players' behalf.
   *
   * REQUIRED, and deliberately not optional: omitting it resolves every bank to
   * "not government-controlled", which silently restores the very bug the gate
   * below exists to prevent. A caller that genuinely cannot resolve the world's
   * start year should pass `getStartingYearForPreset(DEFAULT_SEED_PRESET)`
   * explicitly rather than leaving it out.
   */
  startingYear: number | undefined,
  commonIndicators?: EuroPolicyIndicators
): Promise<void> {
  if (bank.chairMode !== "npp") return;
  // A government-controlled bank (the pre-1997 Bank of England) has no rate of
  // its own to set: the head of government or the finance minister sets it, and
  // the technocrat chair is a forecaster, not an authority. Without this the
  // autonomous chair moved the rate anyway and stamped `lastRateChangeTurn`,
  // and because the government shares that one cooldown field the Treasury's
  // window slammed shut every time it opened — the rate card sat permanently on
  // "on cooldown" and the government could never actually set the rate (#1250).
  // `fomcMeetingTurn` and `seedFomcBoards` already make the same check.
  //
  // A government that never uses the lever would otherwise freeze the rate for
  // the whole world: the 1991 UK sat at 4.5% for its first 28 turns through 15%
  // inflation. So once the government has left the rate alone for a quarter,
  // the Treasury acts on the bank's standing advice: the same bounded Taylor
  // step, recorded in the published history. It is paced by its own field and
  // never touches `lastRateChangeTurn`, so the government's window stays open
  // and any rate it sets wins.
  const governmentControlled = isBankGovernmentControlled(bank, countryId, startingYear);
  if (isCommandEconomy(countryId, currentYear, commandEconomyEnabled)) return;

  const lastChange = bank.lastRateChangeTurn;
  if (governmentControlled) {
    if (!isStandingAdviceDue(bank, currentTurn)) return;
  } else if (
    typeof lastChange === "number" &&
    currentTurn - lastChange < RATE_CHANGE_COOLDOWN_TURNS
  ) {
    return;
  }

  const targetInflation =
    commonIndicators?.targetInflation ?? getInflationTarget(countryId, currentYear);

  const budgetId = getNationalBudgetId(countryId);
  const budget = commonIndicators
    ? null
    : await db.collection<FederalBudget>("federalBudget").findOne({ _id: budgetId });
  const inflationRate =
    commonIndicators?.inflationRate ??
    finiteOr(budget?.economicFactors?.inflationRate, targetInflation);

  const nationalDocId = getNationalDocId(countryId);
  const nationalMetrics =
    !commonIndicators && nationalDocId
      ? // SP5: national economic rollup lives on macroMetrics.
        await db.collection<StateMetrics>("macroMetrics").findOne({ _id: nationalDocId })
      : null;
  const gdpGrowth =
    commonIndicators?.gdpGrowth ??
    finiteOr(nationalMetrics?.economic?.gdpGrowth?.value, NPP_CHAIR_TARGET_GROWTH);

  // Era-authored neutral rate when the current in-game era overrides it (e.g.
  // IT 1953 ≈ 4% vs the late-1970s 12% baked into defaultPrimeRate); otherwise
  // the country's modern default — unchanged for worlds at 1999+.
  const neutralRate =
    commonIndicators?.neutralRate ??
    getEraMonetaryBaseline(countryId, currentYear)?.neutralPrimeRate ??
    COUNTRY_CONFIGS[countryId].centralBank.defaultPrimeRate;
  // A national chair answers measured slack (output gap, unemployment above
  // NAIRU); a shared common policy keeps the growth rule until its members'
  // activity inputs are aggregated.
  let activityNote = `growth ${gdpGrowth.toFixed(1)}%`;
  let taylorTarget: number;
  if (commonIndicators) {
    taylorTarget = computeNppChairRateTarget({
      neutralRate,
      inflationRate,
      targetInflation,
      gdpGrowth,
      alignment: bank.chairAlignment,
    });
  } else {
    const regions = await db
      .collection<State>("states")
      .find(
        { countryId },
        { projection: { gdp: 1, outputGap: 1, outputTrendGrowth: 1, realOutputStartTurn: 1 } }
      )
      .toArray();
    // Phased in with the measured-output blend, as the inflation model reads it.
    const measuredGap = nationalOutputGap(regions, currentTurn);
    const outputGap = measuredGap ? measuredGap.gap * measuredGap.weight : null;
    const unemploymentRate = finiteOr(
      nationalMetrics?.economic?.unemploymentRate?.value,
      Number.NaN
    );
    taylorTarget = computeNppChairActivityTarget({
      neutralRate,
      inflationRate,
      targetInflation,
      activity: { outputGap, unemploymentRate },
      alignment: bank.chairAlignment,
    });
    activityNote = `${outputGap != null ? `output gap ${outputGap.toFixed(1)}%, ` : ""}${
      Number.isFinite(unemploymentRate)
        ? `unemployment ${unemploymentRate.toFixed(1)}%`
        : "unemployment n/a"
    }`;
  }
  // Engine 6.6 (v6): a floating national currency's move over the lookback
  // shifts the target (v6/rules/fxRateResponse.ts). A shared common policy,
  // a peg or an admin hard peg has no national exchange rate to answer.
  let fxShift = 0;
  let fxMove: number | null = null;
  if (!commonIndicators && (await nppAutonomyAtLeast(db, countryId, NPP_ENGINE_LEVEL))) {
    const fx = await db.collection<ExchangeRate>("exchangeRates").findOne(
      { _id: countryId },
      {
        projection: {
          rate: 1,
          hardPeg: 1,
          fxRegime: 1,
          rateHistory: { $slice: -(FX_LOOKBACK_TURNS * 2) },
        },
      }
    );
    const floating = fx && fx.hardPeg == null && (fx.fxRegime ?? "float") === "float";
    if (floating) {
      fxMove = fxDepreciation(fx.rateHistory, fx.rate, currentTurn);
      fxShift = fxRateAdjustment(fxMove);
    }
  }
  const targetRate = taylorTarget + fxShift;
  const step = computeNppChairRateStep({
    currentRate: bank.primeRate,
    targetRate,
    alignment: bank.chairAlignment,
    inflationGap: inflationRate - targetInflation,
  });
  if (Math.abs(step) <= 1e-9) return;

  // Snap onto the quarter-point grid the rate API enforces. The Taylor rule
  // produces a continuous value, and storing it raw left the bank on a rate no
  // human chair could ever step away from: the card offers base +/-0.25, which
  // from an off-grid base is still off-grid, so every submission was refused
  // with "Rate must be in 0.25% increments" (ticket #1238).
  const newRate = snapToPrimeRateGrid(bank.primeRate + step);
  // Snapping can land back on the current rate for a sub-quarter-point step;
  // writing that would burn the cooldown on a no-op move.
  if (newRate === bank.primeRate) return;

  // Record the move in the published history. The autonomous chair used to set
  // the rate and write nothing, so the bank's rate history showed only the last
  // human change however long ago it was — the pre-1997 Bank of England had
  // moved to 0.25% with a completely empty ledger, and there was no way to see
  // who had moved the rate or when. The committee path already records its own
  // automated moves this way (`resolveMeetingInto`); the single chair now does
  // too. `$push` with `$slice` avoids having to read the array back.
  const now = new Date();
  const chairName = bank.chairNppId
    ? ((
        await db
          .collection<{ _id: ObjectId; name?: string }>("npps")
          .findOne({ _id: bank.chairNppId }, { projection: { name: 1 } })
      )?.name ?? null)
    : null;
  const fxNote =
    fxShift !== 0 && fxMove != null
      ? `, currency ${fxMove > 0 ? "down" : "up"} ${Math.abs(fxMove * 100).toFixed(0)}% over ${FX_LOOKBACK_TURNS} turns (${fxShift > 0 ? "+" : ""}${fxShift.toFixed(2)} pts)`
      : "";
  const taylor = `Taylor rule: inflation ${inflationRate.toFixed(1)}%, ${activityNote}, neutral ${neutralRate.toFixed(2)}%${fxNote}`;
  const record: RateChangeRecord = governmentControlled
    ? {
        previousRate: bank.primeRate,
        newRate,
        changedBy: SYSTEM_RATE_ACTOR,
        changedByName: "Treasury, on the bank's standing advice",
        changedAt: now,
        reason: `No government rate decision for ${GOVERNMENT_RATE_IDLE_TURNS}+ turns. ${taylor}`,
      }
    : {
        previousRate: bank.primeRate,
        newRate,
        changedBy: bank.chairNppId ?? SYSTEM_RATE_ACTOR,
        changedByName: chairName ? `${chairName} (autonomous chair)` : "Autonomous chair",
        changedAt: now,
        reason: taylor,
      };

  await db.collection<CentralBank>("centralBanks").updateOne(
    { _id: bank._id },
    {
      $set: governmentControlled
        ? { primeRate: newRate, lastStandingAdviceTurn: currentTurn, updatedAt: now }
        : { primeRate: newRate, lastRateChangeTurn: currentTurn, updatedAt: now },
      $push: { rateHistory: { $each: [record], $slice: -RATE_HISTORY_MAX } },
    }
  );
}

/**
 * Whether the Treasury should act on the bank's standing advice this turn: the
 * government has not set the rate for `GOVERNMENT_RATE_IDLE_TURNS` (counted
 * from world start when it never has), and the last advice move is at least a
 * normal cooldown old.
 */
export function isStandingAdviceDue(
  bank: Pick<CentralBank, "lastRateChangeTurn" | "lastStandingAdviceTurn">,
  currentTurn: number
): boolean {
  const lastGovernmentMove =
    typeof bank.lastRateChangeTurn === "number" ? bank.lastRateChangeTurn : 0;
  if (currentTurn - lastGovernmentMove < GOVERNMENT_RATE_IDLE_TURNS) return false;
  const lastAdvice = bank.lastStandingAdviceTurn;
  if (typeof lastAdvice === "number" && lastAdvice > lastGovernmentMove) {
    return currentTurn - lastAdvice >= RATE_CHANGE_COOLDOWN_TURNS;
  }
  return true;
}

/**
 * Engine 6.13 (v6): an autonomous chair's currency defence band. Runs every
 * chair turn alongside the rate setter (not gated on the rate cooldown) and
 * sets or releases a reserve-backed intervention band per
 * `v6/rules/currencyDefence.ts`. Never touches a band someone else set, a
 * government-held rate, a pegged currency, or a common monetary policy.
 */
export async function processNppCurrencyDefence(
  db: Db,
  bank: Pick<CentralBank, "_id" | "chairMode" | "chairNppId" | "governmentControlled">,
  countryId: CountryId,
  currentTurn: number,
  startingYear: number | undefined,
  commonIndicators?: EuroPolicyIndicators
): Promise<DefenceAction> {
  if (bank.chairMode !== "npp" || commonIndicators || !bank.chairNppId) return "none";
  if (isBankGovernmentControlled(bank, countryId, startingYear)) return "none";
  if (!(await nppAutonomyAtLeast(db, countryId, NPP_ENGINE_LEVEL))) return "none";

  const fx = await db.collection<ExchangeRate>("exchangeRates").findOne(
    { _id: countryId },
    {
      projection: {
        rate: 1,
        baseRate: 1,
        hardPeg: 1,
        fxRegime: 1,
        interventionPolicy: 1,
        rateHistory: { $slice: -(FX_LOOKBACK_TURNS * 2) },
      },
    }
  );
  if (!fx || fx.hardPeg != null || (fx.fxRegime ?? "float") !== "float") return "none";

  const band = fx.interventionPolicy ?? null;
  const action = defenceAction({
    depreciation: fxDepreciation(fx.rateHistory, fx.rate, currentTurn),
    hasBand: !!band,
    ownBand: !!band && band.setByCharacterId?.toString() === bank.chairNppId.toString(),
    turnsSinceBandChange: band ? currentTurn - band.lastAdjustedAtTurn : null,
    cooldownTurns: INTERVENTION_POLICY_COOLDOWN_TURNS,
  });
  const now = new Date();

  if (action === "release" && band) {
    await db
      .collection<ExchangeRate>("exchangeRates")
      .updateOne(
        { _id: countryId, "interventionPolicy.setAtTurn": band.setAtTurn },
        { $set: { interventionPolicy: null, updatedAt: now } }
      );
    return action;
  }
  if (action !== "set") return "none";

  const baseRate = fx.baseRate > 0 ? fx.baseRate : (INITIAL_RATES[countryId] ?? 0);
  if (!(baseRate > 0)) return "none";
  const target = defenceBand(fx.rate, {
    floor: baseRate * RATE_FLOOR_MULTIPLIER,
    ceiling: baseRate * RATE_CEILING_MULTIPLIER,
  });
  if (!target) return "none";
  const chair = await db
    .collection<{ _id: ObjectId; name?: string }>("npps")
    .findOne({ _id: bank.chairNppId }, { projection: { name: 1 } });
  const policy: InterventionPolicy = {
    floor: target.floor,
    ceiling: target.ceiling,
    setByCharacterId: bank.chairNppId,
    setByCharacterName: chair?.name ? `${chair.name} (autonomous chair)` : "Autonomous chair",
    setAtTurn: currentTurn,
    lastAdjustedAtTurn: currentTurn,
    recentInterventions: [],
  };
  // Only into an empty slot: a band a person set between the read and now wins.
  await db
    .collection<ExchangeRate>("exchangeRates")
    .updateOne(
      { _id: countryId, interventionPolicy: null },
      { $set: { interventionPolicy: policy, updatedAt: now } }
    );
  return action;
}
