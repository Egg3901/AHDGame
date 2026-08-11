/**
 * POST /api/admin/retention
 *
 * Runs the history-retention pipeline (archive old rows to R2, then
 * delete/downsample). Admin-only.
 *
 * Body (JSON):
 *   dryRun?: boolean       - default TRUE. When true, performs no writes and
 *                            returns only the manifest of what WOULD happen.
 *   collections?: string[] - restrict to specific collections (default: all).
 *   compact?: boolean      - run `compact` after deletes to reclaim disk.
 *
 * Execution (dryRun=false) is refused unless env RETENTION_ENABLED === "1",
 * so the endpoint is safe to expose while the pipeline is being rolled out.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError } from "@/lib/api/errors";
import { runRetention } from "@/lib/retention/retention";

const bodySchema = z.object({
  dryRun: z.boolean().optional().default(true),
  collections: z.array(z.string()).optional(),
  compact: z.boolean().optional().default(false),
});

export async function POST(request: Request) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    // The endpoint historically accepted no request body (→ dry-run defaults).
    // Parse tolerantly: an empty or absent body is valid; a present-but-malformed
    // body is rejected.
    let text = "";
    try {
      text = await request.text();
    } catch {
      text = "";
    }
    let raw: unknown = {};
    if (text.trim()) {
      try {
        raw = JSON.parse(text);
      } catch {
        return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
      }
    }
    const parsedBody = bodySchema.safeParse(raw);
    if (!parsedBody.success) {
      return NextResponse.json(
        { error: parsedBody.error.issues[0]?.message ?? "Invalid body" },
        { status: 400 }
      );
    }
    const { dryRun, collections, compact } = parsedBody.data;

    if (!dryRun && process.env.RETENTION_ENABLED !== "1") {
      return NextResponse.json(
        { error: "Retention execution is disabled. Set RETENTION_ENABLED=1 to run for real." },
        { status: 403 }
      );
    }

    const summary = await runRetention({ dryRun, collections, compact });
    return NextResponse.json(summary);
  } catch (error) {
    return handleRouteError(error);
  }
}
