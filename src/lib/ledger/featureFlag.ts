import { getDb } from "@/lib/mongodb";
import type { GameConfig } from "@/lib/db/types";

/**
 * `ledgerShadow` — master flag for the shadow double-entry ledger.
 *
 * OFF by default in prod seeds (Phases 1-2 ship dark); ON in the sim harness
 * (scripts/sim/runWorld.ts) where the reconciler on a known-clean world is the
 * acceptance test. Absent/undefined = off. See
 * docs/plans/2026-07-05-shadow-ledger-plan.md §3.
 */

let cached: { value: boolean; at: number } | null = null;
const CACHE_TTL_MS = 30_000;

export function isLedgerShadowEnabledFromConfig(
  config?: Pick<GameConfig, "ledgerShadow"> | null
): boolean {
  return config?.ledgerShadow === true;
}

/**
 * Resolve the flag. On the hot emit path this must NOT read Mongo per call, so
 * the value is cached for 30s. Pass a preloaded config to bypass the cache
 * (turn phases already hold one).
 */
export async function isLedgerShadowEnabled(
  preloadedConfig?: Pick<GameConfig, "ledgerShadow"> | null
): Promise<boolean> {
  if (preloadedConfig !== undefined) {
    return isLedgerShadowEnabledFromConfig(preloadedConfig);
  }
  const now = Date.now();
  if (cached && now - cached.at < CACHE_TTL_MS) return cached.value;
  let value = false;
  try {
    const db = await getDb();
    const config = await db
      .collection<GameConfig>("gameConfig")
      .findOne({ _id: "default" }, { projection: { ledgerShadow: 1 } });
    value = config?.ledgerShadow === true;
  } catch {
    value = false;
  }
  cached = { value, at: now };
  return value;
}

/** Test/hot-reload helper — clears the cached flag value. */
export function resetLedgerShadowFlagCache(): void {
  cached = null;
}
