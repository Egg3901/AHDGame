import type { Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import { getGovernmentFormationsCollection } from "@/lib/db/collections/governmentFormation";
import { getUKGovernmentCollection } from "@/lib/db/collections/ukGovernment";
import { getGameStateCollection } from "@/lib/db/collections/gameState";
import type { GovernmentConfidencePoint } from "@/lib/db/types/governmentFormation";
import type { GovernmentApproval } from "@/lib/db/types/governmentApproval";
import {
  COUNTRY_CONFIGS,
  getCountryConfig,
  getHeadOfGovernmentOfficeKey,
} from "@/lib/constants/countries";
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
 * Persistence + application for parliamentary-government confidence. Wraps
 * the pure gauge arithmetic around the canonical per-country government doc.
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
export async function getConfidenceGauge(
  db: Db,
  countryId: CountryId = COUNTRY_CONFIGS.UK.id
): Promise<number> {
  const gov = await getGovernmentFormationsCollection(db).findOne(
    { _id: countryId },
    { projection: { confidenceGauge: 1 } }
  );
  if (typeof gov?.confidenceGauge === "number") return gov.confidenceGauge;
  // Preserve an existing UK gauge while migrating reads to the shared record.
  if (countryId === COUNTRY_CONFIGS.UK.id) {
    const legacy = await getUKGovernmentCollection(db).findOne(
      { _id: "current" },
      { projection: { confidenceGauge: 1 } }
    );
    if (typeof legacy?.confidenceGauge === "number") return legacy.confidenceGauge;
  }
  return CONFIDENCE_START;
}

export async function getConfidenceGaugeHistory(
  db: Db,
  countryId: CountryId = COUNTRY_CONFIGS.UK.id
): Promise<GovernmentConfidencePoint[]> {
  const gov = await getGovernmentFormationsCollection(db).findOne(
    { _id: countryId },
    { projection: { confidenceGaugeHistory: 1 } }
  );
  if (gov?.confidenceGaugeHistory) {
    return gov.confidenceGaugeHistory.slice(-MAX_CONFIDENCE_HISTORY_POINTS);
  }
  if (countryId === COUNTRY_CONFIGS.UK.id) {
    const legacy = await getUKGovernmentCollection(db).findOne(
      { _id: "current" },
      { projection: { confidenceGaugeHistory: 1 } }
    );
    return (legacy?.confidenceGaugeHistory ?? []).slice(-MAX_CONFIDENCE_HISTORY_POINTS);
  }
  return [];
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
  turn?: number,
  countryId: CountryId = COUNTRY_CONFIGS.UK.id
): Promise<void> {
  await getGovernmentFormationsCollection(db).updateOne(
    { _id: countryId },
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
    { upsert: false }
  );
}

export interface GaugeUpdate {
  value: number;
  dissolutionDue: boolean;
  /** True only when dissolution is due AND auto-dissolution is enabled. */
  dissolutionEnabled: boolean;
}

/** Match the public expectations ramp when scaling UK confidence erosion. */
export function getGovernmentConfidenceErosionScale(
  countryId: CountryId,
  sinceTurn: number | null | undefined,
  currentTurn: number | null | undefined,
  preset?: string
): number {
  const countryConfig = getCountryConfig(countryId, preset);
  const headOffice = countryConfig.officeTypes.find(
    (office) => office.key === getHeadOfGovernmentOfficeKey(countryId, preset)
  );
  return confidenceErosionScale(
    sinceTurn,
    currentTurn,
    expectationsRampTurns(headOffice, countryConfig.lowerElectionSystem)
  );
}

/** @deprecated Use getGovernmentConfidenceErosionScale with a country id. */
export function getUkConfidenceErosionScale(
  sinceTurn: number | null | undefined,
  currentTurn: number | null | undefined,
  preset?: string
): number {
  return getGovernmentConfidenceErosionScale("UK", sinceTurn, currentTurn, preset);
}

/** Apply a one-off confidence event and persist. */
export async function applyConfidenceEventToGov(
  db: Db,
  event: ConfidenceEvent,
  now: Date,
  turn?: number,
  countryId: CountryId = "UK"
): Promise<GaugeUpdate> {
  const current = await getConfidenceGauge(db, countryId);
  const value = applyConfidenceEvent(current, event);
  await writeGauge(db, value, now, event.kind, turn, countryId);
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
    countryId?: CountryId;
  }
): Promise<GaugeUpdate> {
  const countryId = opts.countryId ?? COUNTRY_CONFIGS.UK.id;
  const current = await getConfidenceGauge(db, countryId);
  const value = tickConfidence(current, opts);
  await writeGauge(db, value, opts.now, "turn", opts.turn, countryId);
  const dissolutionDue = isDissolutionTriggered(value);
  return {
    value,
    dissolutionDue,
    dissolutionEnabled: dissolutionDue && isConfidenceDissolutionEnabled(),
  };
}

/** Carry the predecessor's standing into the new government and add a modest formation bonus. */
export async function resetConfidenceGauge(
  db: Db,
  now: Date,
  turn?: number,
  countryId: CountryId = COUNTRY_CONFIGS.UK.id
): Promise<number> {
  const previous = await getConfidenceGauge(db, countryId);
  const value = confidenceAfterGovernmentFormation(previous);
  await writeGauge(db, value, now, "governmentFormed", turn, countryId);
  return value;
}

/**
 * Tick active parliamentary governments from one batch of approval and
 * government reads, then persist their histories with one bulk write.
 */
export async function tickParliamentaryGovernmentConfidence(
  db: Db,
  opts: { countryIds: CountryId[]; now: Date; turn: number; preset?: string }
): Promise<Array<{ countryId: CountryId; value: number }>> {
  if (opts.countryIds.length === 0) return [];
  const [governments, approvals] = await Promise.all([
    getGovernmentFormationsCollection(db)
      .find(
        { _id: { $in: opts.countryIds }, status: "formed" },
        {
          projection: {
            countryId: 1,
            confidenceGauge: 1,
            confidenceGaugeHistory: 1,
            formedTurn: 1,
          },
        }
      )
      .toArray(),
    db
      .collection<GovernmentApproval>("governmentApprovals")
      .find({ _id: { $in: opts.countryIds } }, { projection: { _id: 1, approvalRating: 1 } })
      .toArray(),
  ]);
  const approvalByCountry = new Map(approvals.map((row) => [row._id, row.approvalRating] as const));
  const updates: Array<{ countryId: CountryId; value: number }> = [];
  const operations = governments.flatMap((government) => {
    const countryId = government.countryId;
    const approval = approvalByCountry.get(countryId);
    if (typeof approval !== "number") return [];
    const value = tickConfidence(government.confidenceGauge ?? CONFIDENCE_START, {
      approval,
      erosionScale: confidenceErosionScale(
        government.formedTurn,
        opts.turn,
        expectationsRampTurns(
          getCountryConfig(countryId, opts.preset).officeTypes.find(
            (office) => office.key === getHeadOfGovernmentOfficeKey(countryId, opts.preset)
          ),
          getCountryConfig(countryId, opts.preset).lowerElectionSystem
        )
      ),
    });
    updates.push({ countryId, value });
    const history = (government.confidenceGaugeHistory ?? []).slice(-MAX_CONFIDENCE_HISTORY_POINTS);
    const point: GovernmentConfidencePoint = {
      turn: opts.turn,
      value,
      at: opts.now,
      reason: "turn",
    };
    return [
      {
        updateOne: {
          filter: { _id: countryId },
          update: {
            $set: {
              confidenceGauge: value,
              confidenceGaugeUpdatedAt: opts.now,
              confidenceGaugeHistory: [...history, point].slice(-MAX_CONFIDENCE_HISTORY_POINTS),
              updatedAt: opts.now,
            },
          },
        },
      },
    ];
  });
  if (operations.length > 0) {
    await getGovernmentFormationsCollection(db).bulkWrite(operations, { ordered: false });
  }
  return updates;
}
