import type { Db } from "mongodb";
import type { NuclearProgram } from "@/lib/db/types/nuclearProgram";
import type { GameState } from "@/lib/db/types/gameState";
import type { LivingConflictState } from "@/lib/livingConflict/types";
import { allLivingConflictDefs } from "@/lib/livingConflict/registry";
import { emptyConflictState } from "@/lib/livingConflict/engine";
import { normalizeCampaignState } from "@/lib/livingConflict/campaign";
import { DEFAULT_ADOPTED, DEFAULT_POINTS, keyOf } from "@/lib/military/doctrineTree";
import { tensionPressureBreakdown } from "@/lib/coldwar/tension";
import {
  historicalAdoptedNodes,
  historicalWarheads,
  seedNuclearPrograms,
} from "@/lib/admin/seed/seedNuclearPrograms";

const NUCLEAR_DELIVERY_DOCTRINE_KEY = keyOf("strat", 5);

export interface ColdWarFoundationResult {
  programsInserted: number;
  doctrineRowsInserted: number;
  doctrineRowsUpdated: number;
  conflictsInserted: number;
  campaignsUpdated: number;
  tensionInserted: boolean;
}

type BaselineProgram = Omit<NuclearProgram, "updatedAt">;
type TensionSeedDocument = {
  _id: string;
  value: number;
  updatedTurn: number;
  events: unknown[];
  updatedAt: Date;
};

/** Game-scaled historical starting arsenals. Counts are balance units, not literal inventories. */
export function nuclearProgramBaselines(year: number): BaselineProgram[] {
  return (["US", "RU", "UK"] as const)
    .map((countryId) => ({
      _id: countryId,
      adopted: historicalAdoptedNodes(countryId, year),
      warheads: historicalWarheads(countryId, year),
      productionRate: 0,
    }))
    .filter((program) => Object.keys(program.adopted).length > 0);
}

/**
 * Establish the release 1.3 runtime baseline for fresh worlds and legacy worlds.
 * Every write is missing-only except the release flags, which this rollout enables.
 */
export async function seedColdWarFoundations(
  db: Db,
  year: number,
  turn: number,
  opts: { dryRun?: boolean } = {}
): Promise<ColdWarFoundationResult> {
  const baselines = nuclearProgramBaselines(year);
  const programIds = baselines.map((program) => program._id);
  const existingPrograms = await db
    .collection<NuclearProgram>("nuclearPrograms")
    .find({}, { projection: { _id: 1, adopted: 1, warheads: 1 } })
    .toArray();
  const existingProgramByCountry = new Map(
    existingPrograms.map((program) => [program._id, program])
  );
  const missingPrograms = baselines.filter((program) => {
    const existing = existingProgramByCountry.get(program._id);
    return !existing || Object.keys(existing.adopted ?? {}).length === 0;
  });

  const conflictDefs = allLivingConflictDefs();
  const existingConflicts = await db
    .collection<LivingConflictState>("livingConflicts")
    .find(
      { defKey: { $in: conflictDefs.map((definition) => definition.key) } },
      { projection: { defKey: 1, phaseLevel: 1, campaign: 1 } }
    )
    .toArray();
  const existingConflictKeys = new Set(existingConflicts.map((conflict) => conflict.defKey));
  const missingConflicts = conflictDefs.filter(
    (definition) => !existingConflictKeys.has(definition.key)
  );
  const tensionExists =
    (await db
      .collection<TensionSeedDocument>("coldWarTension")
      .findOne({ _id: "current" }, { projection: { _id: 1 } })) != null;
  const existingDoctrines = await db
    .collection("nationalDoctrine")
    .find({ countryId: { $in: programIds } }, { projection: { countryId: 1, adopted: 1 } })
    .toArray();
  const doctrineByCountry = new Map(
    existingDoctrines.map((doctrine) => [String(doctrine.countryId), doctrine])
  );
  const doctrineRowsInserted = programIds.filter(
    (countryId) => !doctrineByCountry.has(countryId)
  ).length;
  const doctrineRowsUpdated = programIds.filter((countryId) => {
    const doctrine = doctrineByCountry.get(countryId);
    return doctrine != null && doctrine.adopted?.[NUCLEAR_DELIVERY_DOCTRINE_KEY] == null;
  }).length;

  const result: ColdWarFoundationResult = {
    programsInserted: missingPrograms.length,
    doctrineRowsInserted,
    doctrineRowsUpdated,
    conflictsInserted: missingConflicts.length,
    campaignsUpdated: existingConflicts.filter((conflict) => conflict.campaign == null).length,
    tensionInserted: !tensionExists,
  };
  if (opts.dryRun) return result;

  const now = new Date();
  if (missingPrograms.length > 0) {
    await seedNuclearPrograms(db, { year });
  }

  for (const countryId of programIds) {
    const doctrine = doctrineByCountry.get(countryId);
    if (!doctrine) {
      await db.collection("nationalDoctrine").insertOne({
        countryId,
        adopted: { ...DEFAULT_ADOPTED, [NUCLEAR_DELIVERY_DOCTRINE_KEY]: turn },
        points: DEFAULT_POINTS,
      });
    } else if (doctrine.adopted?.[NUCLEAR_DELIVERY_DOCTRINE_KEY] == null) {
      await db
        .collection("nationalDoctrine")
        .updateOne(
          { countryId, [`adopted.${NUCLEAR_DELIVERY_DOCTRINE_KEY}`]: { $exists: false } },
          { $set: { [`adopted.${NUCLEAR_DELIVERY_DOCTRINE_KEY}`]: turn } }
        );
    }
  }

  if (missingConflicts.length > 0) {
    await db.collection<LivingConflictState>("livingConflicts").bulkWrite(
      missingConflicts.map((definition) => ({
        updateOne: {
          filter: { defKey: definition.key },
          update: { $setOnInsert: { ...emptyConflictState(definition.key), updatedAt: now } },
          upsert: true,
        },
      }))
    );
  }
  const legacyConflicts = existingConflicts.filter((conflict) => conflict.campaign == null);
  if (legacyConflicts.length > 0) {
    await db.collection<LivingConflictState>("livingConflicts").bulkWrite(
      legacyConflicts.map((conflict) => ({
        updateOne: {
          filter: { defKey: conflict.defKey, campaign: { $exists: false } },
          update: { $set: { campaign: normalizeCampaignState(conflict.campaign), updatedAt: now } },
        },
      }))
    );
  }

  if (!tensionExists) {
    const activeCrises = await db.collection("crises").countDocuments({ status: "active" });
    const escalationLevel =
      existingConflicts.find((conflict) => conflict.defKey === "vietnam")?.phaseLevel ?? 0;
    const warheadsByCountry = new Map(
      existingPrograms.map((program) => [program._id, Math.max(0, program.warheads ?? 0)])
    );
    for (const program of missingPrograms) {
      warheadsByCountry.set(program._id, Math.max(0, program.warheads));
    }
    const totalWarheads = [...warheadsByCountry.values()].reduce(
      (sum, warheads) => sum + warheads,
      0
    );
    const value = tensionPressureBreakdown({
      escalationLevel,
      activeCrises,
      totalWarheads,
    }).floor;
    await db
      .collection<TensionSeedDocument>("coldWarTension")
      .updateOne(
        { _id: "current" },
        { $setOnInsert: { value, updatedTurn: turn, events: [], updatedAt: now } },
        { upsert: true }
      );
  }

  await db.collection<GameState>("gameState").updateOne(
    { _id: "current" },
    {
      $set: {
        conflictsEnabled: true,
        coldWarEnabled: true,
        livingConflictsEnabled: true,
        livingConflictsEnabledBy: "system:release-1.3",
        livingConflictsEnabledAt: now.toISOString(),
      },
    }
  );
  return result;
}
