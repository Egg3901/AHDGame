import type { Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import { CORPORATION_TYPES } from "@/lib/constants/corporations";
import { batchSpawnNppCorporations, NPP_CAPITAL_STATES } from "@/lib/admin/spawnNppCorporation";
import { loadPrivateEnterpriseBlockedCountries } from "@/lib/economy/queries/privateEnterpriseGate";

export interface WorldsimCorporationBootstrapOptions {
  /** Scope-filtered country ids the caller wants seeded (e.g. runWorld's sim scope). */
  countryIds: readonly CountryId[];
  /** Competing corps per sector type (runWorld uses 3). */
  perSectorCount: number;
  log?: (msg: string) => void;
}

export interface WorldsimCorporationBootstrapResult {
  countriesSeeded: number;
  spawnedByCountry: Record<string, number>;
  /** Requested slots that could not be filled from the remaining unowned pool. */
  unfilledByCountry: Record<string, number>;
  /** Planned economies skipped BEFORE any spawn attempt (zero attempts, zero noise). */
  skippedBlocked: string[];
  /** Countries with all requested NPP sector slots already filled. */
  skippedExisting: string[];
  /** Countries with no seeded capital region (nothing to HQ). */
  skippedNoCapital: string[];
  /** Genuine unexpected failures, with country context - never swallowed. */
  failures: Array<{ countryId: string; message: string }>;
}

/**
 * Sim-only NPP corporation bootstrap for the headless world harness
 * (scripts/sim/runWorld.ts). Bootstrap seeds no tradeable corporations, so a
 * pure-NPP sim world gets its corporate sector here, once, mirroring the
 * production admin batch-spawn tool.
 *
 * Eligibility is determined BEFORE any creation attempt, using the same
 * marketization-dial gate the production creation paths enforce
 * (`loadPrivateEnterpriseBlockedCountries`): planned economies keep the SOE
 * coverage the budget seeders gave them and see zero private-corporation
 * attempts. The blocked set resolves ONCE for the whole sweep, not per
 * country. Never consults a per-country allow/deny list, and never relies on
 * catching PrivateEnterpriseBlockedError as control flow.
 */
export async function bootstrapWorldsimCorporations(
  db: Db,
  options: WorldsimCorporationBootstrapOptions
): Promise<WorldsimCorporationBootstrapResult> {
  const log = options.log ?? (() => {});
  const result: WorldsimCorporationBootstrapResult = {
    countriesSeeded: 0,
    spawnedByCountry: {},
    unfilledByCountry: {},
    skippedBlocked: [],
    skippedExisting: [],
    skippedNoCapital: [],
    failures: [],
  };

  const blocked = await loadPrivateEnterpriseBlockedCountries(db);

  for (const countryId of options.countryIds) {
    if (!NPP_CAPITAL_STATES[countryId]) {
      result.skippedNoCapital.push(countryId);
      continue; // coming-soon: no seeded capital state
    }
    if (blocked.has(countryId)) {
      // Planned economy: the state owns the commanding heights and its SOEs
      // come from the budget seeders. Skip before attempting anything - an
      // attempt here can only ever be rejected by the command-economy rule.
      result.skippedBlocked.push(countryId);
      log(`  ${countryId}: skipping NPP corporation spawn (private enterprise blocked)`);
      continue;
    }
    // Banking bootstrap can already have created two financial NPPs in every
    // country. A country-wide existence check used to skip the entire 17-sector
    // sweep in that case, leaving pure-NPP worlds without producers. Fill only
    // the missing slots so a partial bootstrap and a retry are both safe.
    const existing = await db
      .collection<{ type: string }>("corporations")
      .find({ ceoType: "npp", countryId })
      .project<{ type: string }>({ type: 1 })
      .toArray();
    const existingByType = new Map<string, number>();
    for (const corp of existing) {
      existingByType.set(corp.type, (existingByType.get(corp.type) ?? 0) + 1);
    }
    const missing = CORPORATION_TYPES.map((type) => ({
      type,
      count: Math.max(0, options.perSectorCount - (existingByType.get(type) ?? 0)),
    })).filter(({ count }) => count > 0);
    if (missing.length === 0) {
      result.skippedExisting.push(countryId);
      continue;
    }
    try {
      let spawnedCount = 0;
      const typesByCount = new Map<number, (typeof CORPORATION_TYPES)[number][]>();
      for (const { type, count } of missing) {
        const types = typesByCount.get(count) ?? [];
        types.push(type);
        typesByCount.set(count, types);
      }
      for (const [count, sectorTypes] of typesByCount) {
        const spawned = await batchSpawnNppCorporations(db, countryId, {
          sectorTypes,
          perSectorCount: count,
          limitToUnownedPool: true,
        });
        spawnedCount += spawned.length;
      }
      result.spawnedByCountry[countryId] = spawnedCount;
      const unfilled = missing.reduce((sum, { count }) => sum + count, 0) - spawnedCount;
      if (unfilled > 0) {
        result.unfilledByCountry[countryId] = unfilled;
        log(`  ${countryId}: ${unfilled} requested NPP slots lacked unowned capacity`);
      }
      if (spawnedCount > 0) {
        log(`  ${countryId}: spawned ${spawnedCount} NPP corporations`);
        result.countriesSeeded++;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      result.failures.push({ countryId, message });
      log(`  ${countryId}: corp spawn failed - ${message}`);
    }
  }

  return result;
}
