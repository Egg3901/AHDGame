import { NextResponse } from "next/server";
import { handleRouteError } from "@/lib/api/errors";
import { getDb } from "@/lib/mongodb";
import type { GameConfig } from "@/lib/db/types";
import { normalizeMaintenanceMode } from "@/lib/maintenanceStatus";

// In-memory cache for maintenance status (TTL 10s) — reduces load on gameConfig reads.
// Maintenance status rarely changes, so brief caching is safe.
let maintenanceCache: { data: GameConfig | null; timestamp: number } | null = null;
const MAINTENANCE_CACHE_TTL_MS = 10_000;

// GET /api/maintenance — Returns the current maintenance mode status, reason, and expected end time.
// Auth: public
// Errors: (none)
/** GET — public maintenance status (used by the maintenance page) */
export async function GET() {
  try {
    const now = Date.now();
    if (maintenanceCache && now - maintenanceCache.timestamp < MAINTENANCE_CACHE_TTL_MS) {
      const config = maintenanceCache.data;
      const mode = normalizeMaintenanceMode(config?.maintenanceMode);
      return NextResponse.json(
        {
          mode,
          enabled: mode !== "off",
          reason: config?.maintenanceReason ?? "",
          expectedEnd: config?.maintenanceExpectedEnd ?? "",
        },
        {
          headers: {
            "Cache-Control":
              "public, max-age=10, s-maxage=10, stale-while-revalidate=10, no-transform",
          },
        }
      );
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

    maintenanceCache = { data: config, timestamp: now };

    const mode = normalizeMaintenanceMode(config?.maintenanceMode);
    return NextResponse.json(
      {
        mode,
        enabled: mode !== "off",
        reason: config?.maintenanceReason ?? "",
        expectedEnd: config?.maintenanceExpectedEnd ?? "",
      },
      {
        headers: {
          "Cache-Control":
            "public, max-age=10, s-maxage=10, stale-while-revalidate=10, no-transform",
        },
      }
    );
  } catch (error) {
    return handleRouteError(error);
  }
}
