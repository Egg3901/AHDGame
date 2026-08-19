// GET /api/admin/audit/trace/:traceId — full causal chain for one traceId,
// ordered `seq` ascending (forensics/alt-detection rework plan §3.1/§4.7
// "Follow the trace" + §4.9 frozen contract).
//
// Auth: requireModerator. Same role gating as the list endpoint: non-admin
// callers never see `category:"admin"` rows or raw `meta`/`net`.
// Errors: 400, 403
import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireModerator } from "@/lib/api/requireModerator";
import { handleRouteError } from "@/lib/api/errors";
import { queryAuditTrace } from "@/lib/audit/queryAuditLog";

interface RouteParams {
  params: Promise<{ traceId: string }>;
}

export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const auth = await requireModerator();
    if (!auth.ok) return auth.response;

    const { traceId } = await params;
    if (!traceId?.trim()) {
      return NextResponse.json({ error: "Invalid traceId" }, { status: 400 });
    }

    const isAdmin = auth.user.isAdmin === true;
    const db = await getDb();
    const rows = await queryAuditTrace(db, traceId, isAdmin);

    return NextResponse.json({ traceId, rows });
  } catch (error) {
    return handleRouteError(error);
  }
}
