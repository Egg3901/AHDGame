import type { Db } from "mongodb";
import { getUKGovernmentCollection } from "@/lib/db/collections/ukGovernment";
import { getGameStateCollection } from "@/lib/db/collections/gameState";
import type { UKGovernmentConfidencePoint } from "@/lib/countries/uk/db/governmentTypes";
import { getCountryConfig, getHeadOfGovernmentOfficeKey } from "@/lib/constants/countries";
import { expectationsRampTurns } from "@/lib/country/rules/approvalHoneymoon";
import {
  CONFIDENCE_START,
  applyConfidenceEvent,
  confidenceAfterGovernmentFormation,
  confidenceErosionScale,
  tickConfidence,
  isDissolutionTriggered,
  type ConfidenceEvent,
} from "@/lib/countries/uk/confidence/confidenceGauge";

const MAX_CONFIDENCE_HISTORY_POINTS = 500;

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
  const gov = await getUKGovernmentCollection(db).findOne(
    { _id: "current" },
    { projection: { confidenceGauge: 1 } }
  );
  return typeof gov?.confidenceGauge === "number" ? gov.confidenceGauge : CONFIDENCE_START;
}

export async function getConfidenceGaugeHistory(db: Db): Promise<UKGovernmentConfidencePoint[]> {
  const gov = await getUKGovernmentCollection(db).findOne(
    { _id: "current" },
    { projection: { confidenceGaugeHistory: 1 } }
  );
  return (gov?.confidenceGaugeHistory ?? []).slice(-MAX_CONFIDENCE_HISTORY_POINTS);
}

async function currentTurn(db: Db): Promise<number | null> {
  const state = await (
    await getGameStateCollection(db)
  ).findOne({ _id: "current" }, { projection: { currentTurn: 1 } });
  return typeof state?.currentTurn === "number" ? state.currentTurn : null;
}

async function writeGauge(
  db: Db,
  value: number,
  now: Date,
  reason: string,
  turn?: number
): Promise<void> {
  // Upsert: the legacy `ukGovernment` singleton does not exist on worlds seeded
  // after the shared parliamentary extraction, so a plain update was a silent
  // no-op and every event and tick was lost while the UI showed the default.
  await getUKGovernmentCollection(db).updateOne(
    { _id: "current" },
    {
      $set: { confidenceGauge: value, confidenceGaugeUpdatedAt: now, updatedAt: now },
      $push: {
        confidenceGaugeHistory: {
          $each: [
            {
              turn: typeof turn === "number" ? turn : await currentTurn(db),
              value,
              at: now,
              reason,
            },
          ],
          $slice: -MAX_CONFIDENCE_HISTORY_POINTS,
        },
      },
    },
    { upsert: true }
  );
}

export interface GaugeUpdate {
  value: number;
  dissolutionDue: boolean;
  /** True only when dissolution is due AND auto-dissolution is enabled. */
  dissolutionEnabled: boolean;
}

/** Match the public expectations ramp when scaling UK confidence erosion. */
export function getUkConfidenceErosionScale(
  sinceTurn: number | null | undefined,
  currentTurn: number | null | undefined,
  preset?: string
): number {
  const countryConfig = getCountryConfig("UK", preset);
  const headOffice = countryConfig.officeTypes.find(
    (office) => office.key === getHeadOfGovernmentOfficeKey("UK", preset)
  );
  return confidenceErosionScale(
    sinceTurn,
    currentTurn,
    expectationsRampTurns(headOffice, countryConfig.lowerElectionSystem)
  );
}

/** Apply a one-off confidence event and persist. */
export async function applyConfidenceEventToGov(
  db: Db,
  event: ConfidenceEvent,
  now: Date,
  turn?: number
): Promise<GaugeUpdate> {
  const current = await getConfidenceGauge(db);
  const value = applyConfidenceEvent(current, event);
  await writeGauge(db, value, now, event.kind, turn);
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
  opts: {
    approval: number;
    brokenPromiseMeter?: number;
    erosionScale?: number;
    now: Date;
    turn?: number;
  }
): Promise<GaugeUpdate> {
  const current = await getConfidenceGauge(db);
  const value = tickConfidence(current, opts);
  await writeGauge(db, value, opts.now, "turn", opts.turn);
  const dissolutionDue = isDissolutionTriggered(value);
  return {
    value,
    dissolutionDue,
    dissolutionEnabled: dissolutionDue && isConfidenceDissolutionEnabled(),
  };
}

/** Carry the predecessor's standing into the new government and add a modest formation bonus. */
export async function resetConfidenceGauge(db: Db, now: Date, turn?: number): Promise<number> {
  const previous = await getConfidenceGauge(db);
  const value = confidenceAfterGovernmentFormation(previous);
  await writeGauge(db, value, now, "governmentFormed", turn);
  return value;
}
