import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { withAdminAuth } from "@/lib/api/withAdminAuth";
import { handleRouteError } from "@/lib/api/errors";

// GET /api/admin/bot-api-keys - Lists active bot API keys and recent bot API request logs for admins.
// Auth: requireAdmin
// Errors: 401
export const GET = withAdminAuth(async () => {
  try {
    const db = await getDb();
    const [keys, recent] = await Promise.all([
      db
        .collection("botApiKeys")
        .find({ revokedAt: null })
        .project({ tokenHash: 0 })
        .sort({ lastUsedAt: -1, createdAt: -1 })
        .limit(200)
        .toArray(),
      db.collection("botApiRequestLog").find({}).sort({ createdAt: -1 }).limit(500).toArray(),
    ]);
    return NextResponse.json({ keys, recent });
  } catch (error) {
    return handleRouteError(error);
  }
});
