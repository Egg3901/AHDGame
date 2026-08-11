import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { handleRouteError } from "@/lib/api/errors";
import { loadWorldOrganizationsView } from "@/lib/internationalOrganizations/queries/worldOrganizations";

export const dynamic = "force-dynamic";

/**
 * GET /api/world/international-organizations
 * Public list of orgs, members, pending proposals, active legislation, and
 * leadership state. Used by the world page to render org tabs.
 */
export async function GET() {
  try {
    const db = await getDb();
    const detail = await loadWorldOrganizationsView(db);
    return NextResponse.json(detail);
  } catch (err) {
    return handleRouteError(err);
  }
}
