import { NextResponse } from "next/server";
import { z } from "zod";
import { requireHumanSessionWithCharacter } from "@/lib/api/requireAuth";
import { handleRouteError } from "@/lib/api/errors";
import { parseJsonBody } from "@/lib/api/validate";
import { getDb } from "@/lib/mongodb";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { canManageOffice } from "@/lib/governorOffice/access";
import { changeDevolutionPolicy } from "@/lib/governorOffice/devolution/changeDevolutionPolicy";

// POST /api/country/[code]/region/[id]/office/devolution-policy
// Auth: requireHumanSessionWithCharacter; must be the office-holder (FM), an
//   authorized party officer of an NPP-held office, for SCO/WAL/NIR. Admins may
//   set policy via adminOverride.
// Errors: 400, 401, 403
export async function POST(
  request: Request,
  { params }: { params: Promise<{ code: string; id: string }> }
) {
  try {
    const { code, id } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return NextResponse.json({ error: "Invalid country" }, { status: 400 });
    }
    if (countryId !== "UK") {
      return NextResponse.json({ error: "Devolution Policy is UK-only." }, { status: 400 });
    }

    const auth = await requireHumanSessionWithCharacter(request);
    if (!auth.ok) return auth.response;

    const stateId = id.toUpperCase();
    const db = await getDb();

    const parsed = await parseJsonBody(
      request,
      z.object({
        policy: z.union([z.literal("anti"), z.literal("pro"), z.literal("independence")]),
        adminOverride: z.boolean().optional(),
      })
    );
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const isAdmin = auth.user.isAdmin === true;
    const adminOverride = parsed.data.adminOverride === true && isAdmin;
    const canManage = await canManageOffice(db, countryId, stateId, auth.user.character._id);
    if (!canManage && !adminOverride) {
      return NextResponse.json({ error: "Not authorized for this office" }, { status: 403 });
    }

    const result = await changeDevolutionPolicy(db, {
      countryId,
      stateId,
      policy: parsed.data.policy,
      adminOverride,
    });
    return NextResponse.json(result.body, { status: result.status });
  } catch (error) {
    return handleRouteError(error);
  }
}
