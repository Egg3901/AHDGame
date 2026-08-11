import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError } from "@/lib/api/errors";
import type { TurnLog } from "@/lib/db/types";

/**
 * GET /api/admin/logs/hourly
 * Fetch the last 24 hours of turn logs (verbose hourly logging).
 */
// GET /api/admin/logs/hourly — Fetch the last 24 hours of turn processing logs.
// Auth: requireAdmin
// Errors: 401, 403
export async function GET() {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const db = await getDb();

    // Ensure TTL index exists (24 hours = 86400 seconds)
    // This is idempotent - MongoDB will skip if index already exists
    await db
      .collection("turnLogs")
      .createIndex({ createdAt: 1 }, { expireAfterSeconds: 86400 })
      .catch(() => {
        // Index may already exist with different options, ignore
      });

    // Fetch last 24 hours of logs, sorted newest first
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const logs = await db
      .collection<TurnLog>("turnLogs")
      .find({ createdAt: { $gte: twentyFourHoursAgo } })
      .sort({ createdAt: -1 })
      .toArray();

    return NextResponse.json({
      logs: logs.map((log) => ({
        id: log._id.toString(),
        turn: log.turn,
        year: log.year,
        gameTime: log.gameTime,
        realTime: log.realTime,
        durationMs: log.durationMs,
        success: log.success,
        warnings: log.warnings,
        phaseStatuses: log.phaseStatuses ?? null,
        phases: log.phases,
        createdAt: log.createdAt,
      })),
      count: logs.length,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
