import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError } from "@/lib/api/errors";
import { parseJsonBody } from "@/lib/api/validate";
import { createAdminLog } from "@/lib/adminLog";
import type { GameConfig } from "@/lib/db/types";
import { getGameStatePresetOrDefault } from "@/lib/db/collections/gameState";
import { getLabourSystemMode, type LabourSystemMode } from "@/lib/labour/featureFlag";
import { seedUnions } from "@/lib/admin/seed/seedUnions";

const patchSchema = z.object({
  mode: z.enum(["off", "wages", "macro", "unions", "full"]),
});

// GET /api/admin/config/labour — Labour/Unions system mode
// Auth: requireAdmin
// Errors: 403
export async function GET() {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const mode = await getLabourSystemMode();
    return NextResponse.json({ mode });
  } catch (error) {
    return handleRouteError(error);
  }
}

// PATCH /api/admin/config/labour — Set labour system mode
// Auth: requireAdmin
// Errors: 400, 403
//
// Phase 0: pure flag scaffolding. Setting a mode has no economic effect until
// the corresponding phases land and read the flag (see
// docs/plans/2026-06-30-labour-system.md). No bootstrap migrations yet — the
// labour system adds no new collections at this stage.
//
// Exception (v3 Phase 8 follow-up): flipping INTO "full" backfills the vacant
// union roster via `seedUnions` (reset:false — the idempotent $setOnInsert
// upsert bootstrapGameWorld uses). Player `Union` docs are only ever created
// by `seedUnions`, so a world bootstrapped before Phase 8 landed (or with the
// unions target skipped) would otherwise reach "full" with zero claimable
// unions.
export async function PATCH(request: Request) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const parsed = await parseJsonBody(request, patchSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const { mode } = parsed.data as { mode: LabourSystemMode };

    const db = await getDb();
    const gameConfig = db.collection<GameConfig>("gameConfig");

    const priorMode = await getLabourSystemMode();

    await gameConfig.updateOne(
      { _id: "default" },
      {
        $set: {
          labourSystemMode: mode,
          labourSystemModeUpdatedBy: auth.admin.username,
          labourSystemModeUpdatedAt: new Date().toISOString(),
        },
      },
      { upsert: true }
    );

    // Auto-seed player unions on the transition INTO "full" (not on a
    // re-PATCH of "full" — idempotent anyway, but skipping keeps the response
    // honest about when a backfill actually ran). reset stays false: this
    // route must never wipe claimed unions.
    let unionsSeeded: number | undefined;
    let seedError: string | undefined;
    if (mode === "full" && priorMode !== "full") {
      // Union names are era-appropriate when the world's reset preset is
      // known — same argument bootstrapGameWorld threads through. Worlds
      // bootstrapped before GameState.preset was recorded fall back to
      // seedUnions' generic default ("2019-default").
      //
      // A seed failure must not fail the PATCH: the mode write above has
      // already committed, and a 500 here would leave a "full" world whose
      // retry PATCH (priorMode now "full") never re-attempts the backfill.
      // The per-turn safety net only covers the zero-doc case, not a
      // mid-loop partial seed, so surface the error and let the admin rerun
      // POST /api/admin/seed {targets:["unions"], reset:false}.
      try {
        unionsSeeded = await seedUnions(
          db,
          (msg) => console.log(`[labour-config] ${msg}`),
          await getGameStatePresetOrDefault(db),
          false
        );
      } catch (error) {
        seedError = error instanceof Error ? error.message : String(error);
        console.error(`[labour-config] union backfill failed: ${seedError}`);
      }
    }

    await createAdminLog({
      category: "system",
      action: mode === "off" ? "labour_system_disabled" : "labour_system_set",
      username: auth.admin.username,
      adminUsername: auth.admin.username,
      details:
        mode === "off"
          ? `Labour system disabled (was "${priorMode}"). Economy reverts to baseline behavior.`
          : `Labour system mode set to "${mode}" (was "${priorMode}").` +
            (unionsSeeded !== undefined ? ` Backfilled ${unionsSeeded} vacant union(s).` : "") +
            (seedError !== undefined
              ? ` Union backfill FAILED (${seedError}); rerun the unions seed target manually.`
              : ""),
    });

    return NextResponse.json({
      success: true,
      mode,
      priorMode,
      ...(unionsSeeded !== undefined ? { unionsSeeded } : {}),
      ...(seedError !== undefined ? { seedError } : {}),
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
