/**
 * Promote one freshly reset 1991-default live world to the verified v2 metrics,
 * legislation, and Cabinet openings.
 *
 * This is deliberately a manual incident-style migration rather than a registry
 * migration. It targets exactly one reset world and must never run at deploy.
 *
 * Safety contract:
 *   - Connects only through MONGODB_URI_LIVE.
 *   - Defaults to a read-only dry-run.
 *   - Apply requires --confirm-world=<current resetWorldId>.
 *   - Apply requires turn 1 and a stopped, non-processing world.
 *   - All opening boards are written and verified before v2 is activated.
 *   - A failed seed leaves the v1 runtime active and can be retried.
 *
 * Usage:
 *   npx tsx scripts/migrations/2026-10-04-promote-fresh-reset-to-v2.ts
 *   npx tsx scripts/migrations/2026-10-04-promote-fresh-reset-to-v2.ts \
 *     --apply --confirm-world=<resetWorldId> --actor=<admin>
 */

import path from "node:path";
import dotenv from "dotenv";
import { MongoClient, type Db, type Filter } from "mongodb";
import type { StateBudget } from "@/lib/db/types/budget";
import type { GameState } from "@/lib/db/types/gameState";
import type { State } from "@/lib/db/types/state";
import { resolveMongoDbName } from "@/lib/mongodb";
import { buildOpeningRegionalBoards1991 } from "@/lib/resetFinance/openingRegionalBoards1991";
import { buildOpeningDepartmentBoards1991 } from "@/lib/resetFinance/openingDepartmentBoards1991";
import { seedOpeningDepartmentBoards1991 } from "@/lib/resetFinance/seedOpeningDepartments1991";
import { buildOpeningLawBoards1991 } from "@/lib/resetLegislation/openingBoards1991";
import { seedOpeningLawBoards1991 } from "@/lib/resetLegislation/seedOpening1991";
import {
  buildOpeningMetricSnapshots1991,
  seedOpeningMetrics1991,
} from "@/lib/resetMetrics/seedOpening1991";
import {
  RESET_SYSTEMS,
  RESET_V2_SEED_REVISION,
  resetSeedComplete,
  type ResetSystem,
  type ResetSystemSeedReceipt,
} from "@/lib/resetVersions/rules";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const MIGRATION_ID = "2026-10-04-promote-fresh-reset-to-v2";
const GAME_STATE_ID = "current";
const SOURCE_TURN = 1;
const PRESET = "1991-default";
const EDUCATION_SEAT = "secretary_of_education";

const V2_COLLECTIONS = [
  "resetMetricSnapshots",
  "resetLawOpeningBoards",
  "resetRegionalOpeningBoards",
  "resetDepartmentOpeningBoards",
  "resetDepartmentAccounts",
  "resetDepartmentContinuity",
  "resetNationalTreasuries",
  "resetCabinetActionStates",
] as const;

export type CandidateState = Pick<
  GameState,
  | "_id"
  | "resetWorldId"
  | "currentTurn"
  | "startingYear"
  | "resetStartDate"
  | "preset"
  | "isActive"
  | "isProcessing"
  | "manuallyEnabledSeats"
  | "metricsSystemVersion"
  | "legislationSystemVersion"
  | "cabinetSystemVersion"
  | "resetVersionSeeds"
>;

export interface PromotionInspection {
  status: "ready" | "already-promoted" | "blocked";
  worldId?: string;
  currentTurn?: number;
  reasons: string[];
  expectedRows?: {
    metricBoards: number;
    lawBoards: number;
    regionalFiscalBoards: number;
    departmentBoards: number;
  };
}

export interface PromotionResult extends PromotionInspection {
  mode: "dry-run" | "applied" | "no-op";
  receipts?: Partial<Record<ResetSystem, ResetSystemSeedReceipt>>;
}

export interface PromotionDependencies {
  inspect(db: Db): Promise<PromotionInspection>;
  seedMetrics(db: Db, worldId: string, sourceTurn: number): Promise<ResetSystemSeedReceipt>;
  seedLegislation(db: Db, worldId: string, sourceTurn: number): Promise<ResetSystemSeedReceipt>;
  seedCabinet(db: Db, worldId: string, sourceTurn: number): Promise<ResetSystemSeedReceipt>;
  now(): Date;
}

const DEFAULT_DEPENDENCIES: PromotionDependencies = {
  inspect: inspectFreshResetV2Promotion,
  seedMetrics: seedOpeningMetrics1991,
  seedLegislation: seedOpeningLawBoards1991,
  seedCabinet: seedOpeningDepartmentBoards1991,
  now: () => new Date(),
};

function rawVersion(state: CandidateState, system: ResetSystem): unknown {
  if (system === "metrics") return state.metricsSystemVersion;
  if (system === "legislation") return state.legislationSystemVersion;
  return state.cabinetSystemVersion;
}

export function assessFreshResetV2Candidate(state: CandidateState | null): PromotionInspection {
  if (!state) return { status: "blocked", reasons: ["gameState/current does not exist"] };

  const worldId = typeof state.resetWorldId === "string" ? state.resetWorldId.trim() : "";
  const fullyPromoted = RESET_SYSTEMS.every(
    (system) => rawVersion(state, system) === "v2" && resetSeedComplete(state, system)
  );
  if (fullyPromoted) {
    return {
      status: "already-promoted",
      worldId: worldId || undefined,
      currentTurn: state.currentTurn,
      reasons: [],
    };
  }

  const reasons: string[] = [];
  if (!worldId) reasons.push("gameState.resetWorldId is missing");
  if (state.preset !== PRESET) reasons.push(`preset must be ${PRESET}`);
  if (state.startingYear !== 1991) reasons.push("startingYear must be 1991");
  if (state.resetStartDate?.year !== 1991 || state.resetStartDate?.week !== 1) {
    reasons.push("resetStartDate must be 1991, week 1");
  }
  if (state.currentTurn !== SOURCE_TURN) reasons.push("currentTurn must still be 1");
  if (state.isActive) reasons.push("turn processing must be stopped (isActive=false)");
  if (state.isProcessing) reasons.push("a turn is currently processing");
  if (!state.manuallyEnabledSeats?.includes(EDUCATION_SEAT)) {
    reasons.push(`manuallyEnabledSeats must include ${EDUCATION_SEAT}`);
  }

  const partialVersions = RESET_SYSTEMS.filter((system) => rawVersion(state, system) === "v2");
  const existingReceipts = RESET_SYSTEMS.filter(
    (system) => state.resetVersionSeeds?.[system] != null
  );
  if (partialVersions.length > 0 || existingReceipts.length > 0) {
    reasons.push(
      "world has a partial or inconsistent v2 activation; investigate it instead of overwriting it"
    );
  }

  for (const system of RESET_SYSTEMS) {
    const version = rawVersion(state, system);
    if (version !== undefined && version !== "v1" && version !== "v2") {
      reasons.push(`${system} system version is malformed`);
    }
  }

  return {
    status: reasons.length === 0 ? "ready" : "blocked",
    worldId: worldId || undefined,
    currentTurn: state.currentTurn,
    reasons,
  };
}

function sameSortedValues(actual: string[], expected: string[]): boolean {
  return JSON.stringify([...actual].sort()) === JSON.stringify([...expected].sort());
}

async function inspectCatalogPrerequisites(
  db: Db,
  worldId: string
): Promise<Pick<PromotionInspection, "expectedRows" | "reasons">> {
  const metricBoards = buildOpeningMetricSnapshots1991(worldId, SOURCE_TURN);
  const lawBoards = buildOpeningLawBoards1991(worldId, SOURCE_TURN);
  const regionalFiscalBoards = buildOpeningRegionalBoards1991(worldId, SOURCE_TURN);
  const departmentBoards = buildOpeningDepartmentBoards1991(worldId, SOURCE_TURN);
  const regions = await db
    .collection<State>("states")
    .find({ countryId: { $in: ["US", "UK", "JP"] } }, { projection: { _id: 1, countryId: 1 } })
    .toArray();
  const actualRegionIds = regions.map((region) => `${region.countryId}:${region._id}`);
  const metricRegionIds = metricBoards
    .filter((board) => board.scope === "regional")
    .map((board) => board._id);
  const lawRegionIds = lawBoards
    .filter((board) => board.scope === "regional")
    .map((board) => board._id);
  const fiscalRegionIds = regionalFiscalBoards.map((board) => board._id);
  const reasons: string[] = [];

  if (!sameSortedValues(actualRegionIds, metricRegionIds)) {
    reasons.push("seeded regions do not match the v2 metrics catalog");
  }
  if (!sameSortedValues(actualRegionIds, lawRegionIds)) {
    reasons.push("seeded regions do not match the v2 legislation catalog");
  }
  if (!sameSortedValues(actualRegionIds, fiscalRegionIds)) {
    reasons.push("seeded regions do not match the v2 regional finance catalog");
  }

  const ukBudgets = await db
    .collection<StateBudget>("stateBudgets")
    .find(
      { countryId: "UK" },
      {
        projection: {
          stateId: 1,
          countryId: 1,
          "revenue.propertyTax": 1,
          "revenue.domesticCorporateTax": 1,
          "revenue.foreignCorporateTax": 1,
        },
      }
    )
    .toArray();
  const expectedUk = lawBoards.filter((board) => board.ukTerritorialTax);
  const ukByRegion = new Map(ukBudgets.map((budget) => [budget.stateId, budget]));
  if (ukBudgets.length !== expectedUk.length || ukByRegion.size !== expectedUk.length) {
    reasons.push("seeded UK budgets do not match the v2 territorial tax catalog");
  } else {
    for (const board of expectedUk) {
      const budget = ukByRegion.get(board.regionId!);
      const revenue = budget?.revenue;
      const actualProxy =
        (revenue?.propertyTax ?? Number.NaN) +
        (revenue?.domesticCorporateTax ?? Number.NaN) +
        (revenue?.foreignCorporateTax ?? Number.NaN);
      if (
        budget?.countryId !== board.countryId ||
        !Number.isFinite(actualProxy) ||
        Math.abs(actualProxy - board.ukTerritorialTax!.sourceOwnRevenueProxy) > 0.01
      ) {
        reasons.push(`UK territorial tax proxy differs for ${board.regionId}`);
      }
    }
  }

  for (const collectionName of V2_COLLECTIONS) {
    const foreignRows = await db.collection(collectionName).countDocuments({
      $or: [{ worldId: { $ne: worldId } }, { sourceTurn: { $ne: SOURCE_TURN } }],
    });
    if (foreignRows > 0) {
      reasons.push(`${collectionName} contains ${foreignRows} row(s) from another world or turn`);
    }
  }

  return {
    reasons,
    expectedRows: {
      metricBoards: metricBoards.length,
      lawBoards: lawBoards.length,
      regionalFiscalBoards: regionalFiscalBoards.length,
      departmentBoards: departmentBoards.length,
    },
  };
}

export async function inspectFreshResetV2Promotion(db: Db): Promise<PromotionInspection> {
  const state = await db.collection<CandidateState>("gameState").findOne(
    { _id: GAME_STATE_ID },
    {
      projection: {
        resetWorldId: 1,
        currentTurn: 1,
        startingYear: 1,
        resetStartDate: 1,
        preset: 1,
        isActive: 1,
        isProcessing: 1,
        manuallyEnabledSeats: 1,
        metricsSystemVersion: 1,
        legislationSystemVersion: 1,
        cabinetSystemVersion: 1,
        resetVersionSeeds: 1,
      },
    }
  );
  const assessment = assessFreshResetV2Candidate(state);
  if (assessment.status !== "ready" || !assessment.worldId) return assessment;

  const catalog = await inspectCatalogPrerequisites(db, assessment.worldId);
  return {
    ...assessment,
    status: catalog.reasons.length === 0 ? "ready" : "blocked",
    reasons: catalog.reasons,
    expectedRows: catalog.expectedRows,
  };
}

export async function promoteFreshResetToV2(
  db: Db,
  options: { apply: boolean; confirmWorld?: string; actor?: string },
  dependencies: PromotionDependencies = DEFAULT_DEPENDENCIES
): Promise<PromotionResult> {
  const inspection = await dependencies.inspect(db);
  if (inspection.status === "already-promoted") {
    return { ...inspection, mode: "no-op" };
  }
  if (inspection.status === "blocked" || !inspection.worldId) {
    throw new Error(`V2 promotion blocked: ${inspection.reasons.join("; ")}`);
  }
  if (!options.apply) return { ...inspection, mode: "dry-run" };
  if (options.confirmWorld !== inspection.worldId) {
    throw new Error(
      `Apply requires --confirm-world=${inspection.worldId}; received ${options.confirmWorld ?? "nothing"}`
    );
  }

  const receipts = {
    metrics: await dependencies.seedMetrics(db, inspection.worldId, SOURCE_TURN),
    legislation: await dependencies.seedLegislation(db, inspection.worldId, SOURCE_TURN),
    cabinet: await dependencies.seedCabinet(db, inspection.worldId, SOURCE_TURN),
  } satisfies Record<ResetSystem, ResetSystemSeedReceipt>;
  const now = dependencies.now();
  const at = now.toISOString();
  const actor = options.actor?.trim() || `migration:${MIGRATION_ID}`;
  const stateFilter: Filter<CandidateState> = {
    _id: GAME_STATE_ID,
    resetWorldId: inspection.worldId,
    currentTurn: SOURCE_TURN,
    preset: PRESET,
    isActive: false,
    isProcessing: { $ne: true },
  };
  const updated = await db.collection<CandidateState>("gameState").updateOne(stateFilter, {
    $set: {
      metricsSystemVersion: "v2",
      legislationSystemVersion: "v2",
      cabinetSystemVersion: "v2",
      metricsSystemVersionBy: actor,
      legislationSystemVersionBy: actor,
      cabinetSystemVersionBy: actor,
      metricsSystemVersionAt: at,
      legislationSystemVersionAt: at,
      cabinetSystemVersionAt: at,
      resetSystemSelections: { metrics: "v2", legislation: "v2", cabinet: "v2" },
      resetSystemSelectionsAudit: {
        metrics: { by: actor, at },
        legislation: { by: actor, at },
        cabinet: { by: actor, at },
      },
      resetVersionSeeds: receipts,
      updatedAt: now,
    },
  });
  if (updated.matchedCount !== 1) {
    throw new Error(
      "Opening boards were seeded, but the world changed before activation. Keep turns stopped and rerun the migration."
    );
  }

  await db.collection<{ _id: string } & Record<string, unknown>>("migrationsRun").updateOne(
    { _id: `${MIGRATION_ID}:${inspection.worldId}` },
    {
      $set: {
        completedAt: now,
        markerVersion: 1,
        worldId: inspection.worldId,
        sourceTurn: SOURCE_TURN,
        actor,
        revisions: RESET_V2_SEED_REVISION,
        verificationHashes: Object.fromEntries(
          RESET_SYSTEMS.map((system) => [system, receipts[system].verificationHash])
        ),
      },
    },
    { upsert: true }
  );

  return { ...inspection, mode: "applied", receipts };
}

function argumentValue(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length);
}

async function main(): Promise<void> {
  const uri = process.env.MONGODB_URI_LIVE?.trim();
  if (!uri) throw new Error("MONGODB_URI_LIVE is not set. Refusing to use a fallback database.");

  const apply = process.argv.includes("--apply");
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 15_000 });
  await client.connect();
  try {
    const dbName = resolveMongoDbName({
      MONGODB_URI: uri,
      MONGODB_DB: process.env.MONGODB_DB,
      MONGO_DB_NAME: process.env.MONGO_DB_NAME,
    });
    const result = await promoteFreshResetToV2(client.db(dbName), {
      apply,
      confirmWorld: argumentValue("confirm-world"),
      actor: argumentValue("actor"),
    });
    console.log(JSON.stringify(result, null, 2));
    if (!apply && result.status === "ready") {
      console.log(
        `\nDry-run only. To apply, stop turns and rerun with --apply --confirm-world=${result.worldId}`
      );
    }
  } finally {
    await client.close();
  }
}

if (require.main === module) {
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
