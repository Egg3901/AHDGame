import { NextResponse } from "next/server";
import { z } from "zod";
import { requireHumanSessionWithCharacter } from "@/lib/api/requireAuth";
import { handleRouteError } from "@/lib/api/errors";
import { parseJsonBody } from "@/lib/api/validate";
import { getDb } from "@/lib/mongodb";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { canManageOffice } from "@/lib/governorOffice/access";
import { issueOrder } from "@/lib/governorOffice/orders/issueOrder";

// POST /api/country/[code]/region/[id]/office/orders — Issue an executive order
// Auth: requireHumanSessionWithCharacter; must be the office-holder, an
//   authorized party officer of an NPP-held office, or an admin (adminOverride).
// Errors: 400, 401, 403, 409
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

    const auth = await requireHumanSessionWithCharacter(request);
    if (!auth.ok) return auth.response;

    const stateId = id.toUpperCase();
    const db = await getDb();

    const parsed = await parseJsonBody(
      request,
      z.object({
        legislationTypeId: z.string().min(1),
        effectDirection: z.union([z.literal(1), z.literal(-1)]),
        steps: z.union([z.literal(1), z.literal(2)]).optional(),
        adminOverride: z.boolean().optional(),
      })
    );
    if (!parsed.success)
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });

    const isAdmin = auth.user.isAdmin === true;
    const adminOverride = parsed.data.adminOverride === true && isAdmin;
    const canManage = await canManageOffice(db, countryId, stateId, auth.user.character._id);
    if (!canManage && !adminOverride) {
      return NextResponse.json({ error: "Not authorized for this office" }, { status: 403 });
    }

    const result = await issueOrder(db, {
      countryId,
      stateId,
      characterId: auth.user.character._id,
      characterName: auth.user.character.name,
      legislationTypeId: parsed.data.legislationTypeId,
      effectDirection: parsed.data.effectDirection,
      steps: parsed.data.steps,
      adminOverride,
    });
    return NextResponse.json(result.body, { status: result.status });
  } catch (error) {
    return handleRouteError(error);
  }
}

// GET /api/country/[code]/region/[id]/office/orders — Read active + recent executive orders
// Auth: office-holder, authorized party officer (NPP-held office), or admin.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ code: string; id: string }> }
) {
  try {
    const { code, id } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return NextResponse.json({ error: "Invalid country" }, { status: 400 });
    }

    const auth = await requireHumanSessionWithCharacter(_request);
    if (!auth.ok) return auth.response;

    const stateId = id.toUpperCase();
    const db = await getDb();
    const canManage = await canManageOffice(db, countryId, stateId, auth.user.character._id);
    const isAdmin = auth.user.isAdmin === true;
    if (!canManage && !isAdmin) {
      return NextResponse.json({ error: "Not authorized for this office" }, { status: 403 });
    }

    const active = await db
      .collection("governorExecutiveOrders")
      .find({ countryId, stateId, status: "active" })
      .toArray();
    const history = await db
      .collection("governorExecutiveOrders")
      .find({ countryId, stateId, status: { $in: ["expired", "rescinded", "superseded"] } })
      .sort({ issuedAtTurn: -1 })
      .limit(20)
      .toArray();

    return NextResponse.json({ active, history });
  } catch (error) {
    return handleRouteError(error);
  }
}
