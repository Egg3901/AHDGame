import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { handleRouteError } from "@/lib/api/errors";
import type { User } from "@/lib/db/types";

// GET /api/players/online — Returns the count of non-banned players active within the last hour
// Auth: public
// Errors: (none)
export async function GET() {
  try {
    const db = await getDb();
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

    const onlineCount = await db.collection<User>("users").countDocuments({
      lastActivity: { $gte: oneHourAgo },
      isBanned: { $ne: true },
    });

    return NextResponse.json(
      {
        online: onlineCount,
        asOf: new Date().toISOString(),
      },
      {
        headers: {
          "Cache-Control":
            "public, max-age=120, s-maxage=120, stale-while-revalidate=60, no-transform",
        },
      }
    );
  } catch (error) {
    return handleRouteError(error);
  }
}
