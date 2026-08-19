import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { withAdminAuth } from "@/lib/api/withAdminAuth";
import { handleRouteError } from "@/lib/api/errors";

/**
 * Get the most recent code quality snapshot, optionally filtered by environment.
 * Auth: requireAdmin()
 * Errors: 403, 404
 */
export const GET = withAdminAuth(async (_auth, request: Request) => {
  try {
    const url = new URL(request.url);
    const environment = url.searchParams.get("environment") || undefined;

    const db = await getDb();
    const filter: Record<string, unknown> = {};
    if (environment) filter.environment = environment;

    const snapshot = await db
      .collection("codeQualitySnapshots")
      .findOne(filter, { sort: { timestamp: -1 } });

    if (!snapshot) {
      return NextResponse.json({ error: "No snapshots available" }, { status: 404 });
    }

    return NextResponse.json({ snapshot });
  } catch (error) {
    return handleRouteError(error);
  }
});
