// DELETE /api/country/[code]/executive/cabinet/[positionId]/estates/[estateId]
// Close an estate. Auth: seat holder or admin. Free. Errors: 400, 401, 403, 404
import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireAuth } from "@/lib/api/requireAuth";
import { handleRouteError } from "@/lib/api/errors";
import { requireConfirmedSecretary } from "@/lib/api/requireConfirmedSecretary";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { getCabinetMembersCollection } from "@/lib/db/collections/cabinetMembers";
import { getCabinetEstatesCollection } from "@/lib/db/collections/cabinetEstates";
import { resolveEstatePortfolio } from "@/lib/constants/cabinetEstates";

interface RouteParams {
  params: Promise<{ code: string; positionId: string; estateId: string }>;
}

export async function DELETE(_request: Request, { params }: RouteParams) {
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
    const member = await getCabinetMembersCollection(db).findOne({ countryId, positionId });
    const isHolder =
      member &&
      member.characterId &&
      auth.user.character &&
      member.characterId.toString() === auth.user.character._id.toString();
    if (!isHolder && !auth.user.isAdmin) {
      return NextResponse.json(
        { error: "Only the seat holder or admin can close estates" },
        { status: 403 }
      );
    }

    // Closing an estate is not reversible by the confirmed successor.
    const actingDenied = requireConfirmedSecretary(member, "assets", !!auth.user.isAdmin);
    if (actingDenied) return actingDenied;

    const result = await getCabinetEstatesCollection(db).deleteOne({
      _id: new ObjectId(estateId),
      countryId,
      positionId,
    });
    if (result.deletedCount === 0) {
      return NextResponse.json({ error: "Estate not found" }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    return handleRouteError(error);
  }
}
