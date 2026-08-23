import type { Db } from "mongodb";
import type { NuclearProgram } from "@/lib/db/types/nuclearProgram";
import type { GameState } from "@/lib/db/types/gameState";
import type { LivingConflictState } from "@/lib/livingConflict/types";
import { allLivingConflictDefs } from "@/lib/livingConflict/registry";
import { emptyConflictState } from "@/lib/livingConflict/engine";
import { normalizeCampaignState } from "@/lib/livingConflict/campaign";
import { DEFAULT_ADOPTED, DEFAULT_POINTS, keyOf } from "@/lib/military/doctrineTree";
import { tensionPressureBreakdown } from "@/lib/coldwar/tension";

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

function adoptedAt(turn: number, keys: string[]): Record<string, number> {
  return Object.fromEntries(keys.map((key) => [key, turn]));
}

/** Game-scaled historical starting arsenals. Counts are balance units, not literal inventories. */
export function nuclearProgramBaselines(year: number, turn: number): BaselineProgram[] {
  const common = ["device-fission", "device-boosted", "device-thermo", "delivery-bombers"];
  const missile = year >= 1956 ? ["delivery-irbm"] : [];
  const icbm = year >= 1959 ? ["delivery-icbm"] : [];
  const slbm = year >= 1960 ? ["delivery-slbm"] : [];
  const mirv = year >= 1968 ? ["device-mirv"] : [];
  const late = [...common, ...missile, ...icbm, ...slbm, ...mirv];

  if (year < 1945) return [];
  if (year < 1952) {
    return [
      {
        _id: "US",
        adopted: adoptedAt(turn, ["device-fission", "device-boosted", "delivery-bombers"]),
        warheads: 6,
        productionRate: 0,
      },
      {
        _id: "RU",
        adopted: adoptedAt(turn, ["device-fission", "delivery-bombers"]),
        warheads: 3,
        productionRate: 0,
      },
    ];
  }

  const usWarheads = year < 1956 ? 10 : year < 1968 ? 18 : year < 1991 ? 60 : 65;
  const ruWarheads = year < 1956 ? 6 : year < 1968 ? 14 : year < 1991 ? 55 : 60;
  const ukWarheads = year < 1957 ? 2 : year < 1968 ? 5 : year < 1991 ? 15 : 15;
  const ukNodes = [
    "device-fission",
    ...(year >= 1957 ? ["device-boosted", "device-thermo"] : []),
    "delivery-bombers",
    ...(year >= 1960 ? ["delivery-irbm", "delivery-icbm", "delivery-slbm"] : []),
  ];

  return [
    { _id: "US", adopted: adoptedAt(turn, late), warheads: usWarheads, productionRate: 0 },
    { _id: "RU", adopted: adoptedAt(turn, late), warheads: ruWarheads, productionRate: 0 },
    { _id: "UK", adopted: adoptedAt(turn, ukNodes), warheads: ukWarheads, productionRate: 0 },
  ];
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
  const baselines = nuclearProgramBaselines(year, turn);
  const programIds = baselines.map((program) => program._id);
  const existingPrograms = await db
    .collection<NuclearProgram>("nuclearPrograms")
    .find({}, { projection: { _id: 1, warheads: 1 } })
    .toArray();
  const existingProgramIds = new Set(existingPrograms.map((program) => program._id));
  const missingPrograms = baselines.filter((program) => !existingProgramIds.has(program._id));

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
    await db.collection<NuclearProgram>("nuclearPrograms").bulkWrite(
      missingPrograms.map((program) => ({
        updateOne: {
          filter: { _id: program._id },
          update: { $setOnInsert: { ...program, updatedAt: now } },
          upsert: true,
        },
      }))
    );
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
    const totalWarheads = [...existingPrograms, ...missingPrograms].reduce(
      (sum, program) => sum + Math.max(0, program.warheads ?? 0),
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
