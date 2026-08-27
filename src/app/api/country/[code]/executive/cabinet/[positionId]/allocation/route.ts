// POST /api/country/[code]/executive/cabinet/[positionId]/allocation
// Auth: requireAuth — must be cabinet holder or admin
// Errors: 400, 401, 403, 404
import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireAuth } from "@/lib/api/requireAuth";
import { parseJsonBody } from "@/lib/api/validate";
import { handleRouteError } from "@/lib/api/errors";
import { getCabinetMechanics } from "@/lib/constants/cabinetMechanics";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { getCabinetMembersCollection } from "@/lib/db/collections/cabinetMembers";
import { getCabinetSettingsCollection } from "@/lib/db/collections/cabinetSettings";
import { getGameState } from "@/lib/gameState";
import { z } from "zod";

const allocationRecordSchema = z.record(z.string(), z.number().min(0).max(100));
const allocationSchema = z.union([
  z.object({
    allocations: allocationRecordSchema,
  }),
  z.object({
    allocationPercents: allocationRecordSchema,
  }),
]);

interface RouteParams {
  params: Promise<{ code: string; positionId: string }>;
}

export async function POST(request: Request, { params }: RouteParams) {
  try {
    const auth = await requireAuth();
    if (!auth.ok) return auth.response;

    const { code, positionId } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return NextResponse.json({ error: "Invalid country" }, { status: 400 });
    }

    const mechanics = getCabinetMechanics(countryId, positionId);
    if (!mechanics?.allocation) {
      return NextResponse.json(
        { error: "This position does not have allocation controls" },
        { status: 404 }
      );
    }

    const parsed = await parseJsonBody(request, allocationSchema);
    if (!parsed.success)
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });

    const allocations =
      "allocations" in parsed.data ? parsed.data.allocations : parsed.data.allocationPercents;

    // Validate: percentages must sum to 100 (with 0.1% tolerance for floating point)
    const total = Object.values(allocations).reduce((sum, v) => sum + v, 0);
    if (Math.abs(total - 100) > 0.1) {
      return NextResponse.json(
        { error: `Allocations must sum to 100%. Current total: ${total.toFixed(1)}%` },
        { status: 400 }
      );
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
        { error: "Only the cabinet holder or admin can set allocations" },
        { status: 403 }
      );
    }

    const gameState = await getGameState();
    const currentTurn = gameState?.currentTurn ?? 1;

    // Rate limit: once per turn (separate from tier-setting cooldown)
    const settingsCol = getCabinetSettingsCollection(db);
    const existing = await settingsCol.findOne({ _id: `${countryId}_${positionId}` });
    const lastAllocationTurn = existing?.lastAllocationChangedTurn;
    if (lastAllocationTurn !== undefined && lastAllocationTurn >= currentTurn) {
      return NextResponse.json(
        { error: "Allocations can only be updated once per turn" },
        { status: 400 }
      );
    }

    await settingsCol.updateOne(
      { _id: `${countryId}_${positionId}` },
      {
        $set: {
          countryId,
          positionId,
          characterId: member?.characterId ?? auth.user.character?._id,
          allocationPercents: allocations,
          lastAllocationChangedTurn: currentTurn,
          updatedAt: new Date(),
        },
      },
      { upsert: true }
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleRouteError(error);
  }
}
