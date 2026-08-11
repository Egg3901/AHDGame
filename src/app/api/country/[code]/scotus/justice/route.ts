/**
 * GET /api/country/[code]/scotus/justice — Justice office briefing for the viewer.
 *
 * Mirrors GET /api/country/[code]/executive/vice-president: resolves whether the
 * viewer currently holds a Court seat and returns the self-serve action pool
 * (#3598 `src/lib/constants/justiceActions.ts`) the Justice office page (#3605)
 * renders. Optional auth — anyone can look, but only the seated (character-backed)
 * Justice can act (enforced by the existing `justice/action` route).
 */
import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { getAuthUser } from "@/lib/auth"; // Optional auth — intentionally uses getAuthUser()
import { handleRouteError } from "@/lib/api/errors";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import type { Character } from "@/lib/db/types";
import type { SupremeCourtSeat } from "@/lib/db/types/scotus";
import {
  JUSTICE_ACTIONS,
  JUSTICE_ACTION_CAP,
  JUSTICE_ACTION_RESET_HINT,
} from "@/lib/constants/justiceActions";

export async function GET(_request: Request, { params }: { params: Promise<{ code: string }> }) {
  try {
    const { code } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return NextResponse.json({ error: "Invalid country" }, { status: 400 });
    }
    if (countryId !== "US") {
      // SCOTUS is US-only per #3581 scope.
      return NextResponse.json({
        countryId,
        isJustice: false,
        mySeatNumber: null,
        seat: null,
        justiceActionsRemaining: 0,
        actionCap: JUSTICE_ACTION_CAP,
        resetHint: JUSTICE_ACTION_RESET_HINT,
        actions: JUSTICE_ACTIONS,
      });
    }

    const db = await getDb();
    const authUser = await getAuthUser().catch(() => null);
    const myCharacter = authUser
      ? await db
          .collection<Character>("characters")
          .findOne({ userId: new ObjectId(authUser.userId) })
      : null;

    const seat = myCharacter
      ? await db.collection<SupremeCourtSeat>("supremeCourtSeats").findOne({
          countryId,
          justiceCharacterId: myCharacter._id,
        })
      : null;

    return NextResponse.json({
      countryId,
      isJustice: !!seat,
      mySeatNumber: seat?.seatNumber ?? null,
      seat: seat
        ? {
            seatNumber: seat.seatNumber,
            justiceName: seat.justiceName,
            justiceParty: seat.justiceParty,
            economicLean: seat.economicLean,
            socialLean: seat.socialLean,
            isDivergent: seat.isDivergent,
          }
        : null,
      justiceActionsRemaining: seat?.justiceActionsRemaining ?? JUSTICE_ACTION_CAP,
      actionCap: JUSTICE_ACTION_CAP,
      resetHint: JUSTICE_ACTION_RESET_HINT,
      actions: JUSTICE_ACTIONS,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
