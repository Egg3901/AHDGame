import type { Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import { getNationalDocId } from "@/lib/constants/nationalScope";
import { loadNationalPoliticalBoard } from "@/lib/politicalLegislation/conditionsSignal";
import { politicalValueForLegacyMetric } from "@/lib/politicalLegislation/marginAdapter";
import { isPoliticalApprovalCountry } from "@/lib/politicalLegislation/politicalApprovalProvider";
import type { TriggerClause, TriggerCondition, TriggerMetric } from "@/lib/db/types/crisis";

interface MetricPoint {
  turn: number;
  value: number;
}

/** A country's national-metric snapshot for trigger evaluation. */
export interface NationalSnapshot {
  countryId: CountryId;
  current: Partial<Record<TriggerMetric, number>>;
  /** Most-recent-last history for metrics that support consecutive-turn checks. */
  histories: Partial<Record<TriggerMetric, number[]>>;
  /** Percentage depreciation of the home currency over the last `windowTurns`
   *  (positive = weaker). Null when no forex history is available. */
  fxDepreciation: (windowTurns: number) => number | null;
}

interface MetricsDoc {
  economic?: {
    gdpGrowth?: { value?: number };
    unemploymentRate?: { value?: number };
  };
  infrastructure?: { powerGridReliability?: { value?: number } };
}

interface HistoryDoc {
  economic?: {
    gdpGrowth?: MetricPoint[];
    unemploymentRate?: MetricPoint[];
  };
}

/** Load one country's national snapshot. Missing inputs resolve to absent
 *  metrics, so clauses over them evaluate to false (the crisis won't fire). */
export async function loadNationalSnapshot(
  db: Db,
  countryId: CountryId
): Promise<NationalSnapshot> {
  const nationalDocId = getNationalDocId(countryId);

  // Economic trigger reads (gdpGrowth/unemployment + their histories) come from
  // the macro store. The one political trigger, powerGridReliability, is
  // adapted from the national board below.
  const [metricsDoc, historyDoc, federalBudget, approval, exchangeRate] = await Promise.all([
    nationalDocId
      ? db
          .collection<MetricsDoc & { _id: string }>("macroMetrics")
          .findOne({ _id: nationalDocId }, { projection: { economic: 1 } })
      : null,
    // Only `economic.*` histories are consulted below, so the legacy
    // `stateMetricHistory` half of this read contributed nothing even before it
    // stopped being written.
    nationalDocId
      ? db
          .collection<HistoryDoc & { _id: string }>("macroMetricsHistory")
          .findOne({ _id: nationalDocId })
      : null,
    db
      .collection<{
        countryId: CountryId;
        economicFactors?: { inflationRate?: number };
      }>("federalBudget")
      .findOne({ countryId }),
    db
      .collection<{ countryId: CountryId; approvalRating?: number }>("governmentApprovals")
      .findOne({ countryId }),
    db
      .collection<{
        countryId: CountryId;
        rate?: number;
        rateHistory?: { turn: number; rate: number }[];
      }>("exchangeRates")
      .findOne({ countryId }),
  ]);

  const current: Partial<Record<TriggerMetric, number>> = {};
  const histories: Partial<Record<TriggerMetric, number[]>> = {};

  const gdp = metricsDoc?.economic?.gdpGrowth?.value;
  if (typeof gdp === "number") current.gdpGrowth = gdp;
  const unemp = metricsDoc?.economic?.unemploymentRate?.value;
  if (typeof unemp === "number") current.unemploymentRate = unemp;
  if (isPoliticalApprovalCountry(countryId)) {
    // The grid trigger resolves from the national political board through the
    // same adapter mapping the corp margins use
    // (infrastructure.powerGridReliability → infrastructure.utilities, 0-100).
    // There is no stored-legacy branch ahead of this any more; the doc it read
    // has carried no political values since every country gained a board, so it
    // only ever deferred to exactly this.
    const board = await loadNationalPoliticalBoard(db, countryId);
    const adapted = board
      ? politicalValueForLegacyMetric(board, "infrastructure", "powerGridReliability")
      : null;
    if (typeof adapted === "number") current.powerGridReliability = adapted;
  }
  if (typeof federalBudget?.economicFactors?.inflationRate === "number") {
    current.inflationRate = federalBudget.economicFactors.inflationRate;
  }
  if (typeof approval?.approvalRating === "number") current.approval = approval.approvalRating;

  if (historyDoc?.economic?.gdpGrowth?.length) {
    histories.gdpGrowth = historyDoc.economic.gdpGrowth.map((p) => p.value);
  }
  if (historyDoc?.economic?.unemploymentRate?.length) {
    histories.unemploymentRate = historyDoc.economic.unemploymentRate.map((p) => p.value);
  }

  const rateHistory = exchangeRate?.rateHistory ?? [];
  const currentRate = exchangeRate?.rate;
  const fxDepreciation = (windowTurns: number): number | null => {
    if (typeof currentRate !== "number" || rateHistory.length === 0) return null;
    const past = rateHistory[Math.max(0, rateHistory.length - 1 - windowTurns)];
    if (!past || past.rate <= 0) return null;
    return ((currentRate - past.rate) / past.rate) * 100;
  };

  return { countryId, current, histories, fxDepreciation };
}

function satisfies(value: number, op: "lt" | "gt", threshold: number): boolean {
  return op === "lt" ? value < threshold : value > threshold;
}

/** Evaluate a single clause against a snapshot. */
export function evaluateClause(clause: TriggerClause, snap: NationalSnapshot): boolean {
  if (clause.metric === "fxDepreciation") {
    const dep = snap.fxDepreciation(clause.windowTurns ?? 6);
    return dep != null && satisfies(dep, clause.op, clause.threshold);
  }

  // Consecutive-turn check (history-based) where requested and available.
  if (clause.consecutiveTurns && clause.consecutiveTurns > 1) {
    const hist = snap.histories[clause.metric];
    if (!hist || hist.length < clause.consecutiveTurns) return false;
    const window = hist.slice(-clause.consecutiveTurns);
    return window.every((v) => satisfies(v, clause.op, clause.threshold));
  }

  const value = snap.current[clause.metric];
  return value != null && satisfies(value, clause.op, clause.threshold);
}

/** True when every clause in the condition holds (logical AND). */
export function evaluateCondition(condition: TriggerCondition, snap: NationalSnapshot): boolean {
  return condition.all.every((clause) => evaluateClause(clause, snap));
}
