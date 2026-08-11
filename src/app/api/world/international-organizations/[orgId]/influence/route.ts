// GET /api/world/international-organizations/[orgId]/influence
// Read model for the org Influence tab. Public read: the ledger of who is
// courting whom is world information, the same as the Cold War Ledger itself.
import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { handleRouteError, badRequest } from "@/lib/api/errors";
import { loadOrgInfluence } from "@/lib/alignment/queries/orgInfluence";
import { loadOrganizationDef } from "@/lib/internationalOrganizations/service";

export async function GET(_request: Request, { params }: { params: Promise<{ orgId: string }> }) {
  try {
    const { orgId } = await params;
    const db = await getDb();
    const def = await loadOrganizationDef(db, orgId);
    if (!def) {
      return NextResponse.json(badRequest("Unknown organization").toJson(), { status: 400 });
    }
    const view = await loadOrgInfluence(db, def.id);
    // Per-viewer identical and cheap to recompute; no shared-cache header, so
    // the CDN never serves one world's state to another.
    return NextResponse.json(view, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return handleRouteError(err);
  }
}
