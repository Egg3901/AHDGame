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
