import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { handleRouteError } from "@/lib/api/errors";
import { publicError } from "@/lib/publicApi/errors";
import { publicApiGuard } from "@/lib/publicApi/middleware";
import { queryOrganization } from "@/lib/publicApi/organizations";

// GET /api/public/v1/organizations/[id]
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const guard = await publicApiGuard(request, "organization-detail");
    if (!guard.ok) return guard.response;
    const { id } = await params;
    const organization = await queryOrganization(await getDb(), id);
    if (!organization) return publicError("NOT_FOUND", "Organization not found", 404);
    return NextResponse.json(
      { ok: true, found: true, organization },
      { headers: guard.headers }
    );
  } catch (error) {
    return handleRouteError(error);
  }
}
