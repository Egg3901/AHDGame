import type { Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { PoliticalMetricsDoc } from "@/lib/db/types/politicalMetrics";
import type { PoliticalMetricId } from "@/lib/politicalMetrics/types";
import { hashToUint32 } from "@/lib/events/substrate/rng";

export const HIGH_TENSION_EVENT_KINDS = new Set([
  "worldEvents.panicBuying",
  "worldEvents.bankRun",
  "worldEvents.civilDefenseFever",
  "worldEvents.warScareProtests",
]);

export const HIGH_TENSION_SHARED_LEDGER_KIND = "worldEvents.highTensionShared";
export const HIGH_TENSION_STAGGER_MIN_TURNS = 3;
export const HIGH_TENSION_STAGGER_MAX_TURNS = 6;

export function isHighTensionSocietyEvent(kind: string): boolean {
  return HIGH_TENSION_EVENT_KINDS.has(kind);
}

/**
 * One crisis lands every three to six turns before mitigation. Emergency
 * measures add at most four turns, keeping the sequence common while giving
 * governments a meaningful way to buy breathing room.
 */
export function highTensionSharedGapTurns(
  countryId: string,
  lastFiredTurn: number,
  mitigationPct: number
): number {
  const span = HIGH_TENSION_STAGGER_MAX_TURNS - HIGH_TENSION_STAGGER_MIN_TURNS + 1;
  const base =
    HIGH_TENSION_STAGGER_MIN_TURNS +
    (hashToUint32(`highTensionStagger:${countryId}:${lastFiredTurn}`) % span);
  const mitigationTurns = Math.min(4, Math.floor(Math.max(0, mitigationPct) / 10));
  return base + mitigationTurns;
}

export function isHighTensionSharedDue(
  currentTurn: number,
  countryId: string,
  lastFiredTurn: number | undefined,
  mitigationPct: number
): boolean {
  if (lastFiredTurn == null) return true;
  return (
    currentTurn >=
    lastFiredTurn + highTensionSharedGapTurns(countryId, lastFiredTurn, mitigationPct)
  );
}

/**
 * These are the exact inputs to Governance Style's democratic-health score.
 * Moving every member by the same amount moves the weighted basket by that
 * amount before the separate party-competition penalty is applied.
 */
export const DEMOCRATIC_HEALTH_METRIC_IDS = [
  "governance.participation",
  "governance.openness",
  "governance.integrity",
  "governance.administration",
  "order.dueProcess",
  "order.courts",
  "order.communityTrust",
  "order.safety",
  "society.civicLife",
] as const satisfies readonly PoliticalMetricId[];

const clampMetric = (value: number): number => Math.max(0, Math.min(100, value));

/**
 * Civil-liberties decisions alter both current scores and structural residuals.
 * The latter is the political-metrics engine's documented future-event hook,
 * so the cost persists instead of vanishing on the next dynamics turn.
 */
export async function applyCivilLibertiesDelta(
  db: Db,
  countryId: CountryId,
  delta: number
): Promise<number> {
  if (delta === 0) return 0;
  const docs = await db
    .collection<PoliticalMetricsDoc>("politicalMetrics")
    .find({ countryId })
    .toArray();
  if (docs.length === 0) return 0;

  const now = new Date();
  const operations = docs.map((doc) => {
    const values = { ...doc.values };
    const residuals = { ...(doc.residuals ?? {}) } as Record<PoliticalMetricId, number>;
    for (const metricId of DEMOCRATIC_HEALTH_METRIC_IDS) {
      const previous = values[metricId];
      if (typeof previous !== "number" || !Number.isFinite(previous)) continue;
      const next = clampMetric(previous + delta);
      const applied = next - previous;
      values[metricId] = next;
      residuals[metricId] = (residuals[metricId] ?? 0) + applied;
    }
    return {
      updateOne: {
        filter: { _id: doc._id },
        update: { $set: { values, residuals, lastUpdated: now } },
      },
    };
  });
  await db.collection<PoliticalMetricsDoc>("politicalMetrics").bulkWrite(operations);
  return operations.length;
}
