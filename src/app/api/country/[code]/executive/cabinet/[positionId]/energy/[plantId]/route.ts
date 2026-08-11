// DELETE /api/country/[code]/executive/cabinet/[positionId]/energy/[plantId]
// Retire a plant. Auth: energy holder or admin. Free. Errors: 400, 401, 403, 404
import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireAuth } from "@/lib/api/requireAuth";
import { handleRouteError } from "@/lib/api/errors";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { getCabinetMembersCollection } from "@/lib/db/collections/cabinetMembers";
import { getEnergyPlantsCollection } from "@/lib/db/collections/energyPlants";
import { resolveEnergyPosition } from "@/lib/constants/cabinetEnergy";

interface RouteParams {
  params: Promise<{ code: string; positionId: string; plantId: string }>;
}

export async function DELETE(_request: Request, { params }: RouteParams) {
  try {
    const auth = await requireAuth();
    if (!auth.ok) return auth.response;

    const { code, positionId, plantId } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return NextResponse.json({ error: "Invalid country" }, { status: 400 });
    }
    if (!resolveEnergyPosition(countryId, positionId)) {
      return NextResponse.json({ error: "Not an energy cabinet position" }, { status: 404 });
    }
    if (!ObjectId.isValid(plantId)) {
      return NextResponse.json({ error: "Invalid plant id" }, { status: 400 });
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
        { error: "Only the energy holder or admin can retire plants" },
        { status: 403 }
      );
    }

    const result = await getEnergyPlantsCollection(db).deleteOne({
      _id: new ObjectId(plantId),
      countryId,
      positionId,
    });
    if (result.deletedCount === 0) {
      return NextResponse.json({ error: "Plant not found" }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    return handleRouteError(error);
  }
}
