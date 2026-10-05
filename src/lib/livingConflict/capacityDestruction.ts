/**
 * Conflict outcomes that promise physical destruction write one obligation per
 * damaged region. The metric engine folds destruction and repair into
 * `states.capitalStock`; the sovereign's national budget carries the repair
 * cost on the same schedule (`loadCapacityRepairSpending`).
 */
import type { Db } from "mongodb";
import type { Crisis, GlobalResponseOutcome } from "@/lib/db/types/crisis";
import type { GameState } from "@/lib/db/types/gameState";
import type { State } from "@/lib/db/types/state";
import type {
  CapacityDestructionSummary,
  ConflictCapacityObligation,
} from "@/lib/db/types/conflictCapacity";
import { seedCapitalStock } from "@/lib/metricEngine/capitalStock";
import {
  annualRepairSpendingAt,
  outstandingCapitalAt,
  planCapacityDestruction,
  type CapacityRegionInput,
} from "./rules/capacityDestruction";

export const CONFLICT_CAPACITY_OBLIGATIONS = "conflictCapacityObligations";

const indexReadiness = new WeakMap<Db, Promise<void>>();
async function ensureCapacityIndexes(db: Db): Promise<void> {
  let ready = indexReadiness.get(db);
  if (!ready) {
    ready = db
      .collection<ConflictCapacityObligation>(CONFLICT_CAPACITY_OBLIGATIONS)
      .createIndex({ status: 1, createdTurn: 1 }, { name: "capacity_status_turn" })
      .then(() => undefined)
      .catch((error) => {
        indexReadiness.delete(db);
        throw error;
      });
    indexReadiness.set(db, ready);
  }
  await ready;
}

function clockTurn(
  world: Pick<GameState, "currentTurn" | "isProcessing" | "processingTargetTurn">
) {
  const turn =
    world.isProcessing === true
      ? (world.processingTargetTurn ?? world.currentTurn)
      : world.currentTurn;
  if (!Number.isSafeInteger(turn) || turn < 1)
    throw new Error("Capacity destruction requires a valid game clock");
  return turn;
}

function summarize(obligations: readonly ConflictCapacityObligation[]) {
  return {
    regions: obligations.map((obligation) => ({
      regionId: obligation.regionId,
      ...(obligation.regionName ? { regionName: obligation.regionName } : {}),
      countryId: obligation.countryIdAtDestruction,
      destroyedCapital: obligation.destroyedCapital,
      obligationId: obligation._id,
    })),
    skipped: [] as CapacityDestructionSummary["skipped"],
    realizedFraction: Math.max(0, ...obligations.map((obligation) => obligation.realizedFraction)),
  } satisfies CapacityDestructionSummary;
}

/**
 * Destroy the capital an outcome promises, exactly once per resolution. A retry
 * finds the obligations by their deterministic ids and inserts nothing.
 */
export async function applyConflictCapacityDestruction(
  db: Db,
  crisis: Crisis,
  outcome: GlobalResponseOutcome,
  resolutionId: string
): Promise<CapacityDestructionSummary | undefined> {
  const spec = outcome.capacityDestruction;
  const conflictKey = crisis.globalResponse?.conflictKey;
  if (!spec || !conflictKey) return undefined;
  await ensureCapacityIndexes(db);
  const obligations = db.collection<ConflictCapacityObligation>(CONFLICT_CAPACITY_OBLIGATIONS);
  const existing = await obligations.find({ resolutionId, conflictKey }).toArray();
  if (existing.length > 0 && existing.length >= spec.regions.length) return summarize(existing);

  const world = await db
    .collection<GameState>("gameState")
    .findOne(
      { _id: "current" },
      { projection: { currentTurn: 1, isProcessing: 1, processingTargetTurn: 1 } }
    );
  if (!world) return undefined;
  const turn = clockTurn(world);
  const regionIds = spec.regions.map((region) => region.regionId);
  const [states, priorObligations] = await Promise.all([
    db
      .collection<State>("states")
      .find(
        { _id: { $in: regionIds } },
        { projection: { _id: 1, name: 1, countryId: 1, gdp: 1, capitalStock: 1 } }
      )
      .toArray(),
    obligations.find({ regionId: { $in: regionIds }, status: "repairing" }).toArray(),
  ]);
  const inputs: CapacityRegionInput[] = states.map((state) => ({
    regionId: state._id,
    regionName: state.name,
    countryId: state.countryId,
    capitalStock: state.capitalStock ?? seedCapitalStock(state.gdp ?? 0),
    outstandingCapital: outstandingCapitalAt(
      priorObligations.filter(
        (prior) => prior.regionId === state._id && prior.resolutionId !== resolutionId
      ),
      turn
    ),
  }));
  const plan = planCapacityDestruction({ spec, conflictKey, resolutionId, regions: inputs });
  const now = new Date();
  if (plan.obligations.length > 0) {
    await obligations.bulkWrite(
      plan.obligations.map((planned) => ({
        updateOne: {
          filter: { _id: planned._id },
          update: {
            $setOnInsert: {
              conflictKey,
              outcomeId: outcome.outcomeId,
              outcomeLabel: outcome.label,
              resolutionId,
              regionId: planned.regionId,
              ...(planned.regionName ? { regionName: planned.regionName } : {}),
              countryIdAtDestruction: planned.countryIdAtDestruction,
              createdTurn: turn,
              capitalStockBefore: planned.capitalStockBefore,
              destroyedCapital: planned.destroyedCapital,
              realizedFraction: plan.summary.realizedFraction,
              repairTurns: spec.repairTurns,
              repairCostMultiplier: spec.repairCostMultiplier,
              status: "repairing" as const,
              createdAt: now,
              updatedAt: now,
            },
          },
          upsert: true,
        },
      })),
      { ordered: false }
    );
  }
  return plan.summary;
}

/** Fraction of an outcome's authored destruction that landed on modeled regions. */
export async function loadRealizedCapacityFraction(
  db: Db,
  conflictKey: string,
  resolutionId: string
): Promise<number> {
  const rows = await db
    .collection<ConflictCapacityObligation>(CONFLICT_CAPACITY_OBLIGATIONS)
    .find({ conflictKey, resolutionId }, { projection: { realizedFraction: 1 } })
    .toArray();
  return Math.max(0, ...rows.map((row) => row.realizedFraction));
}

/** Obligations still repairing at `turn`, for the metric engine's capital fold. */
export async function loadRepairingCapacityObligations(
  db: Db,
  turn: number
): Promise<ConflictCapacityObligation[]> {
  return db
    .collection<ConflictCapacityObligation>(CONFLICT_CAPACITY_OBLIGATIONS)
    .find({ status: "repairing", createdTurn: { $lte: turn } })
    .toArray();
}

/** Mark obligations whose destruction and full repair are in the stock. */
export async function settleCapacityObligations(db: Db, ids: readonly string[]): Promise<void> {
  if (ids.length === 0) return;
  await db
    .collection<ConflictCapacityObligation>(CONFLICT_CAPACITY_OBLIGATIONS)
    .updateMany(
      { _id: { $in: [...ids] }, status: "repairing" },
      { $set: { status: "repaired", updatedAt: new Date() } }
    );
}

/**
 * Annualized repair spending by paying country. The payer is the region's
 * sovereign now, so a region that changed hands is repaired by its new owner.
 * One projected obligation read and one projected state read per budget sweep.
 */
export async function loadCapacityRepairSpending(db: Db): Promise<Record<string, number>> {
  // Most worlds carry no obligations; the common case costs one empty read.
  const rows = await db
    .collection<ConflictCapacityObligation>(CONFLICT_CAPACITY_OBLIGATIONS)
    .find(
      { status: "repairing" },
      {
        projection: {
          regionId: 1,
          countryIdAtDestruction: 1,
          createdTurn: 1,
          destroyedCapital: 1,
          repairTurns: 1,
          repairCostMultiplier: 1,
        },
      }
    )
    .toArray();
  if (rows.length === 0) return {};
  const world = await db
    .collection<GameState>("gameState")
    .findOne(
      { _id: "current" },
      { projection: { currentTurn: 1, isProcessing: 1, processingTargetTurn: 1 } }
    );
  if (!world) return {};
  const turn = clockTurn(world);
  const owners = await db
    .collection<State>("states")
    .find(
      { _id: { $in: [...new Set(rows.map((row) => row.regionId))] } },
      { projection: { _id: 1, countryId: 1 } }
    )
    .toArray();
  const sovereignByRegion = new Map(owners.map((state) => [state._id, state.countryId as string]));
  const byCountry: Record<string, number> = {};
  for (const row of rows) {
    const payer = sovereignByRegion.get(row.regionId) ?? row.countryIdAtDestruction;
    const annual = annualRepairSpendingAt(row, turn);
    if (annual > 0) byCountry[payer] = (byCountry[payer] ?? 0) + annual;
  }
  return byCountry;
}
