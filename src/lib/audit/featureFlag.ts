import { getDb } from "@/lib/mongodb";
import type { GameConfig } from "@/lib/db/types";

/**
 * `auditLog` — master flag for the unified action-audit spine
 * (forensics/alt-detection rework plan §3.1/§6). When on, `recordAudit`/
 * `recordAuditBulk` (src/lib/audit/recordAudit.ts) write normalized
 * envelopes into `actionAuditLog` from the money/staff/auth/turn choke
 * points.
 *
 * ON by default. `gameConfig.auditLog` is an ops kill-switch, not an
 * off-by-default gate: set it explicitly to `false` (via `/api/admin/config`)
 * to disable auditing if it ever needs to be cut on the hot path; absent or
 * any other value means enabled.
 */

let cached: { value: boolean; at: number } | null = null;
const CACHE_TTL_MS = 30_000;

export function isAuditLogEnabledFromConfig(config?: Pick<GameConfig, "auditLog"> | null): boolean {
  return config?.auditLog !== false;
}

/**
 * Resolve the flag. On the hot write path this must NOT read Mongo per call,
 * so the value is cached for 30s. Pass a preloaded config to bypass the
 * cache (turn phases already hold one).
 */
export async function isAuditLogEnabled(
  preloadedConfig?: Pick<GameConfig, "auditLog"> | null
): Promise<boolean> {
  if (preloadedConfig !== undefined) {
    return isAuditLogEnabledFromConfig(preloadedConfig);
  }
  const now = Date.now();
  if (cached && now - cached.at < CACHE_TTL_MS) return cached.value;
  let value = true;
  try {
    const db = await getDb();
    const config = await db
      .collection<GameConfig>("gameConfig")
      .findOne({ _id: "default" }, { projection: { auditLog: 1 } });
    value = config?.auditLog !== false;
  } catch {
    value = true;
  }
  cached = { value, at: now };
  return value;
}

/** Test/hot-reload helper — clears the cached flag value. */
export function resetAuditLogFlagCache(): void {
  cached = null;
}
