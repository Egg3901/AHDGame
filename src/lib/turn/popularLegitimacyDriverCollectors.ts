/**
 * Driver-input collectors for the per-turn popularLegitimacy tick.
 *
 * The pure drivers in `popularLegitimacyDrivers.ts` take typed inputs;
 * the per-turn integration needs to *gather* those inputs from across
 * the codebase (central bank state, purge events, enacted bill
 * categories, election turn detection). Keeping this I/O layer in its
 * own module preserves the purity of the drivers.
 *
 * Each collector returns a sensible neutral default when the underlying
 * data isn't available — drift falls back to natural recovery only for
 * countries whose central bank / metrics aren't yet populated.
 */
import type { Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { CentralBank } from "@/lib/db/types";
import type { FederalBudget } from "@/lib/db/types/budget";
import { getBankId } from "@/lib/centralBank/helpers";
import { getNationalBudgetId } from "@/lib/bonds/sovereign";
import type { PolicyAxisEffect } from "@/lib/turn/rulingPartyPriorities";
import type {
  EconomicSignals,
  ElectionCredibilitySignals,
  PurgeEventInput,
  EnactedBillInput,
  PurgeSeverity,
  InternalRepressionSignals,
} from "./popularLegitimacyDrivers";

/**
 * Neutral inflation target. Real CB inflation targets vary by country
 * but ~2% is the modern central-bank norm. Used as the anchor for the
 * `inflationDeviationFromTargetPct` signal.
 */
const NEUTRAL_INFLATION_TARGET_PCT = 2.0;

/**
 * Neutral GDP growth used when the country has no central-bank record
 * (defensive — matches the economic driver's neutral anchor).
 */
const NEUTRAL_GDP_GROWTH_PCT = 2.5;

/**
 * Read the latest economic signals for a country from its central bank
 * snapshot history. Returns neutral defaults when the bank doesn't
 * exist (e.g. countries not yet on the forex system).
 *
 * Unemployment delta is a future signal — wired to 0 for v1; the
 * `stateMetrics` aggregation pass that derives a national unemployment
 * trend is out of scope for Phase 2.
 */
export async function collectEconomicSignalsForCountry(
  db: Db,
  countryId: CountryId
): Promise<EconomicSignals> {
  // getBankId: shared-bank members (IE → ECB, SCO/WAL → BoE) have no doc under
  // their own id; without it they silently collected neutral signals forever.
  const bank = await db
    .collection<CentralBank>("centralBanks")
    .findOne({ _id: getBankId(countryId) });

  if (!bank) {
    return {
      gdpGrowthAnnualPct: NEUTRAL_GDP_GROWTH_PCT,
      unemploymentDeltaPct: 0,
      inflationDeviationFromTargetPct: 0,
    };
  }

  const latestGdp =
    bank.gdpGrowthHistory && bank.gdpGrowthHistory.length > 0
      ? bank.gdpGrowthHistory[bank.gdpGrowthHistory.length - 1].rate
      : NEUTRAL_GDP_GROWTH_PCT;

  const latestInflation =
    bank.inflationHistory && bank.inflationHistory.length > 0
      ? bank.inflationHistory[bank.inflationHistory.length - 1].rate
      : NEUTRAL_INFLATION_TARGET_PCT;

  return {
    gdpGrowthAnnualPct: latestGdp,
    unemploymentDeltaPct: 0,
    inflationDeviationFromTargetPct: latestInflation - NEUTRAL_INFLATION_TARGET_PCT,
  };
}

/**
 * Read the command-economy internal-repression signals (the honored repression
 * level + the current shortage index) from a country's national budget, as
 * persisted by the command-economy turn phase. Returns a no-op (0 / 0 → zero
 * legitimacy cost) when the country runs no command economy or the fields are
 * absent, so market countries and flag-off worlds are unaffected.
 */
export async function collectInternalRepressionSignals(
  db: Db,
  countryId: CountryId
): Promise<InternalRepressionSignals> {
  const budget = await db
    .collection<FederalBudget>("federalBudget")
    .findOne({ _id: getNationalBudgetId(countryId) } as { _id: "federal" }, {
      projection: { "economicFactors.internalRepression": 1, "economicFactors.shortageIndex": 1 },
    });
  const factors = budget?.economicFactors;
  const rep = factors?.internalRepression;
  const shortage = factors?.shortageIndex;
  return {
    internalRepression: typeof rep === "number" && Number.isFinite(rep) ? rep : 0,
    shortageIndex: typeof shortage === "number" && Number.isFinite(shortage) ? shortage : 0,
  };
}

/**
 * Per-turn election-credibility signals. The caller passes in whether
 * an election fired this turn and the multiplier that was actually
 * applied (read from `countryState.opsVoteMultipliers`); this collector
 * just shapes those inputs into the driver's expected form.
 *
 * Kept async + Db-typed for symmetry with the other collectors — future
 * versions may consult an `elections` collection directly to detect
 * the turn automatically without the caller having to know.
 */
export async function collectElectionCredibilitySignals(
  _db: Db,
  _countryId: CountryId,
  _currentTurn: number,
  hint: { opsMultiplier: number | null; isElectionTurn: boolean }
): Promise<ElectionCredibilitySignals> {
  return {
    isElectionTurn: hint.isElectionTurn,
    opsMultiplier: hint.opsMultiplier ?? 1.0,
  };
}

/**
 * Map raw `rulingPartyPurgeEvents` documents to the popular-driver
 * input shape. Defaults a missing `kind` to "discipline" — the field
 * was added after the original purge schema, so legacy rows lack it.
 */
export function mapPurgeEventsToInput(
  events: Array<{ severity: string; kind?: string }>
): PurgeEventInput[] {
  return events.map((e) => ({
    severity: e.severity as PurgeSeverity,
    kind: (e.kind ?? "discipline") as PurgeEventInput["kind"],
  }));
}

/**
 * Translate enacted-bill categories into the popular-driver bill shape
 * using the country's `policyAxisEffects` map.
 *
 * The existing priority engine uses -100..+100 deltas; the popular
 * driver expects -1..+1. Rescale at the boundary so the upstream
 * priority data and the downstream driver each keep their natural unit.
 *
 * Categories that aren't in the country's `policyAxisEffects` are
 * silently skipped (they don't push any axis, so they contribute zero
 * to popular drift).
 */
export function mapEnactedBillsToInput(
  categories: string[],
  axisEffects: Record<string, PolicyAxisEffect[]>
): EnactedBillInput[] {
  const bills: EnactedBillInput[] = [];
  for (const cat of categories) {
    const effects = axisEffects[cat];
    if (!effects || effects.length === 0) continue;
    const axisEffectMap: Record<string, number> = {};
    for (const effect of effects) {
      axisEffectMap[effect.axisId] = effect.delta / 100;
    }
    bills.push({ axisEffects: axisEffectMap });
  }
  return bills;
}
