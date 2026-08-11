// GET /api/moderator/financial-logs/alerts — suspect alert summary grouped by subject entity
// Auth: requireModerator
// Errors: 401, 403
import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireModerator } from "@/lib/api/requireModerator";
import { handleRouteError } from "@/lib/api/errors";
import { queryTxAlerts } from "@/lib/financialTxLog/queryLogs";

export async function GET() {
  try {
    const auth = await requireModerator();
    if (!auth.ok) return auth.response;

    const db = await getDb();
    const result = await queryTxAlerts(db);
    return NextResponse.json(result);
  } catch (error) {
    return handleRouteError(error);
  }
}
