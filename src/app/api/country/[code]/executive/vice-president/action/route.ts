// POST /api/country/[code]/executive/vice-president/action
// Auth: requireAuth — must be the seated vice-president (#67)
// Errors: 400, 401, 403, 404, 409
import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireAuth } from "@/lib/api/requireAuth";
import { parseJsonBody } from "@/lib/api/validate";
import { handleRouteError } from "@/lib/api/errors";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import type { ElectedOfficial, Character } from "@/lib/db/types";
import {
  initialVpActionFields,
  VP_RALLY_INFLUENCE_GAIN,
  VP_SURROGATE_FAVORABILITY_GAIN,
} from "@/lib/constants/vicePresidentActions";
import { z } from "zod";

const actionSchema = z.object({
  actionId: z.enum(["surrogate_address", "rally_base"]),
});

/** Clamp a 0-100 metric after applying a gain, matching applyActionEffect. */
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
    if (!COUNTRY_CONFIGS[countryId]) {
      return NextResponse.json({ error: "Invalid country" }, { status: 400 });
    }

    const parsed = await parseJsonBody(request, actionSchema);
    if (!parsed.success)
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    const { actionId } = parsed.data;

    const db = await getDb();
    const officialsCol = db.collection<ElectedOfficial>("electedOfficials");
    const vpOfficial = await officialsCol.findOne({ countryId, officeType: "vicePresident" });

    // Gate: the actor must BE the seated, character-backed vice-president.
    const isSeatedVp =
      !!vpOfficial?.characterId &&
      !!auth.user.character &&
      vpOfficial.characterId.toString() === auth.user.character._id.toString();
    if (!isSeatedVp) {
      return NextResponse.json(
        { error: "Only the sitting vice-president can take this action" },
        { status: 403 }
      );
    }

    // Backfill missing action fields on legacy VP docs. Pre-#67 seatings lack
    // vpActionsRemaining / lastVpActionResetDay, which makes the atomic `$gte: 1`
    // spend below silently fail (Mongo doesn't match $gte against missing fields).
    if (vpOfficial!.vpActionsRemaining == null || vpOfficial!.lastVpActionResetDay == null) {
      const backfill = {
        ...initialVpActionFields(),
        ...(vpOfficial!.vpActionsRemaining != null
          ? { vpActionsRemaining: vpOfficial!.vpActionsRemaining }
          : {}),
      };
      await officialsCol.updateOne({ _id: vpOfficial!._id }, { $set: backfill });
      vpOfficial!.vpActionsRemaining = backfill.vpActionsRemaining;
      vpOfficial!.lastVpActionResetDay = backfill.lastVpActionResetDay;
    }

    const actionsRemaining = vpOfficial!.vpActionsRemaining ?? 0;
    if (actionsRemaining < 1) {
      return NextResponse.json({ error: "No vice-president actions remaining" }, { status: 400 });
    }

    const charactersCol = db.collection<Character>("characters");

    // Resolve the effect target BEFORE spending so a doomed action wastes no
    // action (mirrors the order route rejecting a region-less regional order).
    let targetCharId = auth.user.character!._id; // rally_base targets the VP.
    if (actionId === "surrogate_address") {
      const presidentOfficial = await officialsCol.findOne({ countryId, officeType: "president" });
      if (!presidentOfficial?.characterId) {
        return NextResponse.json(
          { error: "There is no sitting president to campaign for" },
          { status: 400 }
        );
      }
      targetCharId = presidentOfficial.characterId;
    }

    const targetChar = await charactersCol.findOne({ _id: targetCharId });
    if (!targetChar) {
      return NextResponse.json({ error: "Target office holder not found" }, { status: 404 });
    }

    // Spend one action atomically (guards against a double-submit race).
    const spend = await officialsCol.updateOne(
      { _id: vpOfficial!._id, vpActionsRemaining: { $gte: 1 } },
      { $inc: { vpActionsRemaining: -1 } }
    );
    if (spend.modifiedCount === 0) {
      return NextResponse.json({ error: "No vice-president actions remaining" }, { status: 409 });
    }

    try {
      if (actionId === "surrogate_address") {
        const next = clamp100((targetChar.favorability ?? 0) + VP_SURROGATE_FAVORABILITY_GAIN);
        await charactersCol.updateOne(
          { _id: targetChar._id },
          { $set: { favorability: next, updatedAt: new Date() } }
        );
        return NextResponse.json({
          success: true,
          actionsRemaining: actionsRemaining - 1,
          message: `You campaigned for the president. Their favorability is now ${next}.`,
        });
      }
      // rally_base
      const next = clamp100((targetChar.politicalInfluence ?? 0) + VP_RALLY_INFLUENCE_GAIN);
      await charactersCol.updateOne(
        { _id: targetChar._id },
        { $set: { politicalInfluence: next, updatedAt: new Date() } }
      );
      return NextResponse.json({
        success: true,
        actionsRemaining: actionsRemaining - 1,
        message: `You rallied the base. Your political influence is now ${next}.`,
      });
    } catch (error) {
      // Refund the action if the effect write failed (mirrors the order route).
      await officialsCol.updateOne({ _id: vpOfficial!._id }, { $inc: { vpActionsRemaining: 1 } });
      throw error;
    }
  } catch (error) {
    return handleRouteError(error);
  }
}
