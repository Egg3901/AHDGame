/**
 * Seed-time NPP market corporations.
 *
 * A fresh world previously opened with ZERO NPP-run per-sector corporations:
 * `bootstrapGameWorld` seeds state-owned national corps (budget seeders) and
 * the unowned-sector market pool, but never spawned the NPP-run competitors.
 * They only appeared if an operator manually POSTed
 * `/api/admin/corporations/spawn-npp-all`, or organically once NPCs founded
 * their own during turns. That left the exchange and every sector market bare
 * at switch-on.
 *
 * This runs as a bootstrap step and derives WHO gets corps and HOW MANY from
 * the same source of truth the rest of the seed uses — the per-preset access
 * tier (`getPresetEnablementTier`):
 *
 *   • player-enabled country  → 1 NPP corp per sector (the two-major
 *     democracies: US, UK, …). One competitor per sector.
 *   • econ-preview country    → 2 NPP corps per sector (the NPP-run market
 *     democracies: DE, JP, IE, BR, NG, FR, IT, …). Two competitors per sector
 *     so the market opens contested rather than monopolised.
 *   • hidden / coming-soon    → 0.
 *
 * On top of the tier, two hard gates:
 *   • Planned economies (RU, CN-1953, DD, the Eastern bloc) are excluded — the
 *     state owns the commanding heights and its SOEs come from the budget
 *     seeders, not a market-corp spawn. Detected via the marketization dial
 *     (`scheduledMarketizationLevel < DUAL_TRACK_CEILING`), so China correctly
 *     spawns corps in market-era presets but not in 1953.
 *   • Countries with no configured capital region (`NPP_CAPITAL_STATES[c]`
 *     blank — latent/secession regions) are skipped; there is nowhere to HQ.
 *
 * Idempotent: skips any country that already has NPP corps, so a re-run or the
 * manual admin route is safe.
 */

import type { Db } from "mongodb";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { CORPORATION_TYPES } from "@/lib/constants/corporations";
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
 * The per-country NPP market-corp spawn policy for a preset. Pure — no DB
 * access — so the seed step and the `spawn-npp-all` admin route share one
 * source of truth. Returns `[]` for presets with no enablement map (e.g.
 * 2019-default, which is admin-managed) to preserve their status quo.
 */
export function nppCorpSpawnPlan(preset: string, startingYear: number): NppCorpCountryPlan[] {
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
 * Spawn the seed NPP corporations for a preset. Idempotent per country.
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

  for (const { countryId, perSectorCount } of plan) {
    const existing = await db
      .collection("corporations")
      .countDocuments({ ceoType: "npp", countryId });
    if (existing > 0) {
      log(`[seedNppCorporations] ${countryId} already has ${existing} NPP corps — skipping`);
      continue;
    }

    try {
      const spawned = await batchSpawnNppCorporations(db, countryId, {
        perSectorCount,
      });
      byCountry[countryId] = spawned.length;
      totalSpawned += spawned.length;
      log(
        `[seedNppCorporations] ${countryId}: spawned ${spawned.length} NPP corps ` +
          `(${perSectorCount}/sector × ${CORPORATION_TYPES.length} sectors)`
      );
    } catch (err) {
      log(
        `[seedNppCorporations] ${countryId} failed: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }
  }

  log(
    `[seedNppCorporations] seeded ${totalSpawned} NPP corps across ${
      Object.keys(byCountry).length
    } countries`
  );
  return { totalSpawned, byCountry };
}
