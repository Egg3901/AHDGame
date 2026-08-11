/**
 * Command-economy SOE / plants reconcile (ticket #1014).
 *
 * Under plants, Eastern-bloc command countries need state capacity in EVERY
 * sector. The old "commanding heights" SOE lists left most sectors as
 * unreachable unowned headroom (private founding is banned), and even the
 * seeded SOE buckets carried a full unowned twin that diluted capacity share
 * to ~50%.
 *
 * This pass:
 *   1. Upserts one SOE corporation + per-state plants for every sector in
 *      {@link commandEconomySoeSectors} (matched by assignedSectorTypes so
 *      live ObjectIds from prior id layouts are reused).
 *   2. Deletes unowned docs only for those SOE-covered sector types — so a
 *      dual-track country like CN keeps unowned headroom outside its shorter
 *      SOE set, while full-stack Eastern-bloc countries drain every sector.
 *
 * Idempotent. Called at the end of `seedUnownedSectors` and from the deploy
 * migration for live worlds.
 */

import type { Db } from "mongodb";
import { IS_NUMERIC_BSON } from "@/lib/db/numericTypeFilter";
import { ObjectId } from "mongodb";
import type {
  Corporation,
  CorporateSector,
  GameConfig,
  GameState,
  State,
  UnownedSector,
} from "@/lib/db/types";
import type { CountryId } from "@/lib/constants/countries";
import type { CorporationType } from "@/lib/constants/corporations";
import { commandEconomySoeSectors, isCommandEconomy } from "@/lib/constants/commandEconomy";
import { getStartingYearForPreset } from "@/lib/constants/turnTime";
import { generateCountryOwnedSeedData } from "@/lib/seeds/reference/budgets";
import { loadWorldPreset } from "@/lib/currency/gdpAnchorRate";

export interface ReconcileCommandEconomyUnownedResult {
  commandCountries: CountryId[];
  soesCreated: number;
  soesReused: number;
  sectorsUpserted: number;
  unownedDeleted: number;
}

function resolveSeedYear(
  preset: string | undefined,
  gameYear: number | null | undefined
): number | null {
  if (gameYear != null && Number.isFinite(gameYear)) return gameYear;
  if (!preset) return null;
  try {
    return getStartingYearForPreset(preset);
  } catch {
    const parsed = parseInt(preset.slice(0, 4), 10);
    return Number.isFinite(parsed) ? parsed : null;
  }
}

/**
 * Ensure full SOE plant coverage for fully-command countries, then drain their
 * unowned pools.
 */
export async function reconcileCommandEconomyUnowned(
  db: Db,
  opts: { dryRun?: boolean; preset?: string; log?: (msg: string) => void } = {}
): Promise<ReconcileCommandEconomyUnownedResult> {
  const { dryRun = false, log = () => {} } = opts;

  const empty: ReconcileCommandEconomyUnownedResult = {
    commandCountries: [],
    soesCreated: 0,
    soesReused: 0,
    sectorsUpserted: 0,
    unownedDeleted: 0,
  };

  const [gameConfig, gameState, presetFromDb] = await Promise.all([
    db
      .collection<GameConfig>("gameConfig")
      .findOne({ _id: "default" }, { projection: { commandEconomyEnabled: 1 } }),
    db
      .collection<GameState>("gameState")
      .findOne({ _id: "current" as never }, { projection: { currentYear: 1 } }),
    opts.preset ? Promise.resolve(opts.preset) : loadWorldPreset(db),
  ]);

  const enabled = gameConfig?.commandEconomyEnabled === true;
  if (!enabled) {
    log("reconcileCommandEconomyUnowned: commandEconomyEnabled off — no-op");
    return empty;
  }

  const preset = opts.preset ?? presetFromDb ?? "1953-default";
  const year = resolveSeedYear(preset, gameState?.currentYear ?? null);

  const states = await db
    .collection<State>("states")
    .find({ _id: { $not: /^NATIONAL_/ } })
    .project<Pick<State, "_id" | "countryId" | "population" | "gdp">>({
      countryId: 1,
      population: 1,
      gdp: 1,
    })
    .toArray();

  const countryIds = [...new Set(states.map((s) => s.countryId as CountryId))];
  const commandCountries = countryIds.filter(
    (id) => isCommandEconomy(id, year, true) && commandEconomySoeSectors(id).length > 0
  );

  if (commandCountries.length === 0) {
    log("reconcileCommandEconomyUnowned: no command-band SOE countries");
    return empty;
  }

  const statesForSeed = states
    .filter((s) => commandCountries.includes(s.countryId as CountryId))
    .map((s) => ({
      id: s._id as string,
      population: s.population,
      gdp: s.gdp,
      countryId: s.countryId as CountryId,
    }));

  const seedEntries = generateCountryOwnedSeedData(statesForSeed, preset, true).filter(
    (e) => e.corporation.soe && commandCountries.includes(e.corporation.countryOwnerId as CountryId)
  );

  let soesCreated = 0;
  let soesReused = 0;
  let sectorsUpserted = 0;

  for (const entry of seedEntries) {
    const sectorType = (entry.corporation.assignedSectorTypes?.[0] ??
      entry.corporation.type) as CorporationType;
    const countryId = entry.corporation.countryOwnerId as CountryId;

    const existing = await db.collection<Corporation>("corporations").findOne({
      countryOwnerId: countryId,
      assignedSectorTypes: sectorType,
    });

    let corpId = existing?._id ?? entry.corporation._id;
    if (!existing) {
      if (!dryRun) {
        // Never overwrite an ObjectId that already belongs to another corp
        // (legacy 3-digit SOE ids collided with the first #1014 band map).
        const idTaken = await db
          .collection<Corporation>("corporations")
          .findOne({ _id: corpId }, { projection: { _id: 1, countryOwnerId: 1 } });
        if (idTaken) {
          corpId = new ObjectId();
        }

        const { _id, sequentialId: seedSequentialId, ...corpData } = entry.corporation;
        let sequentialId = seedSequentialId;
        if (sequentialId != null) {
          const conflict = await db
            .collection<Corporation>("corporations")
            .findOne({ sequentialId }, { projection: { _id: 1 } });
          if (conflict && !conflict._id.equals(corpId)) {
            const [maxRow] = await db
              .collection<Corporation>("corporations")
              .find({ sequentialId: IS_NUMERIC_BSON })
              .project({ sequentialId: 1 })
              .sort({ sequentialId: -1 })
              .limit(1)
              .toArray();
            sequentialId = (maxRow?.sequentialId ?? sequentialId) + 1;
          }
        }
        await db
          .collection<Corporation>("corporations")
          .updateOne(
            { _id: corpId },
            { $set: { ...corpData, ...(sequentialId != null ? { sequentialId } : {}) } },
            { upsert: true }
          );
      }
      soesCreated++;
    } else {
      if (!dryRun) {
        await db.collection<Corporation>("corporations").updateOne(
          { _id: corpId },
          {
            $set: {
              soe: entry.corporation.soe,
              assignedSectorTypes: [sectorType],
              name: entry.corporation.name,
              description: entry.corporation.description,
              updatedAt: new Date(),
            },
          }
        );
      }
      soesReused++;
    }

    if (!dryRun) {
      // Drop sectors for this country/type that still hang off a foreign corp
      // (ObjectId overwrite fallout from the first #1014 heal).
      await db.collection<CorporateSector>("corporateSectors").deleteMany({
        countryId,
        sectorType,
        corporationId: { $ne: corpId },
      });
    }

    for (const sector of entry.sectors) {
      if (!dryRun) {
        const { _id: _sectorId, corporationId: _ignored, ...sectorData } = sector;
        await db.collection<CorporateSector>("corporateSectors").updateOne(
          { corporationId: corpId, stateId: sector.stateId, sectorType: sector.sectorType },
          {
            $set: {
              ...sectorData,
              corporationId: corpId,
            },
          },
          { upsert: true }
        );
      }
      sectorsUpserted++;
    }
  }

  // Drain unowned only where an SOE now covers the sector. CN (and any future
  // short-list command country) must keep unowned outside its SOE set.
  const unownedFilter = {
    $or: commandCountries.map((countryId) => ({
      countryId,
      sectorType: { $in: commandEconomySoeSectors(countryId) },
    })),
  };

  let unownedDeleted = 0;
  if (dryRun) {
    unownedDeleted = await db
      .collection<UnownedSector>("unownedSectors")
      .countDocuments(unownedFilter);
  } else {
    const del = await db.collection<UnownedSector>("unownedSectors").deleteMany(unownedFilter);
    unownedDeleted = del.deletedCount ?? 0;
  }

  const result: ReconcileCommandEconomyUnownedResult = {
    commandCountries,
    soesCreated,
    soesReused,
    sectorsUpserted,
    unownedDeleted,
  };
  log(
    `reconcileCommandEconomyUnowned: ${commandCountries.join(",")}` +
      ` soesCreated=${soesCreated} soesReused=${soesReused}` +
      ` sectorsUpserted=${sectorsUpserted} unownedDeleted=${unownedDeleted}` +
      (dryRun ? " (dry-run)" : "")
  );
  return result;
}
