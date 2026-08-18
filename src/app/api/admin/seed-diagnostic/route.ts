/**
 * GET /api/admin/seed-diagnostic — latest seed diagnostic report(s).
 * POST /api/admin/seed-diagnostic — run conformance or drift diagnostic.
 *
 * Auth: requireAdminOrApiKey
 * Errors: 400, 401, 403, 500
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireAdminOrApiKey } from "@/lib/api/requireAdminOrApiKey";
import { handleRouteError } from "@/lib/api/errors";
import { runSeedDiagnostic } from "@/lib/admin/seedDiagnostic";

const postSchema = z.object({
  mode: z.enum(["conformance", "drift"]).default("conformance"),
});

// GET /api/admin/seed-diagnostic — Return latest seed diagnostic report(s).
// Auth: requireAdminOrApiKey
// Errors: 401, 403, 500
export async function GET(request: Request) {
  try {
    const auth = await requireAdminOrApiKey(request);
    if (!auth.ok) return auth.response;

    const { searchParams } = new URL(request.url);
    const limitRaw = Number(searchParams.get("limit") ?? "1");
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(1, limitRaw), 50) : 1;

    const db = await getDb();
    const reports = await db
      .collection("seedDiagnostics")
      .find({})
      .sort({ ranAt: -1 })
      .limit(limit)
      .toArray();

    return NextResponse.json({ reports, latest: reports[0] ?? null });
  } catch (error) {
    return handleRouteError(error);
  }
}

// POST /api/admin/seed-diagnostic — Run a seed diagnostic and persist the report.
// Auth: requireAdminOrApiKey
// Errors: 400, 401, 403, 500
export async function POST(request: Request) {
  try {
    const auth = await requireAdminOrApiKey(request);
    if (!auth.ok) return auth.response;

    // Empty body → {} so zod defaults mode to "conformance".
    const text = await request.text();
    let raw: unknown = {};
    if (text.trim() !== "") {
      try {
        raw = JSON.parse(text);
      } catch {
        return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
      }
    }
    const parsed = postSchema.safeParse(raw);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      const path = first?.path?.join(".") || "body";
      const message = first ? `${path}: ${first.message}` : "Validation failed";
      return NextResponse.json({ error: message }, { status: 400 });
    }

    const db = await getDb();
    const report = await runSeedDiagnostic(db, {
      mode: parsed.data.mode,
      trigger: "manual",
    });

    return NextResponse.json({ success: true, report });
  } catch (error) {
    return handleRouteError(error);
  }
}
