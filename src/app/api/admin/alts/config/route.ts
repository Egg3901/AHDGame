// GET/PUT /api/admin/alts/config — alt-detection scoring weights/thresholds
// Auth: GET requireModerator (all staff roles read); PUT requireAdmin only
// Errors: 400, 403
//
// Frozen contract (forensics/alt-detection rework plan §4.9):
//   GET /api/admin/alts/config -> { weights:{...}, thresholds:{link, cluster} }   (all roles)
//   PUT /api/admin/alts/config -> updates weights/thresholds                       (admin only)
//
// `thresholds` in the response also includes `strongLink` (the ring-role /
// ring-confidence cutoff `src/lib/altDetection/cluster.ts` reads) — the
// plan's shorthand names `link`/`cluster` as the two headline knobs, but the
// full `AltScoringThresholds` shape has three fields and the admin
// `ScoringConfigPanel` (plan §4.8) needs all three to be editable.
import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireModerator } from "@/lib/api/requireModerator";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError } from "@/lib/api/errors";
import { parseJsonBody } from "@/lib/api/validate";
import { createAdminLog } from "@/lib/adminLog";
import { resolveAltScoringConfig } from "@/lib/altDetection/config";
import type { GameConfig } from "@/lib/db/types";

// GET /api/admin/alts/config
export async function GET() {
  try {
    const auth = await requireModerator();
    if (!auth.ok) return auth.response;

    const db = await getDb();
    const gameConfig = await db
      .collection<GameConfig>("gameConfig")
      .findOne({ _id: "default" }, { projection: { altScoring: 1 } });

    const resolved = resolveAltScoringConfig(gameConfig?.altScoring);
    return NextResponse.json(resolved);
  } catch (error) {
    return handleRouteError(error);
  }
}

// Loosely typed at the boundary — `resolveAltScoringConfig` is the actual
// validator (drops out-of-range/malformed values rather than 400ing, so a
// partial or slightly-off admin edit still lands a sane config). This
// schema only guards the top-level shape (object of primitives, not an
// array/string/nested object bomb) before it reaches that merge.
const putSchema = z.object({
  weights: z.record(z.string(), z.unknown()).optional(),
  thresholds: z.record(z.string(), z.unknown()).optional(),
});

// PUT /api/admin/alts/config — admin only (plan §4.6: editing scoring
// weights/thresholds is an admin-only capability; moderators read-only).
export async function PUT(request: Request) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const parsed = await parseJsonBody(request, putSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const resolved = resolveAltScoringConfig(parsed.data);

    const db = await getDb();
    await db.collection<GameConfig>("gameConfig").updateOne(
      { _id: "default" },
      {
        $set: {
          // `resolveAltScoringConfig` returns the fully-keyed `AltSignalWeights`/
          // `AltScoringThresholds` shapes (every key present); widen to plain
          // `Record<string, number>` for storage — `GameConfig.altScoring`
          // deliberately types its fields loosely (no `lib/altDetection`
          // import into `db/types/gameConfig.ts`, matching how e.g.
          // `labourSystemMode` inlines its own literal union there).
          altScoring: {
            weights: { ...resolved.weights } as Record<string, number>,
            thresholds: { ...resolved.thresholds } as Record<string, number>,
          },
          altScoringUpdatedBy: auth.admin.username,
          altScoringUpdatedAt: new Date().toISOString(),
        },
      },
      { upsert: true }
    );

    await createAdminLog({
      category: "system",
      action: "alt_scoring_config_updated",
      username: auth.admin.username,
      adminUsername: auth.admin.username,
      details: "Alt-detection scoring weights/thresholds updated.",
    });

    return NextResponse.json({ success: true, ...resolved });
  } catch (error) {
    return handleRouteError(error);
  }
}
