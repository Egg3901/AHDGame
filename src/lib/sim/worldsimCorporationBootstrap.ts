import type { Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
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
  /** Planned economies skipped BEFORE any spawn attempt (zero attempts, zero noise). */
  skippedBlocked: string[];
  /** Countries that already had NPP corps (idempotent retry path). */
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
    const existing = await db
      .collection("corporations")
      .countDocuments({ ceoType: "npp", countryId });
    if (existing > 0) {
      result.skippedExisting.push(countryId);
      continue;
    }
    try {
      const spawned = await batchSpawnNppCorporations(db, countryId, {
        perSectorCount: options.perSectorCount,
      });
      result.spawnedByCountry[countryId] = spawned.length;
      if (spawned.length > 0) {
        log(`  ${countryId}: spawned ${spawned.length} NPP corporations`);
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
