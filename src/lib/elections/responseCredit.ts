/**
 * Credit-for-response loader for the economic referendum channel.
 *
 * Finds national-level bills the incumbent government enacted recently that
 * push a suffering misery component in the helpful direction, and hands them to
 * the pure gate in `economicReferendum.ts`.
 *
 * SOURCING (verified against the PRODUCERS, not the field names):
 *   • Enacted-policy spine — `statePolicies`, upserted per enacted provision by
 *     `src/lib/billEnactment.ts:833` from the doc built at `billEnactment.ts:798`.
 *     This is the only enactment record in the chain that carries a TURN
 *     (`enactedTurn`). `enactedLaws` carries only `enactedAt`/`enactedYear`, and
 *     `Bill` carries only `enactedAt`, so neither can answer "in the last 24
 *     turns". National scope is the national pseudo-state id (`federal`,
 *     `uk_national`, ...) from `src/lib/constants/nationalScope.ts`.
 *   • Metric impact vectors — bills carry none. The vector lives on the
 *     legislation type's selected policy option as
 *     `legislationTypes.policyOptions[].metricEffects[]`
 *     (`src/lib/db/types/legislation.ts:594`), which is what
 *     `computeTickRates` in `src/lib/policyEffects.ts:307` reads and applies.
 *     `ratePerTurn` is ADDITIVE ON THE RAW METRIC: negative means the metric's
 *     number goes down, which is helpful for unemployment and poverty and
 *     harmful for incomes.
 *   • Fiscal cost — `enactedLaws`, written once per provision at
 *     `src/lib/budget/enactedLaws.ts:110` from the fields assembled at
 *     `enactedLaws.ts:47`. The bill-side snapshot
 *     `Bill.budgetValidation.costAmount` (`src/lib/billEnactment.ts:402`) is the
 *     fallback for laws whose cost sits on the bill rather than the option.
 *   • Metric history — `macroMetricsHistory`, written every turn by
 *     `snapshotMetricHistory` at `src/lib/metricHistory.ts:99`, capped at 96
 *     turns. Shape is `{ _id, [category]: { [metricId]: {turn, value}[] } }`.
 *
 * KNOWN GAP: inflation. There is no `inflationRate` entry in
 * `src/lib/constants/metricDefinitions.ts`, so no policy option can declare a
 * metric effect on it. An inflation penalty therefore can never be forgiven by
 * this channel. That is a real limit of the data, not a tuning choice.
 */

import type { Db, ObjectId } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { StatePolicy } from "@/lib/db/types/statePolicy";
import type { EnactedLaw } from "@/lib/db/types/budget";
import type { LegislationType, PolicyOptionMetricEffect } from "@/lib/db/types/legislation";
import { getNationalDocId } from "@/lib/constants/nationalScope";
import {
  CREDIT_REVOCATION_TURNS,
  CREDIT_WINDOW_TURNS,
  type ResponseCreditCandidate,
} from "@/lib/electionEngine/economicReferendum";

/**
 * Which referendum component a metric feeds, and which sign of `ratePerTurn`
 * counts as a helpful push. `helpfulSign` is the sign the rate must have.
 */
const COMPONENT_BY_METRIC: Record<
  string,
  { component: string; category: string; helpfulSign: -1 | 1 }
> = {
  unemploymentRate: { component: "unemployment", category: "economic", helpfulSign: -1 },
  povertyRate: { component: "poverty", category: "economic", helpfulSign: -1 },
  medianIncome: { component: "incomeTrend", category: "economic", helpfulSign: 1 },
  wageGrowth: { component: "incomeTrend", category: "economic", helpfulSign: 1 },
};

/**
 * Smallest metric push that counts as a response at all. Below this a law is
 * decoration, and decoration should not buy forgiveness.
 */
const MIN_RATE_PER_TURN = 0.005;

/** Minimum cost signals. A law under all of these carried no real money. */
const MIN_BUDGET_COST_PCT = 0.5;
const MIN_COST_FRACTION = 0.0005;
const MIN_COST_PER_CAPITA = 1;
const MIN_COST_AMOUNT = 1;

/** Metric movement smaller than this counts as flat, not as worsening. */
const WORSENING_EPSILON = 0.05;

function positive(value: unknown, min: number): boolean {
  return typeof value === "number" && Number.isFinite(value) && value >= min;
}

/** Gate (a): did this law carry real budget cost? Exported for tests. */
export function hasRealBudgetCost(
  law: EnactedLaw | undefined,
  billCostAmount: number | undefined
): boolean {
  if (law) {
    if (positive(law.budgetCost, MIN_BUDGET_COST_PCT)) return true;
    if (positive(law.gdpCostFraction, MIN_COST_FRACTION)) return true;
    if (positive(law.incomeCostFraction, MIN_COST_FRACTION)) return true;
    if (positive(law.gdpPerCapitaMultiplier, MIN_COST_FRACTION)) return true;
    if (positive(law.annualCostPerCapita, MIN_COST_PER_CAPITA)) return true;
    if (positive(law.costModelV2?.gdpCostFraction, MIN_COST_FRACTION)) return true;
    if (positive(law.costModelV2?.incomeCostFraction, MIN_COST_FRACTION)) return true;
  }
  return positive(billCostAmount, MIN_COST_AMOUNT);
}

type HistoryPoint = { turn: number; value: number };

/**
 * Gate (c): has this metric kept worsening since the response landed?
 *
 * Compares the newest reading against the newest reading at least
 * `CREDIT_REVOCATION_TURNS` older, both taken from at or after `sinceTurn`. A
 * metric that moved the wrong way over that span revokes the whole component:
 * money spent and nothing to show for it is not a defence.
 *
 * When history is too short to make the comparison the gate does NOT revoke.
 * Missing evidence is not evidence of failure, and a world only a few turns
 * past a reset would otherwise revoke everything.
 *
 * Exported for tests.
 */
export function hasKeptWorsening(
  history: HistoryPoint[] | undefined,
  sinceTurn: number,
  helpfulSign: -1 | 1
): boolean {
  if (!history || history.length < 2) return false;
  const points = history
    .filter(
      (p) => typeof p?.turn === "number" && typeof p?.value === "number" && p.turn >= sinceTurn
    )
    .sort((a, b) => a.turn - b.turn);
  if (points.length < 2) return false;

  const latest = points[points.length - 1];
  let earlier: HistoryPoint | undefined;
  for (const p of points) {
    if (latest.turn - p.turn >= CREDIT_REVOCATION_TURNS) earlier = p;
  }
  if (!earlier) return false;

  const delta = latest.value - earlier.value;
  if (Math.abs(delta) < WORSENING_EPSILON) return false;
  // helpfulSign -1 means the metric should be falling, so a rise is worsening.
  return helpfulSign === -1 ? delta > 0 : delta < 0;
}

/**
 * Load the bills that qualify for credit-for-response in `countryId` as of
 * `currentTurn`. Never throws on missing data: an absent collection, missing
 * history, or a country with no national scope simply yields no credit.
 */
export async function loadResponseCredit(
  db: Db,
  countryId: CountryId,
  currentTurn: number
): Promise<ResponseCreditCandidate[]> {
  const nationalDocId = getNationalDocId(countryId);
  if (!nationalDocId || !Number.isFinite(currentTurn)) return [];

  const policies = await db
    .collection<StatePolicy>("statePolicies")
    .find({
      stateId: nationalDocId,
      enactedTurn: { $gte: currentTurn - CREDIT_WINDOW_TURNS, $lte: currentTurn },
    })
    .toArray();
  // Executive orders and expiry-restores are not legislation and earn nothing.
  const billPolicies = policies.filter(
    (p) => p.enactedBy?.kind === "bill" || (!p.enactedBy && p.enactedByBillId != null)
  );
  if (billPolicies.length === 0) return [];

  const typeIds = [...new Set(billPolicies.map((p) => p.legislationTypeId))];
  const billIds = billPolicies
    .map((p) => p.enactedBy?.id ?? p.enactedByBillId)
    .filter((id): id is ObjectId => id != null);

  const [legTypes, laws, bills, historyDoc] = await Promise.all([
    db
      .collection<LegislationType>("legislationTypes")
      .find({ _id: { $in: typeIds } }, { projection: { name: 1, policyOptions: 1 } })
      .toArray(),
    db
      .collection<EnactedLaw>("enactedLaws")
      .find({ billId: { $in: billIds } })
      .toArray(),
    db
      .collection("bills")
      .find({ _id: { $in: billIds } }, { projection: { title: 1, budgetValidation: 1 } })
      .toArray(),
    db.collection("macroMetricsHistory").findOne({ _id: nationalDocId as never }),
  ]);

  const typeById = new Map(legTypes.map((t) => [String(t._id), t]));
  const lawByBill = new Map(laws.map((l) => [String(l.billId), l]));
  const billById = new Map(bills.map((b) => [String(b._id), b]));

  // Metric id -> its per-turn history on the national doc.
  const historyFor = (category: string, metricId: string): HistoryPoint[] | undefined => {
    const cat = (historyDoc as Record<string, unknown> | null)?.[category] as
      Record<string, HistoryPoint[]> | undefined;
    return cat?.[metricId];
  };

  const candidates: ResponseCreditCandidate[] = [];
  // Metric ids backing each component, for the component-level revocation gate.
  const metricsByComponent = new Map<string, Set<string>>();
  const earliestTurnByMetric = new Map<string, number>();

  for (const policy of billPolicies) {
    const billId = String(policy.enactedBy?.id ?? policy.enactedByBillId ?? "");
    if (!billId) continue;

    const legType = typeById.get(policy.legislationTypeId);
    const option =
      legType?.policyOptions?.find((o) => o.id === policy.policyOptionId) ??
      legType?.policyOptions?.find((o) => o.effectDirection === policy.effectDirection);
    const effects = (option?.metricEffects ?? []) as PolicyOptionMetricEffect[];
    if (effects.length === 0) continue;

    // Gate (a): real budget cost.
    const bill = billById.get(billId) as
      { title?: string; budgetValidation?: { costAmount?: number } } | undefined;
    if (!hasRealBudgetCost(lawByBill.get(billId), bill?.budgetValidation?.costAmount)) continue;

    const title = lawByBill.get(billId)?.title ?? bill?.title ?? legType?.name ?? "Enacted law";

    // A bill earns at most one candidacy per component, however many metric
    // effects it declares on it.
    const seenComponents = new Set<string>();
    for (const effect of effects) {
      const mapping = COMPONENT_BY_METRIC[effect.metricId];
      if (!mapping || mapping.category !== effect.category) continue;
      if (!Number.isFinite(effect.ratePerTurn)) continue;
      if (Math.abs(effect.ratePerTurn) < MIN_RATE_PER_TURN) continue;
      if (Math.sign(effect.ratePerTurn) !== mapping.helpfulSign) continue;
      if (seenComponents.has(mapping.component)) continue;
      seenComponents.add(mapping.component);

      const metrics = metricsByComponent.get(mapping.component) ?? new Set<string>();
      metrics.add(effect.metricId);
      metricsByComponent.set(mapping.component, metrics);

      const prior = earliestTurnByMetric.get(effect.metricId);
      if (prior == null || policy.enactedTurn < prior) {
        earliestTurnByMetric.set(effect.metricId, policy.enactedTurn);
      }

      candidates.push({
        key: billId,
        title,
        component: mapping.component,
        enactedTurn: policy.enactedTurn,
      });
    }
  }
  if (candidates.length === 0) return [];

  // Gate (c): revoke a whole component when ANY metric backing it kept
  // worsening since the earliest response landed on that metric.
  const revoked = new Set<string>();
  for (const [component, metricIds] of metricsByComponent) {
    for (const metricId of metricIds) {
      const mapping = COMPONENT_BY_METRIC[metricId];
      if (!mapping) continue;
      const since = earliestTurnByMetric.get(metricId) ?? currentTurn;
      if (hasKeptWorsening(historyFor(mapping.category, metricId), since, mapping.helpfulSign)) {
        revoked.add(component);
        break;
      }
    }
  }

  return candidates.filter((c) => !revoked.has(c.component));
}
