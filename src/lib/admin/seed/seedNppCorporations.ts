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
import { OPERATING_SECTOR_TYPES, operatingSectorIdentity } from "@/lib/constants/corporations";
import { getOperatingSectorType } from "@/lib/constants/sectorStrategies";
import { getEraUnitScale } from "@/lib/constants/sectorSeedEra";
import { computeUnownedSeedRevenue } from "@/lib/admin/seed/seedUnownedSectors";
import { nppSeedRevenueCap } from "@/lib/admin/seed/rules/nppSeedCapacity";
import { foundingStarterUnits } from "@/lib/corporations/foundingPlant";
import { revenuePerCapacityUnit } from "@/lib/constants/capacityEconomy";
import type { State } from "@/lib/db/types/state";
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
  log: (msg: string) => void = () => {}
): Promise<SeedNppCorporationsResult> {
  const plan = nppCorpSpawnPlan(preset, startingYear);
  const byCountry: Record<string, number> = {};
  let totalSpawned = 0;

  // One market per operating lane, stored under its canonical identity.
  const sectorMarkets = OPERATING_SECTOR_TYPES.map((lane) => {
    const identity = operatingSectorIdentity(lane);
    return {
      type: identity.sectorType,
      industryModel: identity.industryModel,
      mediaDiscriminator: identity.mediaDiscriminator,
    };
  });

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
    // Fresh 1991 only: size the competitor book from the country's whole
    // economy rather than its capital region (see rules/nppSeedCapacity.ts).
    const countryStates =
      preset === "1991-default"
        ? await db
            .collection<State>("states")
            .find({ countryId, _id: { $not: /^NATIONAL_/ } })
            .project<Pick<State, "_id" | "gdp">>({ gdp: 1 })
            .toArray()
        : [];
    let countrySpawned = 0;
    for (const market of sectorMarkets) {
      const present = existing.filter(
        (corp) =>
          getOperatingSectorType(corp.type, corp.industryModel, corp.mediaDiscriminator) ===
          getOperatingSectorType(market.type, market.industryModel, market.mediaDiscriminator)
      ).length;
      const missing = Math.max(0, perSectorCount - present);
      if (missing === 0) continue;
      const operatingType = getOperatingSectorType(
        market.type,
        market.industryModel,
        market.mediaDiscriminator
      ) as OperatingSectorType;
      const countrySizedCap =
        countryStates.length > 0
          ? nppSeedRevenueCap({
              countryPoolRevenue: countryStates.reduce(
                (sum, region) =>
                  sum +
                  computeUnownedSeedRevenue({
                    gdp: region.gdp,
                    countryId,
                    stateId: String(region._id),
                    sectorType: operatingType,
                    preset,
                  }),
                0
              ),
              perSectorCount,
              floorRevenue:
                foundingStarterUnits(market.type, market.industryModel, market.mediaDiscriminator) *
                revenuePerCapacityUnit(
                  market.type,
                  getEraUnitScale(preset),
                  market.industryModel,
                  market.mediaDiscriminator
                ),
            })
          : undefined;
      const extractionCap =
        market.type === "extraction" && extractionSite
          ? (extractionSite.supportedDailyRevenue / getEraUnitScale(preset)) * 0.25
          : undefined;
      const maximumStartingRevenue =
        countrySizedCap !== undefined && extractionCap !== undefined
          ? Math.min(countrySizedCap, extractionCap)
          : (countrySizedCap ?? extractionCap);
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
            }
          : {}),
        ...(maximumStartingRevenue !== undefined ? { maximumStartingRevenue } : {}),
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
