import { getDb } from "@/lib/mongodb";
import type { GameConfig } from "@/lib/db/types";

/**
 * `altScoringEnabled` — master flag for the weighted-evidence alt-detection
 * confidence model (forensics/alt-detection rework plan §3.2/§6). When on,
 * the alt-scoring compute path (src/lib/altDetection/run.ts) upserts
 * `altLinks`/`altClusters` from the signal registry.
 *
 * ON by default. `gameConfig.altScoringEnabled` is an ops kill-switch: set it
 * explicitly to `false` (via `/api/admin/config`) to disable the hourly
 * alt-scoring compute; absent or any other value means enabled.
 */

let cached: { value: boolean; at: number } | null = null;
const CACHE_TTL_MS = 30_000;

export function isAltScoringEnabledFromConfig(
  config?: Pick<GameConfig, "altScoringEnabled"> | null
): boolean {
  return config?.altScoringEnabled !== false;
}

/**
 * Resolve the flag. Cached for 30s so hot paths don't read Mongo per call.
 * Pass a preloaded config to bypass the cache (turn phases already hold one).
 */
export async function isAltScoringEnabled(
  preloadedConfig?: Pick<GameConfig, "altScoringEnabled"> | null
): Promise<boolean> {
  if (preloadedConfig !== undefined) {
    return isAltScoringEnabledFromConfig(preloadedConfig);
  }
  const now = Date.now();
  if (cached && now - cached.at < CACHE_TTL_MS) return cached.value;
  let value = true;
  try {
    const db = await getDb();
    const config = await db
      .collection<GameConfig>("gameConfig")
      .findOne({ _id: "default" }, { projection: { altScoringEnabled: 1 } });
    value = config?.altScoringEnabled !== false;
  } catch {
    value = true;
  }
  cached = { value, at: now };
  return value;
}

/** Test/hot-reload helper — clears the cached flag value. */
export function resetAltScoringFlagCache(): void {
  cached = null;
}
