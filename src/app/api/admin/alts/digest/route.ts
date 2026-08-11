// POST /api/admin/alts/digest — manually trigger the "new suspicious rings"
// digest on demand (forensics-v2 Wave 2, scale/learning §C). Admin-only,
// mirrors `/api/admin/retention`'s admin-only manual-trigger pattern
// (moderators can read alt data elsewhere, but triggering an out-of-band
// Discord post is an admin action).
//
// Returns 200 with the `AltDigestRunResult` even when the run found nothing
// new or posted nothing — those are normal outcomes (flag off, no new
// rings, no webhook configured), not failures. `runAltDigest` itself never
// throws; a thrown `error` field in the JSON body signals a best-effort
// failure that was still safely absorbed.
import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError } from "@/lib/api/errors";
import { runAltDigest } from "@/lib/altDetection/digest";

export async function POST(request: Request) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const db = await getDb();
    // Deep link to the Alts admin sub-tab (`src/components/admin/tabs/AdminTabsConfig.tsx`),
    // same `?tab=players&sub=alts` convention used elsewhere (e.g.
    // `AuditExplorer.tsx`'s cross-link). Best-effort — an invalid
    // `request.url` (shouldn't happen in a real Next.js request) just omits
    // the link rather than failing the trigger.
    let adminUrl: string | undefined;
    try {
      adminUrl = new URL("/admin?tab=players&sub=alts", request.url).toString();
    } catch {
      adminUrl = undefined;
    }

    const result = await runAltDigest(db, { adminUrl });
    return NextResponse.json(result);
  } catch (error) {
    return handleRouteError(error);
  }
}
