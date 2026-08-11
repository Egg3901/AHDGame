import type { Db } from "mongodb";
import { getDb } from "@/lib/mongodb";
import type { GameConfig } from "@/lib/db/types";

export type MaintenanceMode = "off" | "partial" | "full";

/**
 * Normalizes the raw `gameConfig.maintenanceMode` field (which may still be
 * the legacy boolean already stored on prod docs) into the tri-state mode.
 * Legacy `true` maps to "full" (the old boolean's only "on" behavior);
 * `false`/absent/anything else unrecognized maps to "off".
 */
export function normalizeMaintenanceMode(raw: GameConfig["maintenanceMode"]): MaintenanceMode {
  if (raw === "off" || raw === "partial" || raw === "full") return raw;
  return raw ? "full" : "off";
}

export interface MaintenanceStatusSnapshot {
  mode: MaintenanceMode;
  /** True when mode !== "off" — convenience for "is maintenance active at all" checks. */
  enabled: boolean;
  reason: string;
  expectedEnd: string;
}

/** Paths reachable to everyone (including non-admins) while maintenance is on.
 *  Shared between src/proxy.ts (primary gate) and src/app/layout.tsx (defense
 *  in depth) so the two enforcement points cannot drift apart. */
export const MAINTENANCE_PUBLIC_PATHS: readonly string[] = ["/", "/login"];

/** Path prefixes whose subtrees stay reachable during maintenance, in addition
 *  to the public paths above. Matched by `isMaintenanceBypassPath` below as the
 *  prefix itself or anything under `prefix/`.
 *
 *  `/retired` and `/settings` are open so a player between iterations can still
 *  reach their character history and re-watch the Season Recap ("Wrapped") for
 *  ANY past character — not just the single newest one the `/maintenance` page
 *  surfaces. Without them the maintenance wall makes that page's "Also saved to
 *  your character history" a dead end.
 *
 *  Unsealing `/settings` exposes account management (Danger Zone, API keys,
 *  password change) during the down-window. That widens the *page* surface
 *  only, not the API surface: `src/proxy.ts` returns early for `/api/*`, so
 *  those endpoints were never behind the maintenance gate to begin with. Each
 *  one keeps its own auth, and character creation is separately blocked in
 *  `POST /api/auth/character`. */
export const MAINTENANCE_BYPASS_PREFIXES: readonly string[] = [
  "/maintenance",
  "/monitoring",
  "/retired",
  "/settings",
  // Public season-recap share links must open even while the game is between
  // iterations (maintenance) — that's exactly when players share them.
  "/wrapped",
  // The changelog is our announcement surface; a down-window is exactly when
  // players come looking for what changed. Content is static markdown with no
  // game-state reads, so it is safe to serve while sealed.
  "/changelog",
];

/** True when the path is reachable to non-admins during maintenance.
 *
 *  A prefix `p` matches `p` exactly or any path under `p/` — never a mere
 *  substring, so `/settings` does not open `/settingsomething`. Matches the
 *  semantics of `isCharacterGatedPath` in `@/lib/auth/characterGate`. */
export function isMaintenanceBypassPath(pathname: string): boolean {
  return (
    MAINTENANCE_PUBLIC_PATHS.includes(pathname) ||
    MAINTENANCE_BYPASS_PREFIXES.some(
      (prefix) => pathname === prefix || pathname.startsWith(prefix + "/")
    )
  );
}

let maintenanceCache: { snapshot: MaintenanceStatusSnapshot; expiresAt: number } | null = null;
const MAINTENANCE_CACHE_TTL_MS = 5 * 60 * 1000;

/** Drop the in-memory snapshot so the next read goes back to the DB. Call
 *  when the admin toggles maintenance so the serving process picks up the
 *  new state on its next request instead of waiting up to the full TTL. */
export function invalidateMaintenanceCache(): void {
  maintenanceCache = null;
}

/**
 * Reads the maintenance flag from `gameConfig` — the single source of truth,
 * the same document the admin panel writes and `/api/maintenance` reports.
 *
 * There is deliberately NO environment-variable escape hatch here. A
 * `MAINTENANCE_MODE=false` env override used to short-circuit this function
 * before the DB read, which silently defeated the admin toggle: the admin panel
 * (which reads `gameConfig`) showed the site as sealed while the proxy gate let
 * everyone through. That gap let non-admins register and create characters
 * during a reset. If maintenance needs to be forced on/off, toggle it in the
 * DB via `PATCH /api/admin/maintenance` or `enableMaintenanceMode()` so every
 * reader agrees.
 */
export async function getCachedMaintenanceStatus(): Promise<MaintenanceStatusSnapshot> {
  const now = Date.now();
  if (maintenanceCache && now < maintenanceCache.expiresAt) {
    return maintenanceCache.snapshot;
  }

  const db = await getDb();
  const config = await db.collection<GameConfig>("gameConfig").findOne(
    { _id: "default" },
    {
      projection: {
        maintenanceMode: 1,
        maintenanceReason: 1,
        maintenanceExpectedEnd: 1,
      },
    }
  );

  const mode = normalizeMaintenanceMode(config?.maintenanceMode);
  const snapshot: MaintenanceStatusSnapshot = {
    mode,
    enabled: mode !== "off",
    reason: config?.maintenanceReason ?? "",
    expectedEnd: config?.maintenanceExpectedEnd ?? "",
  };

  maintenanceCache = {
    snapshot,
    expiresAt: now + MAINTENANCE_CACHE_TTL_MS,
  };

  return snapshot;
}

/**
 * Programmatically enable maintenance mode and invalidate the in-process
 * cache. Used by `resetAndBootstrapGameWorld` so a freshly-reset world
 * stays sealed behind maintenance until an admin verifies the new state
 * and manually toggles it off via `PATCH /api/admin/maintenance`.
 *
 * Mirrors what the admin maintenance PATCH endpoint writes
 * (`maintenanceMode` + `maintenanceReason` + `maintenanceExpectedEnd` +
 * `maintenanceEnabledBy` + `maintenanceEnabledAt`) so the admin UI's
 * "currently enabled" panel renders correctly regardless of which path
 * turned it on. Does NOT write an `adminLogs` row — callers own that
 * audit step. Callers also own their own preset/reset audit logs.
 */
export async function enableMaintenanceMode(
  db: Db,
  options: {
    /** Player-visible reason rendered on `/maintenance` and login. */
    reason: string;
    /** Username (or `"CLI"`) recorded on the audit fields. */
    enabledBy: string;
    /** Optional ISO timestamp shown to players as the expected reopen time. */
    expectedEnd?: string;
  }
): Promise<void> {
  const now = new Date().toISOString();
  await db.collection<GameConfig>("gameConfig").updateOne(
    { _id: "default" },
    {
      $set: {
        maintenanceMode: "full",
        maintenanceReason: options.reason,
        maintenanceExpectedEnd: options.expectedEnd ?? "",
        maintenanceEnabledBy: options.enabledBy,
        maintenanceEnabledAt: now,
      },
    },
    { upsert: true }
  );
  invalidateMaintenanceCache();
}
