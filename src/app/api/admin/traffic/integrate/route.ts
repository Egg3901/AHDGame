import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError } from "@/lib/api/errors";
import { getSiteTrafficPageviewsCollection } from "@/lib/db/collections/siteTrafficPageviews";

// POST /api/admin/traffic/integrate — Creates TTL and query indexes on siteTrafficPageviews.
// Idempotent: safe to call more than once. Returns { alreadyDone: true } if indexes exist.
// Auth: requireAdmin
// Errors: 403
export async function POST() {
  try {
    const gate = await requireAdmin();
    if (!gate.ok) return gate.response;

    const coll = await getSiteTrafficPageviewsCollection();

    // Check if already integrated (TTL index is the sentinel)
    const info = await coll.indexInformation();
    if ("stpv_recordedAt_ttl" in info) {
      return NextResponse.json({ success: true, alreadyDone: true });
    }

    // Create TTL index (~180 days) and compound query index
    await coll.createIndex(
      { recordedAt: 1 },
      { name: "stpv_recordedAt_ttl", expireAfterSeconds: 15552000 }
    );
    await coll.createIndex({ recordedAt: -1, path: 1 }, { name: "stpv_recordedAt_path" });

    return NextResponse.json({ success: true, alreadyDone: false });
  } catch (error) {
    return handleRouteError(error);
  }
}
