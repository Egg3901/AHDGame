/**
 * Population receipts finish one world turn's vectors, totals and readouts once.
 * freezeAndApplyDemographicFlowPlan freezes all regions before publishing a receipt;
 * resumeDemographicFlowReceipt completes partial writes without recomputing flows.
 */
import { randomUUID } from "node:crypto";
import type { Db, Filter } from "mongodb";
import type { AgeSexVector } from "./cohortVector";
import {
  demographicFlowBatchId,
  demographicRecoveryDecision,
  type DemographicFlowReceiptStatus,
} from "./rules/flowReceipt";

export const DEMOGRAPHIC_FLOW_RECEIPTS = "demographicFlowReceipts";
export const DEMOGRAPHIC_FLOW_PROJECTIONS = "demographicFlowProjections";
export const DEMOGRAPHIC_FLOW_PENDING_INDEX = "demographic_flow_pending_epoch_turn";
export const DEMOGRAPHIC_FLOW_PLAN_REGION_INDEX = "demographic_flow_plan_region_unique";

const STAMP_FIELD = "populationFlowStamp";

export interface DemographicFlowStats {
  regionsProcessed: number;
  circuitBreakerTrips: number;
}

export interface DemographicFlowStateProjection {
  population: number;
  votingEligiblePopulation: number;
  workingAgePopulation: number;
  militaryServicePopulation: number;
}

export interface DemographicFlowMetricsProjection {
  realizedMigrationRate: number;
  populationGrowth: number;
  medianAge: number;
  sexRatio: number;
  dependencyRatio: number;
  demographicDecline: number;
}

export interface DemographicFlowRegionInput {
  regionId: string;
  agesAfter: AgeSexVector;
  stateAfter: DemographicFlowStateProjection;
  metricsAfter: DemographicFlowMetricsProjection;
}

export type DemographicFlowRegionProjection = DemographicFlowRegionInput;

export interface DemographicFlowReceipt {
  _id: string;
  worldEpochId: string;
  turn: number;
  planId: string;
  status: DemographicFlowReceiptStatus;
  expectedRegionCount: number;
  stats: DemographicFlowStats;
  createdAt: Date;
  completedAt?: Date;
}

export interface DemographicFlowProjection extends DemographicFlowRegionInput {
  _id: string;
  planId: string;
  worldEpochId: string;
  turn: number;
  createdAt: Date;
}

interface FlowStamp {
  worldEpochId: string;
  turn: number;
  batchId: string;
}

interface StampedTarget {
  _id: string;
  populationFlowStamp?: FlowStamp;
}

function isDuplicateKey(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === 11000
  );
}

function assertEpochId(worldEpochId: string): void {
  if (typeof worldEpochId !== "string" || worldEpochId.trim().length === 0) {
    throw new Error("A non-empty world epoch ID is required");
  }
}

function assertTurn(turn: number): void {
  if (!Number.isSafeInteger(turn) || turn < 1)
    throw new Error("A positive integer turn is required");
}

function assertFiniteRecord(record: object, label: string): void {
  for (const [key, value] of Object.entries(record)) {
    if (typeof value !== "number" || !Number.isFinite(value))
      throw new Error(`${label}.${key} must be finite`);
  }
}

function freezeRegionInput(input: DemographicFlowRegionInput): DemographicFlowRegionInput {
  if (!input.regionId) throw new Error("A region ID is required");
  if (
    input.agesAfter.male.length !== 101 ||
    input.agesAfter.female.length !== 101 ||
    [...input.agesAfter.male, ...input.agesAfter.female].some(
      (cell) => !Number.isFinite(cell) || cell < 0
    )
  ) {
    throw new Error(`Invalid age/sex vector for ${input.regionId}`);
  }
  assertFiniteRecord(input.stateAfter, `stateAfter(${input.regionId})`);
  assertFiniteRecord(input.metricsAfter, `metricsAfter(${input.regionId})`);
  if (Object.values(input.stateAfter).some((value) => value < 0)) {
    throw new Error(`Invalid demographic projection for ${input.regionId}`);
  }
  return {
    regionId: input.regionId,
    agesAfter: { male: [...input.agesAfter.male], female: [...input.agesAfter.female] },
    stateAfter: { ...input.stateAfter },
    metricsAfter: { ...input.metricsAfter },
  };
}

function assertStats(stats: DemographicFlowStats): void {
  assertFiniteRecord(stats, "stats");
  if (stats.regionsProcessed < 0 || stats.circuitBreakerTrips < 0) {
    throw new Error("Demographic flow stats must be non-negative");
  }
}

async function assertCurrentEpoch(db: Db, worldEpochId: string): Promise<void> {
  const gameState = await db
    .collection<{ _id: string; worldEpochId?: string }>("gameState")
    .findOne({ _id: "current" }, { projection: { worldEpochId: 1 } });
  if (gameState?.worldEpochId !== worldEpochId) {
    throw new Error("Demographic flow receipt belongs to a different or missing world epoch");
  }
}

function projectionFilter(
  regionId: string,
  worldEpochId: string,
  turn: number
): Filter<StampedTarget> {
  return {
    _id: regionId,
    $or: [
      { [STAMP_FIELD]: { $exists: false } },
      { [`${STAMP_FIELD}.worldEpochId`]: { $ne: worldEpochId } },
      {
        [`${STAMP_FIELD}.worldEpochId`]: worldEpochId,
        [`${STAMP_FIELD}.turn`]: { $lt: turn },
      },
    ],
  } as Filter<StampedTarget>;
}

function alreadyApplied(stamp: FlowStamp | undefined, receipt: DemographicFlowReceipt): boolean {
  return (
    stamp?.worldEpochId === receipt.worldEpochId &&
    stamp.turn === receipt.turn &&
    stamp.batchId === receipt._id
  );
}

function assertNoLaterOrConflictingStamp(
  stamp: FlowStamp | undefined,
  receipt: DemographicFlowReceipt,
  target: string
): void {
  if (stamp?.worldEpochId !== receipt.worldEpochId) return;
  if (stamp.turn > receipt.turn) {
    throw new Error(`Refusing stale demographic flow receipt for ${target}`);
  }
  if (stamp.turn === receipt.turn && stamp.batchId !== receipt._id) {
    throw new Error(`Conflicting demographic flow receipt stamp for ${target}`);
  }
}

async function loadProjectionDocs(
  db: Db,
  receipt: DemographicFlowReceipt
): Promise<DemographicFlowProjection[] | null> {
  const rows = await db
    .collection<DemographicFlowProjection>(DEMOGRAPHIC_FLOW_PROJECTIONS)
    .find({ planId: receipt.planId, worldEpochId: receipt.worldEpochId, turn: receipt.turn })
    .toArray();
  if (rows.length !== receipt.expectedRegionCount) {
    const latest = await db
      .collection<DemographicFlowReceipt>(DEMOGRAPHIC_FLOW_RECEIPTS)
      .findOne({ _id: receipt._id });
    // A concurrent replay may complete and discard its bulky vectors after
    // this caller read the ready header. Completed metadata remains authoritative.
    if (latest?.status === "complete") return null;
    throw new Error(
      `Demographic flow plan ${receipt.planId} has ${rows.length} projections; expected ${receipt.expectedRegionCount}`
    );
  }
  const ids = new Set(rows.map((row) => row.regionId));
  if (ids.size !== rows.length)
    throw new Error(`Duplicate region in demographic flow plan ${receipt.planId}`);
  return rows;
}

async function readTargetMap(
  db: Db,
  collectionName: string,
  regionIds: string[]
): Promise<Map<string, StampedTarget>> {
  const rows = await db
    .collection<StampedTarget>(collectionName)
    .find({ _id: { $in: regionIds } })
    .project<StampedTarget>({ _id: 1, [STAMP_FIELD]: 1 })
    .toArray();
  return new Map(rows.map((row) => [row._id, row]));
}

async function materializeReceipt(
  db: Db,
  receipt: DemographicFlowReceipt
): Promise<DemographicFlowReceipt> {
  await assertCurrentEpoch(db, receipt.worldEpochId);
  if (receipt.status === "complete") {
    // Completed metadata is enough for replay. Do not retain full age vectors
    // for every turn; a retry also finishes cleanup after a cleanup failure.
    await db.collection(DEMOGRAPHIC_FLOW_PROJECTIONS).deleteMany({ planId: receipt.planId });
    return receipt;
  }
  const projections = await loadProjectionDocs(db, receipt);
  if (projections === null) {
    const latest = await db
      .collection<DemographicFlowReceipt>(DEMOGRAPHIC_FLOW_RECEIPTS)
      .findOne({ _id: receipt._id });
    if (latest?.status !== "complete") throw new Error("Population completion metadata changed");
    return materializeReceipt(db, latest);
  }
  const regionIds = projections.map((projection) => projection.regionId);
  const [demographics, states, metrics] = await Promise.all([
    readTargetMap(db, "regionDemographics", regionIds),
    readTargetMap(db, "states", regionIds),
    readTargetMap(db, "macroMetrics", regionIds),
  ]);
  for (const projection of projections) {
    const id = projection.regionId;
    for (const [collectionName, rows] of [
      ["regionDemographics", demographics],
      ["states", states],
      ["macroMetrics", metrics],
    ] as const) {
      const target = rows.get(id);
      if (!target) throw new Error(`Missing ${collectionName} target for region ${id}`);
      assertNoLaterOrConflictingStamp(
        target.populationFlowStamp,
        receipt,
        `${collectionName}/${id}`
      );
    }
  }

  const stamp: FlowStamp = {
    worldEpochId: receipt.worldEpochId,
    turn: receipt.turn,
    batchId: receipt._id,
  };
  const demographicOps = projections
    .filter(
      (projection) =>
        !alreadyApplied(demographics.get(projection.regionId)?.populationFlowStamp, receipt)
    )
    .map((projection) => ({
      updateOne: {
        filter: projectionFilter(projection.regionId, receipt.worldEpochId, receipt.turn),
        update: {
          $set: {
            ages: projection.agesAfter,
            lastUpdated: receipt.createdAt,
            [STAMP_FIELD]: stamp,
          },
        },
      },
    }));
  const stateOps = projections
    .filter(
      (projection) => !alreadyApplied(states.get(projection.regionId)?.populationFlowStamp, receipt)
    )
    .map((projection) => ({
      updateOne: {
        filter: projectionFilter(projection.regionId, receipt.worldEpochId, receipt.turn),
        update: {
          $set: {
            ...projection.stateAfter,
            lastUpdated: receipt.createdAt,
            [STAMP_FIELD]: stamp,
          },
        },
      },
    }));
  const metricOps = projections
    .filter(
      (projection) =>
        !alreadyApplied(metrics.get(projection.regionId)?.populationFlowStamp, receipt)
    )
    .map((projection) => ({
      updateOne: {
        filter: projectionFilter(projection.regionId, receipt.worldEpochId, receipt.turn),
        update: {
          $set: {
            "population.realizedMigrationRate.value": projection.metricsAfter.realizedMigrationRate,
            "population.populationGrowth.value": projection.metricsAfter.populationGrowth,
            "population.medianAge.value": projection.metricsAfter.medianAge,
            "population.sexRatio.value": projection.metricsAfter.sexRatio,
            "population.dependencyRatio.value": projection.metricsAfter.dependencyRatio,
            "population.demographicDecline.value": projection.metricsAfter.demographicDecline,
            lastUpdated: receipt.createdAt,
            [STAMP_FIELD]: stamp,
          },
        },
      },
    }));

  if (demographicOps.length)
    await db.collection("regionDemographics").bulkWrite(demographicOps, { ordered: true });
  if (stateOps.length) await db.collection("states").bulkWrite(stateOps, { ordered: true });
  if (metricOps.length) await db.collection("macroMetrics").bulkWrite(metricOps, { ordered: true });

  const [confirmedDemographics, confirmedStates, confirmedMetrics] = await Promise.all([
    readTargetMap(db, "regionDemographics", regionIds),
    readTargetMap(db, "states", regionIds),
    readTargetMap(db, "macroMetrics", regionIds),
  ]);
  for (const id of regionIds) {
    for (const [collectionName, rows] of [
      ["regionDemographics", confirmedDemographics],
      ["states", confirmedStates],
      ["macroMetrics", confirmedMetrics],
    ] as const) {
      if (!alreadyApplied(rows.get(id)?.populationFlowStamp, receipt)) {
        throw new Error(`Demographic flow write not confirmed for ${collectionName}/${id}`);
      }
    }
  }

  const completedAt = new Date();
  const result = await db
    .collection<DemographicFlowReceipt>(DEMOGRAPHIC_FLOW_RECEIPTS)
    .updateOne(
      { _id: receipt._id, status: "ready", planId: receipt.planId },
      { $set: { status: "complete", completedAt } }
    );
  if (result.matchedCount > 0) {
    await db.collection(DEMOGRAPHIC_FLOW_PROJECTIONS).deleteMany({ planId: receipt.planId });
    return { ...receipt, status: "complete", completedAt };
  }
  const latest = await db
    .collection<DemographicFlowReceipt>(DEMOGRAPHIC_FLOW_RECEIPTS)
    .findOne({ _id: receipt._id });
  if (latest?.status === "complete") {
    await db.collection(DEMOGRAPHIC_FLOW_PROJECTIONS).deleteMany({ planId: latest.planId });
    return latest;
  }
  throw new Error(`Could not complete demographic flow receipt ${receipt._id}`);
}

const indexReadiness = new WeakMap<Db, Promise<void>>();

async function createJournalIndexes(db: Db): Promise<void> {
  await db
    .collection(DEMOGRAPHIC_FLOW_RECEIPTS)
    .createIndex({ worldEpochId: 1, status: 1, turn: 1 }, { name: DEMOGRAPHIC_FLOW_PENDING_INDEX });
  await db
    .collection(DEMOGRAPHIC_FLOW_PROJECTIONS)
    .createIndex(
      { planId: 1, regionId: 1 },
      { name: DEMOGRAPHIC_FLOW_PLAN_REGION_INDEX, unique: true }
    );
}

export async function ensureDemographicFlowJournalIndexes(db: Db): Promise<void> {
  let pending = indexReadiness.get(db);
  if (!pending) {
    pending = createJournalIndexes(db).catch((error) => {
      indexReadiness.delete(db);
      throw error;
    });
    indexReadiness.set(db, pending);
  }
  await pending;
}

export async function loadDemographicFlowReceipt(
  db: Db,
  worldEpochId: string,
  turn: number
): Promise<DemographicFlowReceipt | null> {
  assertEpochId(worldEpochId);
  assertTurn(turn);
  return db
    .collection<DemographicFlowReceipt>(DEMOGRAPHIC_FLOW_RECEIPTS)
    .findOne({ _id: demographicFlowBatchId(worldEpochId, turn) });
}

export async function resumeDemographicFlowReceipt(
  db: Db,
  worldEpochId: string,
  turn: number
): Promise<DemographicFlowStats | null> {
  assertEpochId(worldEpochId);
  assertTurn(turn);
  await assertCurrentEpoch(db, worldEpochId);
  const receipt = await loadDemographicFlowReceipt(db, worldEpochId, turn);
  if (!receipt) return null;
  const completed = await materializeReceipt(db, receipt);
  return completed.stats;
}

export async function resumePendingDemographicFlowReceipts(
  db: Db,
  worldEpochId: string,
  throughTurn?: number
): Promise<DemographicFlowStats[]> {
  assertEpochId(worldEpochId);
  if (throughTurn !== undefined) assertTurn(throughTurn);
  await assertCurrentEpoch(db, worldEpochId);
  await ensureDemographicFlowJournalIndexes(db);
  const filter: Record<string, unknown> = { worldEpochId, status: "ready" };
  if (throughTurn !== undefined) filter.turn = { $lte: throughTurn };
  const receipts = await db
    .collection<DemographicFlowReceipt>(DEMOGRAPHIC_FLOW_RECEIPTS)
    .find(filter)
    .sort({ turn: 1 })
    .toArray();
  const stats: DemographicFlowStats[] = [];
  for (const receipt of receipts) {
    stats.push((await materializeReceipt(db, receipt)).stats);
  }
  return stats;
}

export async function freezeAndApplyDemographicFlowPlan(
  db: Db,
  input: {
    worldEpochId: string;
    turn: number;
    regions: DemographicFlowRegionInput[];
    stats: DemographicFlowStats;
  }
): Promise<DemographicFlowStats> {
  assertEpochId(input.worldEpochId);
  assertTurn(input.turn);
  assertStats(input.stats);
  await assertCurrentEpoch(db, input.worldEpochId);
  const receiptId = demographicFlowBatchId(input.worldEpochId, input.turn);
  const existing = await loadDemographicFlowReceipt(db, input.worldEpochId, input.turn);
  if (existing) return (await materializeReceipt(db, existing)).stats;

  const regions = input.regions.map(freezeRegionInput);
  if (new Set(regions.map((region) => region.regionId)).size !== regions.length) {
    throw new Error("Demographic flow plan has duplicate region IDs");
  }
  const planId = randomUUID();
  const createdAt = new Date();
  const projections: DemographicFlowProjection[] = regions.map((region) => ({
    ...region,
    _id: `${planId}:${region.regionId}`,
    planId,
    worldEpochId: input.worldEpochId,
    turn: input.turn,
    createdAt,
  }));
  if (projections.length > 0) {
    await db
      .collection<DemographicFlowProjection>(DEMOGRAPHIC_FLOW_PROJECTIONS)
      .insertMany(projections);
  }

  const receipt: DemographicFlowReceipt = {
    _id: receiptId,
    worldEpochId: input.worldEpochId,
    turn: input.turn,
    planId,
    status: "ready",
    expectedRegionCount: projections.length,
    stats: { ...input.stats },
    createdAt,
  };
  try {
    await db.collection<DemographicFlowReceipt>(DEMOGRAPHIC_FLOW_RECEIPTS).insertOne(receipt);
  } catch (error) {
    if (!isDuplicateKey(error)) throw error;
    const winner = await loadDemographicFlowReceipt(db, input.worldEpochId, input.turn);
    if (!winner)
      throw new Error(`Lost demographic flow publisher race without a winner: ${receiptId}`);
    if (winner.planId !== planId && projections.length > 0) {
      await db
        .collection<DemographicFlowProjection>(DEMOGRAPHIC_FLOW_PROJECTIONS)
        .deleteMany({ planId });
    }
    return (await materializeReceipt(db, winner)).stats;
  }
  return (await materializeReceipt(db, receipt)).stats;
}

export { demographicFlowBatchId, demographicRecoveryDecision };
