// GET /api/world/international-organizations/[orgId]/candidates
// Returns the set of characters eligible to be nominated for the org's
// leadership office: heads of government and foreign ministers of member countries.
import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { handleRouteError } from "@/lib/api/errors";
import { loadOrganizationLeadershipCandidates } from "@/lib/internationalOrganizations/queries/leadershipCandidates";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ orgId: string }> }) {
  try {
    const { orgId } = await params;
    const db = await getDb();
    const detail = await loadOrganizationLeadershipCandidates({ db, orgId });
    if (!detail.ok) {
      return NextResponse.json({ error: detail.error }, { status: detail.status });
    }
    return NextResponse.json(detail.body);
  } catch (err) {
    return handleRouteError(err);
  }
}
