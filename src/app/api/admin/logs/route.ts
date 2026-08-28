import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError } from "@/lib/api/errors";
import type { AdminLog, AdminLogCategory } from "@/lib/db/types";

/**
 * Coerce a stored log field to the `string | null` this route's response
 * contract promises.
 *
 * `adminLogs` is written by ad-hoc heal/migration scripts as well as by the
 * app, and several of those stored `details` as a structured object rather than
 * a string (e.g. the `general_traits_refunded` entry holding
 * `{characterId, refundedPoints, traitsCleared, reason, backupId}`). The route
 * used to pass the value straight through, so the object reached the client and
 * `{log.details}` in LogsTab threw React error #31 — "Objects are not valid as
 * a React child" — which bubbled to the admin error boundary and took down the
 * WHOLE panel with "Couldn't load admin panel", not just the Logs tab. Since
 * the offending row sat inside the default `limit=100` window and in the
 * `account` category the tab opens on, the panel failed every single load.
 *
 * Serialising here keeps the payload readable for the admin instead of dropping
 * it, and honours the declared contract no matter what wrote the row.
 */
function toDisplayString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value || null;
  try {
    return JSON.stringify(value);
  } catch {
    // Circular or otherwise unserialisable — never let a log row 500 the route.
    return String(value);
  }
}

/**
 * Same coercion for the two fields the contract declares as non-nullable
 * (`action`, `username`). They carry the identical risk — `action` in
 * particular is used as the display label when it has no ACTION_CONFIG entry,
 * so an object there reaches JSX just as `details` did — but collapsing them to
 * null would change the response shape, so an empty string is the floor.
 */
function toRequiredString(value: unknown): string {
  return toDisplayString(value) ?? "";
}

// GET /api/admin/logs — List admin action logs with optional category filter and limit.
// Auth: requireAdmin
// Errors: 403
export async function GET(request: Request) {
  try {
    // Verify admin authentication
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const { searchParams } = new URL(request.url);
    const category = searchParams.get("category") as AdminLogCategory | null;
    const limit = parseInt(searchParams.get("limit") || "100", 10);

    const db = await getDb();

    // Build query based on category filter
    const query = category ? { category } : {};

    const logs = await db
      .collection<AdminLog>("adminLogs")
      .find(query)
      .sort({ createdAt: -1 })
      .limit(limit)
      .toArray();

    // Format logs for response
    const formattedLogs = logs.map((log) => ({
      id: log._id.toString(),
      category: log.category,
      action: toRequiredString(log.action),
      username: toRequiredString(log.username),
      characterName: toDisplayString(log.characterName),
      adminUsername: toDisplayString(log.adminUsername),
      details: toDisplayString(log.details),
      createdAt: log.createdAt.toISOString(),
    }));

    return NextResponse.json({
      logs: formattedLogs,
      total: formattedLogs.length,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
