import type { Db } from "mongodb";
import { getUKGovernmentCollection } from "@/lib/db/collections/ukGovernment";
import {
  CONFIDENCE_START,
  applyConfidenceEvent,
  tickConfidence,
  isDissolutionTriggered,
  type ConfidenceEvent,
} from "./confidenceGauge";

/**
 * Persistence + application for the UK government confidence gauge (epic #856,
 * ticket #858). Wraps the pure `confidenceGauge` arithmetic around the singleton
 * `ukGovernment` document.
 *
 * SAFETY: automatic dissolution when the gauge bottoms out is gated behind
 * `UK_CONFIDENCE_GAUGE_DISSOLUTION=1` (default off). Until then the gauge accrues
 * and persists (observable), but never itself fires a general election — the
 * irreversible consequence stays off until reviewed/enabled. `isDissolutionDue`
 * still reports the condition regardless, for surfacing.
 */

export function isConfidenceDissolutionEnabled(): boolean {
  return process.env.UK_CONFIDENCE_GAUGE_DISSOLUTION === "1";
}

/** Current gauge value (defaults to full when unset). */
export async function getConfidenceGauge(db: Db): Promise<number> {
  const gov = await getUKGovernmentCollection(db).findOne({ _id: "current" });
  return typeof gov?.confidenceGauge === "number" ? gov.confidenceGauge : CONFIDENCE_START;
}

async function writeGauge(db: Db, value: number, now: Date): Promise<void> {
  // Upsert: the legacy `ukGovernment` singleton does not exist on worlds seeded
  // after the shared parliamentary extraction, so a plain update was a silent
  // no-op and every event and tick was lost while the UI showed the default.
  await getUKGovernmentCollection(db).updateOne(
    { _id: "current" },
    { $set: { confidenceGauge: value, confidenceGaugeUpdatedAt: now, updatedAt: now } },
    { upsert: true }
  );
}

export interface GaugeUpdate {
  value: number;
  dissolutionDue: boolean;
  /** True only when dissolution is due AND auto-dissolution is enabled. */
  dissolutionEnabled: boolean;
}

/** Apply a one-off confidence event and persist. */
export async function applyConfidenceEventToGov(
  db: Db,
  event: ConfidenceEvent,
  now: Date
): Promise<GaugeUpdate> {
  const current = await getConfidenceGauge(db);
  const value = applyConfidenceEvent(current, event);
  await writeGauge(db, value, now);
  const dissolutionDue = isDissolutionTriggered(value);
  return {
    value,
    dissolutionDue,
    dissolutionEnabled: dissolutionDue && isConfidenceDissolutionEnabled(),
  };
}

/** Per-turn drift from approval + broken-promise meter; persist. */
export async function tickConfidenceForGov(
  db: Db,
  opts: { approval: number; brokenPromiseMeter?: number; now: Date }
): Promise<GaugeUpdate> {
  const current = await getConfidenceGauge(db);
  const value = tickConfidence(current, opts);
  await writeGauge(db, value, opts.now);
  const dissolutionDue = isDissolutionTriggered(value);
  return {
    value,
    dissolutionDue,
    dissolutionEnabled: dissolutionDue && isConfidenceDissolutionEnabled(),
  };
}

/** Reset the gauge to full — call when a new government forms. */
export async function resetConfidenceGauge(db: Db, now: Date): Promise<void> {
  await writeGauge(db, CONFIDENCE_START, now);
}
