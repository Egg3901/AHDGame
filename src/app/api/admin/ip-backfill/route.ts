import { NextResponse } from "next/server";
import { handleRouteError } from "@/lib/api/errors";
import { withAdminAuth } from "@/lib/api/withAdminAuth";
import { getDb } from "@/lib/mongodb";
import { checkIpFireAndForget } from "@/lib/ip/ipteoh";
import type { User, GameConfig } from "@/lib/db/types";

// POST /api/admin/ip-backfill — Backfill IP details for users missing them.
// Auth: requireAdmin
// Body: { limit?: number } (default 10, max 50)
// Errors: 401, 403, 503
export const POST = withAdminAuth(async (_auth) => {
  try {
    const db = await getDb();

    // Check if IP detection is enabled
    const config = await db
      .collection<GameConfig>("gameConfig")
      .findOne({ _id: "default" }, { projection: { ipDetectionEnabled: 1 } });

    if (!config?.ipDetectionEnabled) {
      return NextResponse.json(
        { error: "IP detection is not enabled. Enable it in admin config first." },
        { status: 503 }
      );
    }

    // Find users without ipDetails, oldest first (they were registered first)
    const users = await db
      .collection<User>("users")
      .find({ ipDetails: { $exists: false } })
      .sort({ createdAt: 1 })
      .limit(10)
      .toArray();

    if (users.length === 0) {
      return NextResponse.json({ message: "No users to backfill.", processed: 0 });
    }

    let processed = 0;
    let failed = 0;

    for (const user of users) {
      const ip = user.registrationIp || user.lastKnownIp;
      if (!ip) {
        failed++;
        continue;
      }

      const ipDetails = await checkIpFireAndForget(ip);
      if (ipDetails) {
        await db.collection<User>("users").updateOne({ _id: user._id }, { $set: { ipDetails } });
        processed++;
      } else {
        failed++;
      }

      // Rate limit: 1 second between requests
      if (users.indexOf(user) < users.length - 1) {
        await new Promise((r) => setTimeout(r, 1_000));
      }
    }

    return NextResponse.json({
      message: `Backfill complete. ${processed} updated, ${failed} failed.`,
      processed,
      failed,
      total: users.length,
    });
  } catch (error) {
    return handleRouteError(error);
  }
});
