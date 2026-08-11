import { ObjectId, type Db, type AnyBulkWriteOperation } from "mongodb";
import type { ProspectingSurvey } from "@/lib/db/types/prospectingSurvey";
import type { StateResourceCapacity } from "@/lib/db/types/stateResourceCapacity";
import type { Corporation } from "@/lib/db/types/corporation";
import type { NotificationInput } from "@/lib/notifications";
import { createNotifications } from "@/lib/notifications";
import { getProspectingSurveysCollection } from "@/lib/db/collections/prospectingSurveys";
import { getStateResourceCapacityCollection } from "@/lib/db/collections/stateResourceCapacity";
import { makeSeededRng } from "@/lib/events/substrate/rng";
import {
  PROSPECT_GOVT_SUCCESS_CHANCE,
  PROSPECT_GOVT_RD_MULT,
  PROSPECT_YIELD_MIN,
  PROSPECT_YIELD_MAX,
  PROSPECT_MAX_GAIN_FRACTION,
  prospectCorpSuccessChance,
  prospectEraScaling,
  prospectCorpRdMult,
} from "@/lib/constants/prospecting";

export interface ResolveProspectsResult {
  surveysResolved: number;
  succeeded: number;
  failed: number;
  totalCapacityAdded: number;
}

/** Factory that turns a seed string into a deterministic [0,1) stream. */
type RngFactory = (seed: string) => () => number;

/**
 * Resolve every active prospecting survey whose `completesTurn <= turn`.
 *
 * Determinism: each survey draws from its own seeded stream keyed on the survey
 * id + turn, so resolution order and neighbouring surveys never affect the
 * outcome (replay-safe, matches the "never Math.random in turn paths" rule).
 * Tests inject `rngFactory` to force a success/failure.
 *
 * Success grows the state's per-resource capacity by
 * currentCap × uniform(0.03,0.08) × rdMult, hard-capped at 20% of current
 * capacity. Capacity docs are NEVER created here: if the cap doc or the
 * resource entry has vanished (or is 0), the survey still resolves but adds
 * nothing (fail-safe), consistent with the rdInnovation convention.
 *
 * Emits notifications only; the survey cost was charged at launch, so this phase
 * emits nothing financial.
 */
export async function resolveProspects(
  db: Db,
  turn: number,
  now: Date,
  rngFactory: RngFactory = makeSeededRng,
  /**
   * Live in-game year. Scales success and yield in opposite directions — see
   * `prospectEraScaling`. Omitted/null (era clock off) = neutral, so an existing
   * world resolves exactly as before.
   */
  year: number | null = null
): Promise<ResolveProspectsResult> {
  const era = prospectEraScaling(year);
  const surveysCol = await getProspectingSurveysCollection(db);
  const dueSurveys = await surveysCol
    .find({ status: "active", completesTurn: { $lte: turn } })
    .toArray();

  const result: ResolveProspectsResult = {
    surveysResolved: 0,
    succeeded: 0,
    failed: 0,
    totalCapacityAdded: 0,
  };
  if (dueSurveys.length === 0) return result;

  // Load capacity docs for the involved states (keyed by stateId|countryId).
  const capCol = await getStateResourceCapacityCollection(db);
  const stateIds = [...new Set(dueSurveys.map((s) => s.stateId))];
  const capDocs = await capCol.find({ stateId: { $in: stateIds } }).toArray();
  const capByKey = new Map<string, StateResourceCapacity>();
  for (const doc of capDocs) capByKey.set(`${doc.stateId}|${doc.countryId}`, doc);

  // Load corp docs (corp survey notifications go to the CEO's user, like
  // rdInnovation) — the launcher may have since changed.
  const corpIds = dueSurveys
    .filter((s) => s.initiatorType === "corporation" && s.corporationId)
    .map((s) => s.corporationId as ObjectId);
  const corpById = new Map<string, Corporation>();
  if (corpIds.length > 0) {
    const corps = await db
      .collection<Corporation>("corporations")
      .find({ _id: { $in: corpIds } }, { projection: { userId: 1, name: 1 } })
      .toArray();
    for (const c of corps) corpById.set(c._id.toString(), c);
  }

  // stateId|countryId → resource → accumulated $inc (stack multiple wins in the
  // same state before writing to avoid $inc op collisions).
  const capIncByKey = new Map<string, Record<string, number>>();
  const surveyBulk: AnyBulkWriteOperation<ProspectingSurvey>[] = [];
  const notifications: NotificationInput[] = [];

  for (const survey of dueSurveys) {
    const rng = rngFactory(`prospect:${survey._id.toString()}:${turn}`);
    const isCorp = survey.initiatorType === "corporation";
    const rdScore = survey.rdScoreAtStart ?? 0;
    const baseChance = isCorp ? prospectCorpSuccessChance(rdScore) : PROSPECT_GOVT_SUCCESS_CHANCE;
    // Clamped: an era multiplier must never make a survey a certainty or an
    // impossibility, whatever the anchors are later tuned to.
    const chance = Math.max(0.01, Math.min(0.99, baseChance * era.success));
    const success = rng() < chance;

    let capacityGained = 0;
    if (success) {
      const key = `${survey.stateId}|${survey.countryId}`;
      const currentCap = capByKey.get(key)?.resources?.[survey.resource] ?? 0;
      if (currentCap > 0) {
        const yieldFraction =
          (PROSPECT_YIELD_MIN + rng() * (PROSPECT_YIELD_MAX - PROSPECT_YIELD_MIN)) * era.yield;
        const rdMult = isCorp ? prospectCorpRdMult(rdScore) : PROSPECT_GOVT_RD_MULT;
        const rawGain = currentCap * yieldFraction * rdMult;
        // The cap scales with the era too. Without this, a strong corp in 1953
        // (rdMult up to 2× on a 1.6× era yield) clips at the modern 20% ceiling
        // and the era bonus is silently erased for exactly the players most
        // able to earn it.
        const maxGain = currentCap * PROSPECT_MAX_GAIN_FRACTION * era.yield;
        capacityGained = Math.round(Math.min(rawGain, maxGain));
      }
      if (capacityGained > 0) {
        const inc = capIncByKey.get(key) ?? {};
        inc[`resources.${survey.resource}`] =
          (inc[`resources.${survey.resource}`] ?? 0) + capacityGained;
        capIncByKey.set(key, inc);
      }
    }

    surveyBulk.push({
      updateOne: {
        filter: { _id: survey._id },
        update: {
          $set: {
            status: success ? "succeeded" : "failed",
            capacityGained,
            resolvedTurn: turn,
            updatedAt: now,
          },
        },
      },
    });

    result.surveysResolved += 1;
    if (success) {
      result.succeeded += 1;
      result.totalCapacityAdded += capacityGained;
    } else {
      result.failed += 1;
    }

    const recipient = resolveRecipientUserId(survey, corpById);
    if (recipient) {
      notifications.push(buildNotification(survey, success, capacityGained, recipient));
    }
  }

  // Apply capacity growth (one updateOne per state with all resource $incs).
  const capBulk: AnyBulkWriteOperation<StateResourceCapacity>[] = [];
  for (const [key, inc] of capIncByKey) {
    const [stateId, countryId] = key.split("|");
    capBulk.push({
      updateOne: {
        filter: { stateId, countryId: countryId as StateResourceCapacity["countryId"] },
        update: { $inc: inc, $set: { updatedAt: now } },
      },
    });
  }
  if (capBulk.length > 0) await capCol.bulkWrite(capBulk);
  if (surveyBulk.length > 0) await surveysCol.bulkWrite(surveyBulk);
  if (notifications.length > 0) await createNotifications(notifications);

  return result;
}

function resolveRecipientUserId(
  survey: ProspectingSurvey,
  corpById: Map<string, Corporation>
): ObjectId | null {
  if (survey.initiatorType === "corporation" && survey.corporationId) {
    const corp = corpById.get(survey.corporationId.toString());
    if (corp?.userId) return corp.userId;
  }
  if (survey.initiatorUserId && ObjectId.isValid(survey.initiatorUserId)) {
    return new ObjectId(survey.initiatorUserId);
  }
  return null;
}

function buildNotification(
  survey: ProspectingSurvey,
  success: boolean,
  capacityGained: number,
  userId: ObjectId
): NotificationInput {
  const metadata = {
    surveyId: survey._id.toString(),
    stateId: survey.stateId,
    countryId: survey.countryId,
    resource: survey.resource,
    initiatorType: survey.initiatorType,
    capacityGained,
  };
  if (success) {
    return {
      userId,
      type: "prospect_succeeded",
      title: "Geological Survey Succeeded",
      message: `The survey for ${survey.resource} in ${survey.stateId} struck new deposits, expanding extractable capacity by ${capacityGained.toLocaleString()} units per turn.`,
      metadata,
    };
  }
  return {
    userId,
    type: "prospect_failed",
    title: "Geological Survey Failed",
    message: `The survey for ${survey.resource} in ${survey.stateId} came up dry. No new capacity was found.`,
    metadata,
  };
}
