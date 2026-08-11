// POST /api/country/[code]/executive/cabinet/[positionId]/estates/[estateId]/expand
// Raise tier by 1 (cap 3). Auth: seat holder or admin. Costs 1 ministerial action.
// Errors: 400, 401, 403, 404, 409
import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireAuth } from "@/lib/api/requireAuth";
import { handleRouteError } from "@/lib/api/errors";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { getCabinetMembersCollection } from "@/lib/db/collections/cabinetMembers";
import { getCabinetEstatesCollection } from "@/lib/db/collections/cabinetEstates";
import { resolveEstatePortfolio } from "@/lib/constants/cabinetEstates";

interface RouteParams {
  params: Promise<{ code: string; positionId: string; estateId: string }>;
}

export async function POST(_request: Request, { params }: RouteParams) {
  try {
    const auth = await requireAuth();
    if (!auth.ok) return auth.response;

    const { code, positionId, estateId } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return NextResponse.json({ error: "Invalid country" }, { status: 400 });
    }
    if (!resolveEstatePortfolio(countryId, positionId)) {
      return NextResponse.json({ error: "Not an estates cabinet position" }, { status: 404 });
    }
    if (!ObjectId.isValid(estateId)) {
      return NextResponse.json({ error: "Invalid estate id" }, { status: 400 });
    }

    const db = await getDb();
    const membersCol = getCabinetMembersCollection(db);
    const estatesCol = getCabinetEstatesCollection(db);
    const member = await membersCol.findOne({ countryId, positionId });
    const isHolder =
      member &&
      member.characterId &&
      auth.user.character &&
      member.characterId.toString() === auth.user.character._id.toString();
    if (!isHolder && !auth.user.isAdmin) {
      return NextResponse.json(
        { error: "Only the seat holder or admin can expand estates" },
        { status: 403 }
      );
    }

    const estate = await estatesCol.findOne({ _id: new ObjectId(estateId), countryId, positionId });
    if (!estate) {
      return NextResponse.json({ error: "Estate not found" }, { status: 404 });
    }
    if (estate.tier >= 3) {
      return NextResponse.json({ error: "Estate is already at the highest tier" }, { status: 400 });
    }

    if (member && member.ministerialActions == null) {
      await membersCol.updateOne({ _id: member._id }, { $set: { ministerialActions: 2 } });
      member.ministerialActions = 2;
    }
    const actions = member?.ministerialActions ?? 2;
    if (actions < 1) {
      return NextResponse.json({ error: "No ministerial actions remaining" }, { status: 400 });
    }

    const spend = await membersCol.updateOne(
      { _id: member!._id, ministerialActions: { $gte: 1 } },
      { $inc: { ministerialActions: -1 } }
    );
    if (spend.modifiedCount === 0) {
      return NextResponse.json({ error: "No ministerial actions remaining" }, { status: 409 });
    }

    try {
      await estatesCol.updateOne(
        { _id: estate._id },
        { $set: { tier: (estate.tier + 1) as 0 | 1 | 2 | 3 } }
      );
    } catch (error) {
      await membersCol.updateOne({ _id: member!._id }, { $inc: { ministerialActions: 1 } });
      throw error;
    }

    return NextResponse.json({
      success: true,
      tier: estate.tier + 1,
      actionsRemaining: actions - 1,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
