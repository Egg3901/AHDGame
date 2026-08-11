import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError } from "@/lib/api/errors";
import { parseJsonBody } from "@/lib/api/validate";
import { createAdminLog } from "@/lib/adminLog";
import { MIGRATIONS } from "@/lib/migrations/registry";
import { runMigrations } from "@/lib/migrations/runner";
import type { GameConfig } from "@/lib/db/types";
import type { IndexFundsMode } from "@/lib/indexFunds/featureFlag";

const patchSchema = z.object({
  mode: z.enum(["off", "partial", "full"]),
});

/**
 * Migrations that must run before the index-funds feature is usable. Both are
 * idempotent: `foundation` creates collection indexes; `seed` upserts the 20
 * fund definition documents. The runner skips any whose marker already
 * exists, so calling this on a re-enable is a safe no-op after the first run.
 */
const INDEX_FUND_BOOTSTRAP_MIGRATIONS = [
  "2026-06-01-index-fund-foundation",
  "2026-06-01-index-fund-seed",
  "2026-06-02-index-fund-real-bonds",
];

// GET /api/admin/config/index-funds — Index-funds feature mode
// Auth: requireAdmin
// Errors: 403
export async function GET() {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const db = await getDb();
    const config = await db
      .collection<GameConfig>("gameConfig")
      .findOne({ _id: "default" }, { projection: { indexFundsMode: 1 } });

    const mode: IndexFundsMode =
      config?.indexFundsMode === "partial" || config?.indexFundsMode === "full"
        ? config.indexFundsMode
        : "off";

    return NextResponse.json({ mode });
  } catch (error) {
    return handleRouteError(error);
  }
}

// PATCH /api/admin/config/index-funds — Set index funds mode
// Auth: requireAdmin
// Errors: 400, 403
export async function PATCH(request: Request) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const parsed = await parseJsonBody(request, patchSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const { mode } = parsed.data;

    const db = await getDb();
    const gameConfig = db.collection<GameConfig>("gameConfig");

    // Read the prior value so we know whether this is a fresh enable (and
    // therefore whether the bootstrap migrations need to run).
    const priorConfig = await gameConfig.findOne(
      { _id: "default" },
      { projection: { indexFundsMode: 1 } }
    );
    const priorMode: IndexFundsMode =
      priorConfig?.indexFundsMode === "partial" || priorConfig?.indexFundsMode === "full"
        ? priorConfig.indexFundsMode
        : "off";

    const wasEnabled = priorMode !== "off";
    const isEnabled = mode !== "off";

    let bootstrap: Awaited<ReturnType<typeof runMigrations>> | null = null;
    if (isEnabled && !wasEnabled) {
      bootstrap = await runMigrations(db, {
        migrations: MIGRATIONS,
        dryRun: false,
        only: INDEX_FUND_BOOTSTRAP_MIGRATIONS,
      });
    }

    await gameConfig.updateOne(
      { _id: "default" },
      { $set: { indexFundsMode: mode } },
      { upsert: true }
    );

    await createAdminLog({
      category: "system",
      action: isEnabled ? "index_funds_enabled" : "index_funds_disabled",
      username: auth.admin.username,
      adminUsername: auth.admin.username,
      details:
        mode === "off"
          ? "Index funds disabled; fund APIs, UI, and cron behavior remain unavailable."
          : bootstrap && bootstrap.ranIds.length > 0
            ? `Index funds set to "${mode}". Ran bootstrap migrations: ${bootstrap.ranIds.join(", ")}.`
            : bootstrap
              ? `Index funds set to "${mode}". Bootstrap migrations already applied.`
              : `Index funds mode set to "${mode}".`,
    });

    return NextResponse.json({
      success: true,
      mode,
      bootstrap: bootstrap
        ? {
            ranIds: bootstrap.ranIds,
            skippedIds: bootstrap.skippedIds,
          }
        : null,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
