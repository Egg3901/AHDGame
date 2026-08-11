import type { Db } from "mongodb";
import type { CorporateSector, State } from "@/lib/db/types";
import {
  buildSectorStateCountryMap,
  getCorporateSectorLocationKey,
  getSectorOperatingCountryId,
} from "@/lib/corporations/sectorLocation";
import { clampProductionPolicy } from "@/lib/utils/productionPolicy";
import { getMarketSystemModeForDb, marketAtLeast } from "@/lib/market/featureFlag";
import {
  identitySectorPlantFields,
  mergeSectorPlantFields,
  readSectorPlantFields,
  type SectorPlantFieldsUpdate,
} from "@/lib/corporations/sectorTransferCapex";

export interface NormalizedSectorSummary {
  sectorId: string;
  stateId: string;
  fromCountryId: string;
  toCountryId: string;
}

export interface MergedSectorSummary {
  corporationId: string;
  stateId: string;
  sectorType: string;
  count: number;
}

export async function normalizeAndMergeCorporateSectors(
  db: Db,
  now = new Date()
): Promise<{
  normalizedSectors: NormalizedSectorSummary[];
  mergedGroups: MergedSectorSummary[];
}> {
  const allSectors = await db
    .collection<CorporateSector>("corporateSectors")
    .find({})
    .sort({ createdAt: 1 })
    .toArray();
  const states = await db
    .collection<State>("states")
    .find({}, { projection: { _id: 1, countryId: 1 } })
    .toArray();
  const stateCountryByStateId = buildSectorStateCountryMap(states);
  // Resolved once for the whole heal. This is an admin/seed path, not a turn
  // phase, so a single read is the right cost.
  const plantsEnabled = marketAtLeast(await getMarketSystemModeForDb(db), "plants");

  const normalizedSectors: NormalizedSectorSummary[] = [];

  for (const sector of allSectors) {
    const operatingCountryId = getSectorOperatingCountryId(sector, stateCountryByStateId);
    if (sector.countryId === operatingCountryId) continue;
    const previousCountryId = sector.countryId;
    await db
      .collection<CorporateSector>("corporateSectors")
      .updateOne({ _id: sector._id }, { $set: { countryId: operatingCountryId, updatedAt: now } });
    sector.countryId = operatingCountryId;
    sector.updatedAt = now;
    normalizedSectors.push({
      sectorId: sector._id.toString(),
      stateId: sector.stateId,
      fromCountryId: previousCountryId,
      toCountryId: operatingCountryId,
    });
  }

  const groups = new Map<string, CorporateSector[]>();
  for (const sector of allSectors) {
    const key = getCorporateSectorLocationKey(sector, stateCountryByStateId);
    const group = groups.get(key) ?? [];
    group.push(sector);
    groups.set(key, group);
  }

  const mergedGroups: MergedSectorSummary[] = [];

  for (const group of groups.values()) {
    if (group.length < 2) continue;

    const [keeper, ...duplicates] = group;
    const combinedRevenue = group.reduce((sum, sector) => sum + sector.revenue, 0);
    const combinedWorkers = group.reduce((sum, sector) => sum + sector.workers, 0);
    const weightedMargin =
      combinedRevenue > 0
        ? group.reduce((sum, sector) => sum + sector.profitMargin * sector.revenue, 0) /
          combinedRevenue
        : keeper.profitMargin;
    const weightedProductionPolicyLevel =
      combinedRevenue > 0
        ? clampProductionPolicy(
            Math.round(
              group.reduce(
                (sum, sector) => sum + (sector.productionPolicyLevel ?? 0) * sector.revenue,
                0
              ) / combinedRevenue
            )
          )
        : (keeper.productionPolicyLevel ?? 0);
    const weightedNegativeProductionTurns =
      combinedRevenue > 0
        ? Math.round(
            group.reduce(
              (sum, sector) =>
                sum + (sector.negativeProductionSustainedTurns ?? 0) * sector.revenue,
              0
            ) / combinedRevenue
          )
        : (keeper.negativeProductionSustainedTurns ?? 0);

    // PLANTS-GATED: the duplicate-row heal is a MERGE — the losing rows are
    // deleted immediately below — so under plants their plant state
    // (`capitalStock`, `buildQueue`, `constructionInProgressAnchor`,
    // `mothballed`, `plantsStartTurn`) must be folded into the keeper first.
    // Without the fold the heal silently destroys built capacity and the ₳
    // sitting in in-flight build orders. Revenue is still combined for the
    // legacy readers; under plants `sectorTurn` restates it from the folded
    // capacity on the next tick.
    //
    // The fold is GATED, not unconditional. An earlier revision of this fix
    // claimed folding was "a no-op below plants, where none of these fields are
    // populated" — that is wrong. Under CAPITAL mode `sectorTurn` writes a
    // non-zero `capitalStock` and re-derives it from revenue every turn, so
    // summing it here would double a quantity capital mode owns; and spreading
    // the fold would additionally stamp `buildQueue: []`,
    // `constructionInProgressAnchor: 0`, `mothballed: false` and
    // `plantsStartTurn: null` onto rows that legitimately carry none of them —
    // waking a mothballed sector in the process. Below plants this heal must
    // stay byte-identical to what it has always done.
    const mergedPlantFields: SectorPlantFieldsUpdate | null = plantsEnabled
      ? group
          .filter((sector) => !sector._id.equals(keeper._id))
          .reduce<SectorPlantFieldsUpdate>(
            (survivor, incoming) =>
              mergeSectorPlantFields(survivor, readSectorPlantFields(incoming)),
            // `identitySectorPlantFields`, NOT `mergeSectorPlantFields(keeper, {})`.
            // The latter looks like a harmless way to normalise the seed, but
            // `mothballed` folds with AND, so `keeper.mothballed && undefined`
            // evaluates false and no later fold can bring it back: every healed
            // group came out of the de-duplication RUNNING and paying full
            // upkeep, whatever its operating state was going in. The identity
            // helper exists precisely to make a one-sided normalisation safe.
            identitySectorPlantFields(readSectorPlantFields(keeper))
          )
      : null;

    await db.collection<CorporateSector>("corporateSectors").updateOne(
      { _id: keeper._id },
      {
        $set: {
          countryId: getSectorOperatingCountryId(keeper, stateCountryByStateId),
          revenue: combinedRevenue,
          workers: combinedWorkers,
          profitMargin: weightedMargin,
          productionPolicyLevel: weightedProductionPolicyLevel,
          negativeProductionSustainedTurns: weightedNegativeProductionTurns,
          updatedAt: now,
          ...(mergedPlantFields ?? {}),
        },
      }
    );

    await db.collection<CorporateSector>("corporateSectors").deleteMany({
      _id: { $in: duplicates.map((sector) => sector._id) },
    });

    mergedGroups.push({
      corporationId: keeper.corporationId.toString(),
      stateId: keeper.stateId,
      sectorType: keeper.sectorType,
      count: group.length,
    });
  }

  return { normalizedSectors, mergedGroups };
}
