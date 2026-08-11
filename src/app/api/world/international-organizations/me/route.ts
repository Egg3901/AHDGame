// GET /api/world/international-organizations/me
// Returns the viewer's foreign-affairs role, if any, plus their country's
// memberships. Used by the UI to gate action buttons.
import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireAuth } from "@/lib/api/requireAuth";
import { handleRouteError } from "@/lib/api/errors";
import { loadViewerOrganizationRoles } from "@/lib/internationalOrganizations/queries/viewerRoles";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const auth = await requireAuth();
    if (!auth.ok) return auth.response;

    const db = await getDb();
    const detail = await loadViewerOrganizationRoles({
      db,
      characterId: auth.user.hasCharacter && auth.user.character ? auth.user.character._id : null,
      characterName: auth.user.character?.name ?? null,
    });
    // Per-viewer response with no id in the path; no-store stops a URL-keyed edge
    // cache from serving one player's roles to another. force-dynamic only blocks
    // Next's static cache, not a CDN.
    return NextResponse.json(detail, { headers: { "Cache-Control": "no-store, no-transform" } });
  } catch (err) {
    return handleRouteError(err);
  }
}
