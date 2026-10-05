/**
 * Seeded competitors fill player and economy-preview markets without duplicates.
 * seedNppCorporations follows preset access, excludes planned economies, and
 * consumes available market capacity. Player miners use supported deposits.
 */

import type { Db } from "mongodb";
import type { StateResourceCapacity } from "@/lib/db/types/stateResourceCapacity";
import { chooseSeedExtractionSite } from "@/lib/extraction/rules/seedPlacement";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import type { Corporation } from "@/lib/db/types";
import {
  CORPORATION_TYPES,
  type CorporationType,
  type ManufacturingIndustryModel,
  type MediaDiscriminator,
} from "@/lib/constants/corporations";
import { getOperatingSectorType } from "@/lib/constants/sectorStrategies";
import type { GameConfig } from "@/lib/db/types/gameConfig";
import { getEraUnitScale } from "@/lib/constants/sectorSeedEra";
import {
  getPresetEnablementCountries,
  getPresetEnablementTier,
} from "@/lib/admin/seed/seedCountryGameStates";
import { scheduledMarketizationLevel, DUAL_TRACK_CEILING } from "@/lib/constants/commandEconomy";
import { batchSpawnNppCorporations, NPP_CAPITAL_STATES } from "@/lib/admin/spawnNppCorporation";

export interface NppCorpCountryPlan {
  countryId: CountryId;
  /** NPP corps to spawn per sector type (1 = player-enabled, 2 = econ-preview). */
  perSectorCount: number;
  /** HQ region for every corp in this country. */
  hqState: string;
}

/**
 * Presets that spawn NPP market corporations.
 *
 * ⚠️ This list exists because the gate below used to be implicit. It read
 * `getPresetEnablementCountries(preset) === null` as "this preset is
 * admin-managed, leave it alone", which happened to exclude 2019 and 2023
 * because those had no manifest map. The era roster gives every preset a map,
 * so that guard silently stopped firing — and a 2019 reset would have begun
 * spawning NPP corps for eight countries that previously got none.
 *
 * That is an economy change, not a config one, so it is an explicit list rather
 * than a side effect.
 *
 * ⚠ "2019-default" IS UPSTREAM'S DECISION, NOT A QUIET EDIT. This list
 * originally reproduced the old behaviour exactly, with a note that adding 2019
 * would be a deliberate product decision wanting a simulation report. Upstream
 * then made that decision in "make every seed complete" (#1669): its test
 * changed from `nppCorpSpawnPlan("2019-default")` returning [] to requiring a
 * plan covering US, UK, JP, DE, IE and CN. Following the source of truth here
 * is not the same as choosing it unilaterally.
 *
 * ⚠ 2023 AND 2027 STAY OUT. Upstream decided 2019 and only 2019, and the
 * reasoning above still applies to the other two: both now have enablement maps
 * from the era roster, so adding them is a one-line edit with an economy-wide
 * effect and no simulation report behind it. Leave them to an explicit call.
 */
const NPP_CORP_SPAWN_PRESETS = new Set<string>([
  "1953-default",
  "1979-default",
  "1991-default",
  "1999-default",
  "2007-default",
  "2019-default",
]);

/**
 * The per-country NPP market-corp spawn policy for a preset. Pure — no DB
 * access — so the seed step and the `spawn-npp-all` admin route share one
 * source of truth. Returns `[]` for presets that do not spawn NPP corps.
 */
export function nppCorpSpawnPlan(preset: string, startingYear: number): NppCorpCountryPlan[] {
  if (!NPP_CORP_SPAWN_PRESETS.has(preset)) return [];
  const mapped = getPresetEnablementCountries(preset);
  if (!mapped) return [];

  // US runs off the global GameState and is excluded from the enablement map,
  // but it is always the flagship player-enabled country.
  const usId = COUNTRY_CONFIGS.US.id;
  const countries: CountryId[] = [usId, ...mapped];
  const plan: NppCorpCountryPlan[] = [];

  for (const countryId of countries) {
    let perSectorCount: number;
    if (countryId === usId) {
      perSectorCount = 1;
    } else {
      const tier = getPresetEnablementTier(preset, countryId);
      if (!tier) continue;
      perSectorCount = tier.enabledForPlayers ? 1 : tier.economyPreview ? 2 : 0;
    }
    if (perSectorCount === 0) continue;

    // Market economies only — planned economies get their SOEs from the budget
    // seeders. The dial captures China migrating across eras (command in 1953,
    // market by 2019) without a per-preset country list.
    if (scheduledMarketizationLevel(countryId, startingYear) < DUAL_TRACK_CEILING) {
      continue;
    }

    const hqState = NPP_CAPITAL_STATES[countryId];
    if (!hqState) continue;

    plan.push({ countryId, perSectorCount, hqState });
  }

  return plan;
}

export interface SeedNppCorporationsResult {
  totalSpawned: number;
  byCountry: Record<string, number>;
}

/**
 * Fill missing NPP competitors per market without duplicating completed markets.
 */
export async function seedNppCorporations(
  db: Db,
  preset: string,
  startingYear: number,
  log: (msg: string) => void = () => {},
  vehicleModelSeed = false
): Promise<SeedNppCorporationsResult> {
  const plan = nppCorpSpawnPlan(preset, startingYear);
  const byCountry: Record<string, number> = {};
  let totalSpawned = 0;
  const config =
    preset === "1991-default"
      ? await db
          .collection<GameConfig>("gameConfig")
          .findOne(
            { _id: "default" },
            { projection: { fresh1991VehicleModelSeed: 1, fresh1991MediaTaxonomySeed: 1 } }
          )
      : null;
  vehicleModelSeed ||= config?.fresh1991VehicleModelSeed?.schema === "manufacturing-vehicles-v1";

  const sectorMarkets: Array<{
    type: CorporationType;
    industryModel: ManufacturingIndustryModel | null;
    mediaDiscriminator?: MediaDiscriminator | null;
  }> = vehicleModelSeed
    ? [
        ...CORPORATION_TYPES.filter((type) => type !== "automobiles").map((type) => ({
          type,
          industryModel: null,
        })),
        { type: "manufacturing" as const, industryModel: "vehicles" as const },
      ]
    : CORPORATION_TYPES.map((type) => ({ type, industryModel: null }));
  if (config?.fresh1991MediaTaxonomySeed?.status === "complete") {
    for (const market of sectorMarkets) {
      if (market.type === "entertainment") {
        market.type = "media";
        market.mediaDiscriminator = "entertainment";
      }
    }
  }

  for (const { countryId, perSectorCount } of plan) {
    const extractionSite =
      preset === "1991-default" && ["US", "UK", "JP"].includes(countryId)
        ? chooseSeedExtractionSite(
            await db
              .collection<StateResourceCapacity>("stateResourceCapacity")
              .find({ countryId })
              .toArray()
          )
        : null;
    const existing = await db
      .collection<Corporation>("corporations")
      .find({ ceoType: "npp", countryId })
      .project<Pick<Corporation, "type" | "industryModel" | "mediaDiscriminator">>({
        type: 1,
        industryModel: 1,
        mediaDiscriminator: 1,
      })
      .toArray();
    let countrySpawned = 0;
    for (const market of sectorMarkets) {
      const present = existing.filter(
        (corp) =>
          getOperatingSectorType(corp.type, null, corp.mediaDiscriminator) ===
            getOperatingSectorType(market.type, null, market.mediaDiscriminator) &&
          (corp.industryModel ?? null) === market.industryModel
      ).length;
      const missing = Math.max(0, perSectorCount - present);
      if (missing === 0) continue;
      const spawned = await batchSpawnNppCorporations(db, countryId, {
        perSectorCount: missing,
        sectorMarkets: [market],
        // The strict opening headroom acceptance applies to the audited reset.
        // Older presets retain their authored competitor grants.
        limitToUnownedPool: preset === "1991-default",
        ...(market.type === "extraction" && extractionSite
          ? {
              headquartersState: extractionSite.stateId,
              initialStrategyId: extractionSite.strategyId,
              maximumStartingRevenue:
                (extractionSite.supportedDailyRevenue / getEraUnitScale(preset)) * 0.25,
            }
          : {}),
      });
      if (spawned.length !== missing) {
        throw new Error(
          `NPP seed incomplete: ${countryId}/${market.type}/${market.industryModel ?? "standard"} expected ${missing} competitors, created ${spawned.length}`
        );
      }
      countrySpawned += spawned.length;
    }
    byCountry[countryId] = countrySpawned;
    totalSpawned += countrySpawned;
    log(
      `[seedNppCorporations] ${countryId}: completed ${sectorMarkets.length} markets, spawned ${countrySpawned} competitors`
    );
  }

  log(
    `[seedNppCorporations] seeded ${totalSpawned} NPP corps across ${
      Object.keys(byCountry).length
    } countries`
  );
  return { totalSpawned, byCountry };
}
