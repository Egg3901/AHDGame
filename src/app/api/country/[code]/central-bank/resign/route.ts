// POST /api/country/[code]/central-bank/resign — Player resigns as seated central bank chair
// Auth: requireAuth
// Errors: 400, 403, 404

import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireAuth } from "@/lib/api/requireAuth";
import { handleRouteError, forbidden, notFound } from "@/lib/api/errors";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import type { CentralBank } from "@/lib/db/types";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { vacateCentralBankChairCharacter } from "@/lib/turn/centralBankChairSelection";
import { notifyCbChairResignedDiscord } from "@/lib/centralBankChairEvents";
import { createSystemNewsPost } from "@/lib/news";
import { getBankId, vacateFomcChairSeat } from "@/lib/centralBank/helpers";

interface RouteContext {
  params: Promise<{ code: string }>;
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const auth = await requireAuth();
    if (!auth.ok) return auth.response;

    const rateLimit = checkRateLimit(auth.user.userId, 10, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const { code } = await context.params;
    const countryId = code.toUpperCase() as CountryId;
    const config = COUNTRY_CONFIGS[countryId];
    if (!config) return NextResponse.json(notFound("Country not found").toJson(), { status: 404 });

    const db = await getDb();

    const myChar = auth.user.character;
    if (!myChar) return NextResponse.json({ error: "No character found" }, { status: 400 });

    const bank = await db
      .collection<CentralBank>("centralBanks")
      .findOne({ _id: getBankId(countryId) });
    if (!bank)
      return NextResponse.json(notFound("Central bank not found").toJson(), { status: 404 });

    if (!bank.chairCharacterId || bank.chairCharacterId.toString() !== myChar._id.toString())
      return NextResponse.json(forbidden("You are not the current chair").toJson(), {
        status: 403,
      });

    const chairName = myChar.name ?? bank.chairCharacterName ?? "Chair";
    const gameNow = new Date();

    await vacateCentralBankChairCharacter(db, bank.chairCharacterId);
    // Also stand down from the committee's chair seat, or the resigned player
    // keeps tabling its motions and keeps being named as chair on the page.
    await vacateFomcChairSeat(db, bank._id);

    await db.collection<CentralBank>("centralBanks").updateOne(
      { _id: bank._id },
      {
        $set: {
          chairCharacterId: null,
          chairCharacterName: null,
          chairAppointedAt: null,
          chairAppointedBy: null,
          chairTermExpiresAtTurn: null,
          vacancyAwaitingAutomaticSelection: true,
          updatedAt: gameNow,
        },
      }
    );

    notifyCbChairResignedDiscord(countryId, chairName).catch((err) =>
      console.error("[central-bank/resign] Discord webhook failed:", err)
    );

    createSystemNewsPost(
      `${chairName} resigned as ${config.centralBank.chairTitle} of the ${config.centralBank.name}.`,
      "election"
    ).catch((err) => console.error("[central-bank/resign] News post failed:", err));

    return NextResponse.json({ success: true, message: "You have resigned as chair." });
  } catch (error) {
    return handleRouteError(error);
  }
}
