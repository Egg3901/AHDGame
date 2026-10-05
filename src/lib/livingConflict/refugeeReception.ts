/**
 * Humanitarian responses durably authorize conserved reception and initial services.
 * prepareRefugeeReceptionOrder freezes a leader's permission and cost before the response
 * claim; materializeRefugeeReceptionResults records actual arrivals without another cash debit.
 */
import { ObjectId, type Db } from "mongodb";
import type { Crisis, CrisisDecisionOption, CrisisInteraction } from "@/lib/db/types/crisis";
import type { FederalBudget, EnactedLaw } from "@/lib/db/types/budget";
import type { GameState } from "@/lib/db/types/gameState";
import type { State } from "@/lib/db/types/state";
import type { LivingConflictState } from "./types";
import { NATIONAL_SCOPE_IDS } from "@/lib/constants/nationalScope";
import { COUNTRY_CONFIGS } from "@/lib/constants/countries";
import { ensureDemographicWorldEpoch } from "@/lib/demographics/worldEpoch";
import {
  REFUGEE_ADMISSION_LAW_IDS,
  refugeeAdmissionAuthorization,
  refugeeServiceCostsByCountry,
  type RefugeeReceptionOrder,
  type RefugeeReceptionResult,
} from "./rules/refugeeReception";

export const REFUGEE_RECEPTION_HISTORY = "refugeeReceptionHistory";
interface RefugeeReceptionHistory extends RefugeeReceptionResult {
  batchId: string;
  createdAt: Date;
}

const indexReadiness = new WeakMap<Db, Promise<void>>();

export async function ensureRefugeeReceptionIndexes(db: Db): Promise<void> {
  let ready = indexReadiness.get(db);
  if (!ready) {
    ready = (async () => {
      await db
        .collection<CrisisInteraction>("crisisInteractions")
        .createIndex(
          { populationOrderEpochId: 1, populationOrdersPending: 1 },
          { name: "crisis_population_orders_pending" }
        );
      await db
        .collection<RefugeeReceptionHistory>(REFUGEE_RECEPTION_HISTORY)
        .createIndex(
          { worldEpochId: 1, serviceEndTurn: 1, destinationCountryId: 1 },
          { name: "refugee_services_world_country_expiry" }
        );
    })().catch((error) => {
      indexReadiness.delete(db);
      throw error;
    });
    indexReadiness.set(db, ready);
  }
  await ready;
}

export async function prepareRefugeeReceptionOrder(
  db: Db,
  crisis: Crisis,
  interaction: CrisisInteraction,
  countryId: string,
  option: CrisisDecisionOption,
  nodeId: string
): Promise<RefugeeReceptionOrder | undefined> {
  const spec = option.refugeeReception;
  if (!spec) return undefined;
  if (
    spec.originCountryId === countryId ||
    !spec.originCountryId ||
    !Number.isFinite(spec.hostPopulationShare) ||
    spec.hostPopulationShare <= 0 ||
    spec.hostPopulationShare > 0.02 ||
    !Number.isFinite(spec.annualServiceGdpPerCapitaShare) ||
    spec.annualServiceGdpPerCapitaShare <= 0 ||
    spec.annualServiceGdpPerCapitaShare > 1 ||
    !Number.isSafeInteger(spec.serviceDurationTurns) ||
    spec.serviceDurationTurns < 1 ||
    spec.serviceDurationTurns > 480
  )
    throw new Error("Invalid authored refugee reception");
  const [gameState, states, conflict, budget, laws] = await Promise.all([
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
        { countryId: countryId as State["countryId"] },
        { projection: { _id: 1, population: 1 } }
      )
      .toArray(),
    db
      .collection<LivingConflictState>("livingConflicts")
      .findOne(
        { defKey: spec.conflictKey },
        { projection: { hasOpened: 1, status: 1, tracks: 1 } }
      ),
    db
      .collection<FederalBudget>("federalBudget")
      .findOne(
        { countryId: countryId as FederalBudget["countryId"] },
        { projection: { gdp: 1, gdpSmoothed: 1 } }
      ),
    db
      .collection<EnactedLaw>("enactedLaws")
      .find(
        {
          scope: "national",
          repealedAt: { $exists: false },
          legislationTypeId: { $in: [...REFUGEE_ADMISSION_LAW_IDS] },
          ...(countryId === COUNTRY_CONFIGS.US.id
            ? { $or: [{ countryId }, { countryId: { $exists: false } }] }
            : { countryId }),
        },
        { projection: { legislationTypeId: 1, policyOptionIndex: 1, enactedAt: 1 } }
      )
      .toArray(),
  ]);
  if (gameState?.livingConflictsEnabled !== true) return undefined;
  if (!Number.isSafeInteger(gameState.currentTurn) || gameState.currentTurn < 1)
    throw new Error("Refugee reception requires a valid game clock");
  const population = states
    .filter((state) => !NATIONAL_SCOPE_IDS.has(state._id))
    .reduce((sum, state) => sum + (state.population ?? 0), 0);
  const gdp = budget?.gdpSmoothed && budget.gdpSmoothed > 0 ? budget.gdpSmoothed : budget?.gdp;
  if (
    !Number.isFinite(population) ||
    !(population > 0) ||
    typeof gdp !== "number" ||
    !Number.isFinite(gdp) ||
    !(gdp > 0)
  )
    throw new Error("Refugee reception requires the host's population and fiscal base");
  const worldEpochId = await ensureDemographicWorldEpoch(db, gameState);
  const effectiveTurn = Math.max(
    gameState.currentTurn + 1,
    gameState.isProcessing === true
      ? (gameState.processingTargetTurn ?? gameState.currentTurn) + 1
      : 1
  );
  const authorization = refugeeAdmissionAuthorization(
    laws.map((law) => ({
      legislationTypeId: law.legislationTypeId,
      policyOptionIndex: law.policyOptionIndex,
      enactedAt: law.enactedAt instanceof Date ? law.enactedAt.getTime() : Number.NaN,
    }))
  );
  authorization.displacementActive =
    conflict?.hasOpened === true &&
    conflict.status !== "closed" &&
    Number.isFinite(conflict.tracks?.displacement) &&
    (conflict.tracks?.displacement ?? 0) > 0;
  return {
    _id: `${worldEpochId}:${interaction._id.toString()}:${countryId}:${nodeId}:${option.optionId}:refugees`,
    worldEpochId,
    interactionId: interaction._id.toString(),
    crisisId: crisis._id.toString(),
    nodeId,
    optionId: option.optionId,
    originCountryId: spec.originCountryId,
    destinationCountryId: countryId,
    effectiveTurn,
    // This decision opens an initial corridor for one response window.
    expiresTurn: effectiveTurn + 24,
    requestedPeople: population * spec.hostPopulationShare,
    annualServiceCostPerPerson: (gdp / population) * spec.annualServiceGdpPerCapitaShare,
    serviceDurationTurns: spec.serviceDurationTurns,
    authorization,
    status: "pending",
  };
}

/** The response claim is the durable outbox, including when the HTTP request exits afterward. */
export async function loadPendingRefugeeReceptions(
  db: Db,
  worldEpochId: string,
  turn: number,
  enabled: boolean
): Promise<RefugeeReceptionOrder[]> {
  if (!enabled) return [];
  await ensureRefugeeReceptionIndexes(db);
  const interactions = await db
    .collection<CrisisInteraction>("crisisInteractions")
    .find(
      {
        populationOrderEpochId: worldEpochId,
        populationOrdersPending: true,
      },
      { projection: { leaderResponses: 1 } }
    )
    .limit(2001)
    .toArray();
  if (interactions.length > 2000)
    throw new Error("Refugee response backlog exceeds the safe batch limit");
  return interactions.flatMap((interaction) =>
    (interaction.leaderResponses ?? []).flatMap((response) => {
      const order = response.refugeeReceptionOrder;
      return order?.status === "pending" &&
        order.worldEpochId === worldEpochId &&
        order.effectiveTurn <= turn
        ? [order]
        : [];
    })
  );
}

/** Frozen population results and their fiscal obligation finish before the flow receipt completes. */
export async function materializeRefugeeReceptionResults(
  db: Db,
  results: readonly RefugeeReceptionResult[],
  batchId: string,
  createdAt: Date
): Promise<void> {
  if (!results.length) return;
  await ensureRefugeeReceptionIndexes(db);
  await db.collection<RefugeeReceptionHistory>(REFUGEE_RECEPTION_HISTORY).bulkWrite(
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
    .collection<RefugeeReceptionHistory>(REFUGEE_RECEPTION_HISTORY)
    .find(
      {
        _id: { $in: results.map((result) => result._id) },
        batchId,
      },
      { projection: { _id: 1 } }
    )
    .toArray();
  if (recorded.length !== results.length)
    throw new Error("Refugee reception history write was not confirmed");
  const completed = await db.collection<CrisisInteraction>("crisisInteractions").bulkWrite(
    results.map((result) => ({
      updateOne: {
        filter: {
          _id: new ObjectId(result.interactionId),
          populationOrderEpochId: result.worldEpochId,
          "leaderResponses.refugeeReceptionOrder._id": result._id,
        },
        update: {
          $set: {
            "leaderResponses.$[response].refugeeReceptionOrder.status": "complete",
            "leaderResponses.$[response].refugeeReceptionResult": result,
          },
        },
        arrayFilters: [{ "response.refugeeReceptionOrder._id": result._id }],
      },
    })),
    { ordered: true }
  );
  if (completed.matchedCount !== results.length)
    throw new Error("Refugee reception response completion was not confirmed");
  await db.collection<CrisisInteraction>("crisisInteractions").updateMany(
    {
      _id: {
        $in: [...new Set(results.map((result) => result.interactionId))].map(
          (id) => new ObjectId(id)
        ),
      },
      populationOrdersPending: true,
      leaderResponses: { $not: { $elemMatch: { "refugeeReceptionOrder.status": "pending" } } },
    },
    { $set: { populationOrdersPending: false } }
  );
}

/** One world read and one projected obligation read, shared by the national budget sweep. */
export async function loadRefugeeServiceCosts(db: Db): Promise<Record<string, number>> {
  const world = await db
    .collection<GameState>("gameState")
    .findOne(
      { _id: "current" },
      { projection: { worldEpochId: 1, currentTurn: 1, isProcessing: 1, processingTargetTurn: 1 } }
    );
  if (!world?.worldEpochId) return {};
  const turn =
    world.isProcessing === true
      ? (world.processingTargetTurn ?? world.currentTurn)
      : world.currentTurn;
  if (!Number.isSafeInteger(turn) || turn < 1)
    throw new Error("Refugee service costing requires a valid turn");
  const obligations = await db
    .collection<RefugeeReceptionHistory>(REFUGEE_RECEPTION_HISTORY)
    .find(
      {
        worldEpochId: world.worldEpochId,
        appliedTurn: { $lte: turn },
        serviceEndTurn: { $gt: turn },
      },
      {
        projection: {
          _id: 1,
          worldEpochId: 1,
          destinationCountryId: 1,
          appliedTurn: 1,
          serviceEndTurn: 1,
          annualServiceCost: 1,
        },
      }
    )
    .toArray();
  return refugeeServiceCostsByCountry(obligations, world.worldEpochId, turn);
}
