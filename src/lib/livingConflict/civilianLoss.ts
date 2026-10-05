/**
 * Outcome claims durably authorize explicit civilian mortality under the turn owner.
 * prepareConflictCivilianLossOrder freezes territory and quantity before the resolution CAS;
 * materializeConflictCivilianLossResults finishes history after frozen population writes.
 */
import { ObjectId, type Db } from "mongodb";
import type { Crisis, CrisisInteraction, GlobalResponseOutcome } from "@/lib/db/types/crisis";
import type { GameState } from "@/lib/db/types/gameState";
import type { State } from "@/lib/db/types/state";
import { NATIONAL_SCOPE_IDS } from "@/lib/constants/nationalScope";
import { ensureDemographicWorldEpoch } from "@/lib/demographics/worldEpoch";
import {
  requestedConflictCivilianLoss,
  type ConflictCivilianLossOrder,
  type ConflictCivilianLossResult,
} from "./rules/civilianLoss";

export const CONFLICT_CIVILIAN_LOSS_HISTORY = "conflictCivilianLossHistory";
interface CivilianLossHistory extends ConflictCivilianLossResult {
  batchId: string;
  createdAt: Date;
}

const indexReadiness = new WeakMap<Db, Promise<void>>();
async function ensureCivilianLossIndexes(db: Db): Promise<void> {
  let ready = indexReadiness.get(db);
  if (!ready) {
    ready = db
      .collection<CrisisInteraction>("crisisInteractions")
      .createIndex(
        { civilianLossEpochId: 1, civilianLossPending: 1 },
        { name: "crisis_civilian_loss_pending" }
      )
      .then(() => undefined)
      .catch((error) => {
        indexReadiness.delete(db);
        throw error;
      });
    indexReadiness.set(db, ready);
  }
  await ready;
}

export async function prepareConflictCivilianLossOrder(
  db: Db,
  crisis: Crisis,
  interaction: CrisisInteraction,
  outcome: GlobalResponseOutcome
): Promise<ConflictCivilianLossOrder | undefined> {
  const spec = outcome.civilianLoss;
  if (!spec) return undefined;
  if (crisis.globalResponse?.roleByCountry[spec.countryId] !== "belligerent")
    throw new Error("Invalid authored civilian loss");
  requestedConflictCivilianLoss(spec, 0);
  const [world, states] = await Promise.all([
    db.collection<GameState>("gameState").findOne(
      { _id: "current" },
      {
        projection: {
          worldEpochId: 1,
          currentTurn: 1,
          isProcessing: 1,
          processingTargetTurn: 1,
          livingConflictsEnabled: 1,
        },
      }
    ),
    db
      .collection<State>("states")
      .find(
        { countryId: spec.countryId as State["countryId"] },
        { projection: { _id: 1, population: 1 } }
      )
      .toArray(),
  ]);
  if (world?.livingConflictsEnabled !== true) return undefined;
  if (!Number.isSafeInteger(world.currentTurn) || world.currentTurn < 1)
    throw new Error("Civilian loss requires a valid game clock");
  const real = states.filter((state) => !NATIONAL_SCOPE_IDS.has(state._id));
  if (real.some((state) => !Number.isFinite(state.population) || state.population < 0))
    throw new Error("Civilian loss requires finite regional population");
  const worldEpochId = await ensureDemographicWorldEpoch(db, world);
  return {
    _id: `${worldEpochId}:${interaction._id.toString()}:${outcome.outcomeId}:civilian-loss`,
    worldEpochId,
    interactionId: interaction._id.toString(),
    crisisId: crisis._id.toString(),
    outcomeId: outcome.outcomeId,
    countryId: spec.countryId,
    regionIds: real.map((state) => state._id).sort(),
    requestedPeople: requestedConflictCivilianLoss(
      spec,
      real.reduce((sum, state) => sum + state.population, 0)
    ),
    effectiveTurn: Math.max(
      world.currentTurn + 1,
      world.isProcessing === true ? (world.processingTargetTurn ?? world.currentTurn) + 1 : 1
    ),
    status: "pending",
  };
}

export async function loadPendingConflictCivilianLosses(
  db: Db,
  worldEpochId: string,
  turn: number,
  enabled: boolean
): Promise<ConflictCivilianLossOrder[]> {
  if (!enabled) return [];
  await ensureCivilianLossIndexes(db);
  const interactions = await db
    .collection<CrisisInteraction>("crisisInteractions")
    .find(
      { civilianLossEpochId: worldEpochId, civilianLossPending: true },
      { projection: { "globalResponseOutcome.civilianLossOrder": 1 } }
    )
    .limit(2001)
    .toArray();
  if (interactions.length > 2000)
    throw new Error("Civilian loss backlog exceeds the safe batch limit");
  return interactions.flatMap((interaction) => {
    const order = interaction.globalResponseOutcome?.civilianLossOrder;
    return order?.status === "pending" &&
      order.worldEpochId === worldEpochId &&
      order.effectiveTurn <= turn
      ? [order]
      : [];
  });
}

export async function materializeConflictCivilianLossResults(
  db: Db,
  results: readonly ConflictCivilianLossResult[],
  batchId: string,
  createdAt: Date
): Promise<void> {
  if (!results.length) return;
  await db.collection<CivilianLossHistory>(CONFLICT_CIVILIAN_LOSS_HISTORY).bulkWrite(
    results.map((result) => ({
      updateOne: {
        filter: { _id: result._id, batchId },
        update: { $setOnInsert: { ...result, batchId, createdAt } },
        upsert: true,
      },
    })),
    { ordered: true }
  );
  const recorded = await db
    .collection<CivilianLossHistory>(CONFLICT_CIVILIAN_LOSS_HISTORY)
    .find(
      { _id: { $in: results.map((result) => result._id) }, batchId },
      { projection: { _id: 1 } }
    )
    .toArray();
  if (recorded.length !== results.length)
    throw new Error("Civilian loss history was not confirmed");
  const completed = await db.collection<CrisisInteraction>("crisisInteractions").bulkWrite(
    results.map((result) => ({
      updateOne: {
        filter: {
          _id: new ObjectId(result.interactionId),
          civilianLossEpochId: result.worldEpochId,
          "globalResponseOutcome.civilianLossOrder._id": result._id,
        },
        update: {
          $set: {
            "globalResponseOutcome.civilianLossOrder.status": "complete",
            "globalResponseOutcome.civilianLossResult": result,
            civilianLossPending: false,
          },
        },
      },
    })),
    { ordered: true }
  );
  if (completed.matchedCount !== results.length)
    throw new Error("Civilian loss outcome completion was not confirmed");
}
