// GET /api/admin/audit — paginated, filterable action-audit spine query
// (forensics/alt-detection rework plan §3.1 "Read side" + §4.9 frozen contract).
//
// Auth: requireModerator (moderators AND admins may query — this is the
// Forensic Explorer's primary data source, and moderator triage is the
// default flow per plan §4.5). Role gating happens server-side after auth:
// non-admin callers never see `category:"admin"` rows or raw `meta`/`net`
// (plan §4.6 role matrix), enforced via `buildAuditLogFilter`/
// `auditProjectionFor` in `src/lib/audit/queryAuditLog.ts` so every read
// route shares one implementation of the rule.
//
// Errors: 400, 401, 403
import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireModerator } from "@/lib/api/requireModerator";
import { handleRouteError } from "@/lib/api/errors";
import { buildAuditLogFilter, queryAuditLog } from "@/lib/audit/queryAuditLog";

export async function GET(request: Request) {
  try {
    const auth = await requireModerator();
    if (!auth.ok) return auth.response;

    const isAdmin = auth.user.isAdmin === true;
    const { searchParams } = new URL(request.url);
    const built = buildAuditLogFilter(searchParams, isAdmin);
    if (!built.ok) return NextResponse.json({ error: built.error }, { status: 400 });

    const db = await getDb();
    const { rows, nextCursor, truncated } = await queryAuditLog(
      db,
      built.filter,
      built.limit,
      isAdmin
    );

    return NextResponse.json({
      rows,
      ...(nextCursor ? { nextCursor } : {}),
      truncated,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
