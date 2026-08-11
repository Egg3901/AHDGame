import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { requireHumanSessionWithCharacter } from "@/lib/api/requireAuth";
import { handleRouteError } from "@/lib/api/errors";
import { getDb } from "@/lib/mongodb";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { canManageOffice } from "@/lib/governorOffice/access";
import { rescindOrder } from "@/lib/governorOffice/orders/rescindOrder";

// DELETE /api/country/[code]/region/[id]/office/orders/[orderId] — Rescind an active order.
// Auth: requireHumanSessionWithCharacter; must be the office-holder or an
//   authorized party officer of an NPP-held office.
// Errors: 400, 401, 403, 404
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ code: string; id: string; orderId: string }> }
) {
  try {
    const { code, id, orderId } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return NextResponse.json({ error: "Invalid country" }, { status: 400 });
    }
    if (!ObjectId.isValid(orderId)) {
      return NextResponse.json({ error: "Invalid orderId" }, { status: 400 });
    }

    const auth = await requireHumanSessionWithCharacter(request);
    if (!auth.ok) return auth.response;

    const stateId = id.toUpperCase();
    const db = await getDb();
    const canManage = await canManageOffice(db, countryId, stateId, auth.user.character._id);
    if (!canManage)
      return NextResponse.json({ error: "Not authorized for this office" }, { status: 403 });

    const result = await rescindOrder(db, {
      orderId: new ObjectId(orderId),
      rescindedByCharacterId: auth.user.character._id,
    });
    return NextResponse.json(result.body, { status: result.status });
  } catch (error) {
    return handleRouteError(error);
  }
}
