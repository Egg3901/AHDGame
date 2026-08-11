// POST /api/country/[code]/scotus/justice/action
// Auth: requireAuth — must be the seated (character-backed) Justice for the target seat (#3598)
// Errors: 400, 401, 403, 404, 409
import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireAuth } from "@/lib/api/requireAuth";
import { parseJsonBody } from "@/lib/api/validate";
import { handleRouteError } from "@/lib/api/errors";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import type { Character } from "@/lib/db/types";
import type { SupremeCourtSeat } from "@/lib/db/types/scotus";
import {
  initialJusticeActionFields,
  JUSTICE_ADDRESS_FAVORABILITY_GAIN,
  JUSTICE_OPINION_INFLUENCE_GAIN,
} from "@/lib/constants/justiceActions";
import { z } from "zod";

const actionSchema = z.object({
  seatNumber: z.number().int().min(1).max(9),
  actionId: z.enum(["public_address", "write_opinion"]),
});

function clamp100(value: number): number {
  return Math.min(100, Math.max(0, value));
}

interface RouteParams {
  params: Promise<{ code: string }>;
}

export async function POST(request: Request, { params }: RouteParams) {
  try {
    const auth = await requireAuth();
    if (!auth.ok) return auth.response;

    const { code } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId] || countryId !== "US") {
      return NextResponse.json({ error: "Invalid country" }, { status: 400 });
    }

    const parsed = await parseJsonBody(request, actionSchema);
    if (!parsed.success)
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    const { seatNumber, actionId } = parsed.data;

    const db = await getDb();
    const seatsCol = db.collection<SupremeCourtSeat>("supremeCourtSeats");
    const seat = await seatsCol.findOne({ countryId, seatNumber });

    const isSeatedJustice =
      !!seat?.justiceCharacterId &&
      !!auth.user.character &&
      seat.justiceCharacterId.toString() === auth.user.character._id.toString();
    if (!isSeatedJustice) {
      return NextResponse.json(
        { error: "Only the sitting Justice for this seat can take this action" },
        { status: 403 }
      );
    }

    if (seat!.justiceActionsRemaining == null || seat!.lastJusticeActionResetDay == null) {
      await seatsCol.updateOne({ _id: seat!._id }, { $set: initialJusticeActionFields() });
      seat!.justiceActionsRemaining = initialJusticeActionFields().justiceActionsRemaining;
    }

    const actionsRemaining = seat!.justiceActionsRemaining ?? 0;
    if (actionsRemaining < 1) {
      return NextResponse.json({ error: "No Justice actions remaining" }, { status: 400 });
    }

    const spend = await seatsCol.updateOne(
      { _id: seat!._id, justiceActionsRemaining: { $gte: 1 } },
      { $inc: { justiceActionsRemaining: -1 } }
    );
    if (spend.modifiedCount === 0) {
      return NextResponse.json({ error: "No Justice actions remaining" }, { status: 409 });
    }

    const charactersCol = db.collection<Character>("characters");
    try {
      const targetChar = await charactersCol.findOne({ _id: seat!.justiceCharacterId! });
      if (!targetChar) {
        throw new Error("Seated Justice's character record not found");
      }

      if (actionId === "public_address") {
        const next = clamp100((targetChar.favorability ?? 0) + JUSTICE_ADDRESS_FAVORABILITY_GAIN);
        await charactersCol.updateOne(
          { _id: targetChar._id },
          { $set: { favorability: next, updatedAt: new Date() } }
        );
        return NextResponse.json({
          success: true,
          actionsRemaining: actionsRemaining - 1,
          message: `You spoke publicly on the Court's role. Your favorability is now ${next}.`,
        });
      }
      // write_opinion
      const next = clamp100((targetChar.politicalInfluence ?? 0) + JUSTICE_OPINION_INFLUENCE_GAIN);
      await charactersCol.updateOne(
        { _id: targetChar._id },
        { $set: { politicalInfluence: next, updatedAt: new Date() } }
      );
      return NextResponse.json({
        success: true,
        actionsRemaining: actionsRemaining - 1,
        message: `You published a legal opinion. Your political influence is now ${next}.`,
      });
    } catch (error) {
      await seatsCol.updateOne({ _id: seat!._id }, { $inc: { justiceActionsRemaining: 1 } });
      throw error;
    }
  } catch (error) {
    return handleRouteError(error);
  }
}
