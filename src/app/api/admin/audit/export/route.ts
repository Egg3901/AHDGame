// GET /api/admin/audit/export — NDJSON stream of the same filterable view as
// the paginated list endpoint (forensics/alt-detection rework plan §3.1
// "Read side" + §4.9 frozen contract). Re-uses `buildAuditLogFilter` so URL
// parameters behave identically, but bypasses the page-size limit and
// streams rows as `application/x-ndjson` (one JSON object per line).
//
// Auth: requireAdmin — ADMIN ONLY (plan §4.6: export is admin-depth, not
// exposed to moderators at all). Admins see every category and the raw
// `net`/`meta` fields, so no projection is applied.
// Errors: 400, 401, 403
import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError } from "@/lib/api/errors";
import { getActionAuditLogCollection } from "@/lib/db/collections/actionAuditLog";
import { buildAuditLogFilter, MAX_AUDIT_EXPORT_ROWS } from "@/lib/audit/queryAuditLog";

export async function GET(request: Request) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const { searchParams } = new URL(request.url);
    // `isAdmin: true` — this route requires admin auth outright, so the
    // category/projection stripping in buildAuditLogFilter is a no-op here;
    // pass it through anyway to keep one code path for filter parsing.
    const built = buildAuditLogFilter(searchParams, true);
    if (!built.ok) return NextResponse.json({ error: built.error }, { status: 400 });
    // Cursor pagination doesn't apply to a full export — start from the
    // newest row within the rest of the filter every time.
    delete built.filter._id;

    const db = await getDb();
    const collection = await getActionAuditLogCollection(db);

    // Response headers must be committed before the body starts streaming,
    // so the "was this capped" signal has to be known up front rather than
    // derived from the row count after the fact. `countDocuments` with a
    // `limit` stops scanning as soon as it hits the cap, so this stays a
    // bounded, cheap check even against a large matching set.
    const matchCount = await collection.countDocuments(built.filter, {
      limit: MAX_AUDIT_EXPORT_ROWS + 1,
    });
    const capped = matchCount > MAX_AUDIT_EXPORT_ROWS;

    const cursor = collection.find(built.filter).sort({ _id: -1 }).limit(MAX_AUDIT_EXPORT_ROWS);

    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          for await (const row of cursor) {
            controller.enqueue(encoder.encode(JSON.stringify(row) + "\n"));
          }
        } catch (error) {
          // Best-effort: the stream is already committed to the client at
          // this point, so surface the failure to Sentry rather than
          // throwing into a response that has already started.
          controller.error(error);
          return;
        }
        controller.close();
      },
    });

    const filename = `action-audit-${new Date().toISOString().replace(/[:.]/g, "-")}.ndjson`;
    return new NextResponse(stream, {
      status: 200,
      headers: {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "X-Capped": String(capped),
      },
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
