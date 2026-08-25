import type { AnyBulkWriteOperation, Db } from "mongodb";
import type { CorporateSector, StateResourceCapacity } from "@/lib/db/types";
import { getStateResourceCapacity } from "@/lib/seeds/reference/stateResourceCapacity";
import { STRATEGY_COOLDOWN_TURNS } from "@/lib/constants/sectorStrategies";
import { retoolRescaleFields } from "@/lib/corporations/retoolRescale";
import { getMarketSystemModeForDb, marketAtLeast } from "@/lib/market/featureFlag";
import { DEFAULT_SEED_PRESET } from "@/lib/constants/seedPreset";
import type { Migration, MigrationResult } from "../types";

/**
 * Markets repair plan P2a: author the eastern-bloc deposits and point the
 * Chinese extraction SOE at its iron.
 *
 * When Ukraine and the satellites became playable countries their states were
 * seeded with `resources: {}`, which caps every extractable at ZERO: the
 * Donbass, Upper Silesia, and Ploiești all mined against empty deposit docs,
 * and only unbounded scarcity relief let those SOE sectors produce anything.
 * The reference table now authors the deposits (the old combined "RU:UKR"
 * budget split across the new UKR states, satellites at bloc-consistent
 * tiers); this migration backfills them onto live worlds, but ONLY for states
 * whose stored resources are still empty, so prospecting gains and admin
 * edits are never clobbered.
 *
 * Separately, the Chinese Extraction & Mining Enterprise runs coal_mining in
 * all seven states while four of them (DB, HB, HZ, XN) hold some of the
 * world's largest authored iron deposits and iron is the world's shortage
 * commodity. The SOE has no NPP CEO, so the auto-strategy re-scorer never
 * touches it. This flips those four sectors to iron_mining through the same
 * transition machinery a player retool uses (blended rates over the
 * transition window, cooldown, capital rescale), so the change ramps instead
 * of teleporting.
 */
const BACKFILL_STATE_IDS = [
  "UKR_DON",
  "UKR_DNI",
  "UKR_WES",
  "UKR_KYI",
  "UKR_SOU",
  "PL_SLK",
  "PL_DSL",
  "PL_MAL",
  "PL_POM",
  "PL_EAS",
  "CS_BOH",
  "CS_MOR",
  "CS_SVK",
  "HU_TRW",
  "HU_NOR",
  "RO_MUN",
  "RO_TRA",
  "RO_OLT",
  "RO_MOL",
  "BG_THR",
  "BG_SW",
  "BLR_MIN",
  "BLR_HOM",
  "BLR_VIT",
  "BAL_EST",
  "BAL_LVA",
  "BAL_LTU",
  "YU_BIH",
  "YU_SRB",
  "YU_KOS",
  "YU_SLO",
  "YU_CRO",
  "YU_MKD",
  "YU_MNE",
  "YU_VOJ",
] as const;

const CN_IRON_STATES = ["DB", "HB", "HZ", "XN"] as const;

function isEmptyResources(doc: Pick<StateResourceCapacity, "resources"> | null): boolean {
  return !doc?.resources || Object.keys(doc.resources).length === 0;
}

async function backfillEasternDeposits(db: Db, dryRun: boolean): Promise<MigrationResult> {
  const notes: string[] = [];
  const now = new Date();

  const gameState = await db
    .collection<{ _id: string; preset?: string; currentTurn?: number }>("gameState")
    .findOne({ _id: "current" }, { projection: { preset: 1, currentTurn: 1 } });
  const preset = gameState?.preset ?? DEFAULT_SEED_PRESET;
  const currentTurn = gameState?.currentTurn ?? 0;
  // Post-headroom, era-gated values, byte-identical to what a fresh seed
  // would write for this preset.
  const capacityMap = getStateResourceCapacity(preset);

  // ── Part 1: deposit backfill, empty docs only ──────────────────────────
  const existing = await db
    .collection<StateResourceCapacity>("stateResourceCapacity")
    .find({ stateId: { $in: [...BACKFILL_STATE_IDS] } })
    .toArray();
  const existingByState = new Map(existing.map((doc) => [doc.stateId, doc]));

  const ops: AnyBulkWriteOperation<StateResourceCapacity>[] = [];
  let skippedNonEmpty = 0;
  let missingAuthoring = 0;
  for (const stateId of BACKFILL_STATE_IDS) {
    const doc = existingByState.get(stateId) ?? null;
    if (doc && !isEmptyResources(doc)) {
      skippedNonEmpty++;
      continue;
    }
    const countryId = doc?.countryId ?? stateId.split("_")[0];
    const entry = capacityMap[`${countryId}:${stateId}`];
    if (!entry || Object.keys(entry.resources).length === 0) {
      missingAuthoring++;
      continue;
    }
    ops.push({
      updateOne: {
        filter: { stateId },
        update: {
          $set: { stateId, countryId: entry.countryId, resources: entry.resources, updatedAt: now },
        },
        upsert: true,
      },
    });
  }
  notes.push(
    `deposit backfill: ${ops.length} states to fill, ${skippedNonEmpty} skipped non-empty, ${missingAuthoring} without authored entries`
  );

  // ── Part 2: CN SOE iron flip ───────────────────────────────────────────
  const cnSectors = await db
    .collection<CorporateSector>("corporateSectors")
    .find({
      countryId: "CN",
      sectorType: "extraction",
      stateId: { $in: [...CN_IRON_STATES] },
      strategyId: "coal_mining",
      transitionFromStrategyId: { $in: [null, undefined] },
    })
    .toArray();
  notes.push(`CN coal_mining sectors in iron states: ${cnSectors.length}`);

  if (dryRun) {
    notes.push("dry run: no writes performed");
    return { documentsScanned: existing.length + cnSectors.length, notes };
  }

  let documentsUpdated = 0;
  if (ops.length > 0) {
    const result = await db
      .collection<StateResourceCapacity>("stateResourceCapacity")
      .bulkWrite(ops, { ordered: true });
    documentsUpdated += result.modifiedCount + result.upsertedCount;
  }

  const plantsEnabled = marketAtLeast(await getMarketSystemModeForDb(db), "plants");
  for (const sector of cnSectors) {
    // Same helper as the player command and the NPP auto-strategy pass, so
    // `anchor x units` stays invariant across the mix change.
    const rescale = retoolRescaleFields({
      sectorType: "extraction",
      fromStrategyId: sector.strategyId,
      toStrategyId: "iron_mining",
      plantsEnabled,
      capitalStock: sector.capitalStock,
      buildQueue: sector.buildQueue,
      otherOpexPerUnitAnchor: sector.otherOpexPerUnitAnchor,
    });
    await db.collection<CorporateSector>("corporateSectors").updateOne(
      { _id: sector._id },
      {
        $set: {
          strategyId: "iron_mining",
          transitionFromStrategyId: "coal_mining",
          transitionStartTurn: currentTurn,
          transitionCooldownUntilTurn: currentTurn + STRATEGY_COOLDOWN_TURNS,
          ...rescale,
          updatedAt: now,
        },
      }
    );
    documentsUpdated++;
  }
  notes.push(`flipped ${cnSectors.length} CN SOE sectors to iron_mining`);

  return { documentsScanned: existing.length + cnSectors.length, documentsUpdated, notes };
}

export const migration: Migration = {
  id: "2026-08-25-eastern-deposits-cn-soe-iron",
  description:
    "Backfill authored eastern-bloc deposits onto empty stateResourceCapacity docs and retool the CN extraction SOE's four iron-rich states from coal_mining to iron_mining (markets repair P2a)",
  idempotent: true,
  execute: (db, ctx) => backfillEasternDeposits(db, ctx.dryRun),
};
