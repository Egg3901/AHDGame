import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { requireHumanSessionWithCharacter } from "@/lib/api/requireAuth";
import { handleRouteError } from "@/lib/api/errors";
import { getDb } from "@/lib/mongodb";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { rescindOrder } from "@/lib/governorOffice/orders/rescindOrder";
import { isSittingLeader } from "@/lib/governorOffice/isSittingLeader";

// DELETE /api/country/[code]/executive/orders/[orderId] — Sitting leader
// (President / PM / Chancellor) rescinds a national order.
// Auth: requireHumanSessionWithCharacter; must be the seated head of government.
// Errors: 400, 401, 403, 404
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ code: string; orderId: string }> }
) {
  try {
    const { code, orderId } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return NextResponse.json({ error: "Invalid country" }, { status: 400 });
    }
    if (!ObjectId.isValid(orderId)) {
      return NextResponse.json({ error: "Invalid orderId" }, { status: 400 });
    }

    const auth = await requireHumanSessionWithCharacter(request);
    if (!auth.ok) return auth.response;

    const db = await getDb();
    const leader = await isSittingLeader(db, countryId, auth.user.character._id);
    if (!leader) {
      return NextResponse.json(
        { error: "Only the sitting leader can rescind national orders" },
        { status: 403 }
      );
    }

    const result = await rescindOrder(db, {
      orderId: new ObjectId(orderId),
      rescindedByCharacterId: auth.user.character._id,
    });
    return NextResponse.json(result.body, { status: result.status });
  } catch (error) {
    return handleRouteError(error);
  }
}
