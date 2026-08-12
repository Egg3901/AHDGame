// POST /api/country/[code]/central-bank/dismiss-chair — the executive removes a
// sitting central bank chair before their term ends (B5, the independence fight).
// Auth: requireAuthWithCharacter, executive office of a member country
// Errors: 400, 403, 404, 429

import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { handleRouteError, forbidden, badRequest, notFound } from "@/lib/api/errors";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import type { CentralBank } from "@/lib/db/types/centralBank";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { vacateCentralBankChairCharacter } from "@/lib/turn/centralBankChairSelection";
import { getCentralBankScope } from "@/lib/centralBank/helpers";
import { createSystemNewsPost } from "@/lib/news";
import { createNotification } from "@/lib/notifications";
import { recordAudit } from "@/lib/audit/recordAudit";
import { getGameState } from "@/lib/gameState";
import { DISMISSAL_SCRUTINY, scrutinyAfterDismissal } from "@/lib/centralBank/independence";

interface RouteContext {
  params: Promise<{ code: string }>;
}

export async function POST(_request: Request, context: RouteContext) {
  try {
    const authResult = await requireAuthWithCharacter();
    if (!authResult.ok) return authResult.response;

    const rateLimit = checkRateLimit(`cb-dismiss:${authResult.user.userId}`, 5, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);
    const auth = authResult.user;

    const { code } = await context.params;
    const countryId = code.toUpperCase() as CountryId;
    const config = COUNTRY_CONFIGS[countryId];
    if (!config) return NextResponse.json(notFound("Country not found").toJson(), { status: 404 });

    const db = await getDb();
    const { bankId, memberCountries } = await getCentralBankScope(db, countryId);

    // Same authorization shape as chair nomination: an executive of a member
    // country of THIS bank. A shared bank (the ECB) is deliberately reachable by
    // any member's executive, exactly as nomination is — and just as
    // deliberately expensive, because the scrutiny lands on the shared
    // institution every member depends on.
    const callerCountryId = auth.character.countryId as CountryId;
    const execOffice = COUNTRY_CONFIGS[callerCountryId]?.officeTypes.find((o) => o.isExecutive);
    if (!execOffice)
      return NextResponse.json(badRequest("No executive office configured").toJson(), {
        status: 400,
      });
    const callerOffice = auth.character.currentOffice;
    if (
      !memberCountries.includes(callerCountryId) ||
      !callerOffice ||
      callerOffice.type !== execOffice.key
    )
      return NextResponse.json(
        forbidden("Only the head of government can dismiss the chair.").toJson(),
        { status: 403 }
      );

    const banks = db.collection<CentralBank>("centralBanks");
    const bank = await banks.findOne({ _id: bankId });
    if (!bank)
      return NextResponse.json(notFound("Central bank not found").toJson(), { status: 404 });
    if (!bank.chairCharacterId)
      return NextResponse.json(badRequest("The seat is already vacant.").toJson(), { status: 400 });

    const chairCharacterId = bank.chairCharacterId;
    const chairName = bank.chairCharacterName ?? "The chair";
    const newScrutiny = scrutinyAfterDismissal(bank);
    const gameNow = new Date();
    const currentTurn = (await getGameState(db))?.currentTurn ?? 0;

    // Claim the seat first: whoever wins the transition does the rest, so two
    // executives (or a dismissal racing a resignation) cannot both dismiss.
    const claim = await banks.updateOne(
      { _id: bank._id, chairCharacterId },
      {
        $set: {
          chairCharacterId: null,
          chairCharacterName: null,
          chairAppointedAt: null,
          chairAppointedBy: null,
          chairTermExpiresAtTurn: null,
          vacancyAwaitingAutomaticSelection: true,
          // The institution keeps ALL of its scrutiny and takes the dismissal
          // penalty on top. No CHAIR_CHANGE_SCRUTINY_RETAINED haircut here: a
          // dismissal must never be a cheaper way to shed a bad record than
          // waiting out the term.
          chairInfamy: newScrutiny,
          resolveStreak: 0,
          updatedAt: gameNow,
        },
      }
    );
    if (claim.matchedCount === 0)
      return NextResponse.json(badRequest("The seat is already vacant.").toJson(), { status: 400 });

    await vacateCentralBankChairCharacter(db, chairCharacterId);

    void createNotification({
      userId: auth.character.userId,
      type: "system",
      title: "Chair dismissed",
      message: `You dismissed ${chairName} as ${config.centralBank.chairTitle}. The ${config.centralBank.name}'s scrutiny rose by ${DISMISSAL_SCRUTINY}.`,
      metadata: { countryId },
    });

    createSystemNewsPost(
      `${auth.character.name} dismissed ${chairName} as ${config.centralBank.chairTitle} of the ${config.centralBank.name}. Markets read a bank whose chair serves at the government's pleasure.`,
      "election"
    ).catch(() => {});

    recordAudit({
      source: "api",
      action: "centralBank.chair.dismiss",
      category: "governance",
      turn: currentTurn,
      ts: gameNow,
      subject: { type: "character", id: auth.character._id, name: auth.character.name },
      outcome: "ok",
      meta: {
        countryId,
        bankId: bank._id,
        dismissedCharacterId: chairCharacterId,
        dismissedName: chairName,
        scrutinyBefore: bank.chairInfamy ?? 0,
        scrutinyAfter: newScrutiny,
      },
    });

    return NextResponse.json({
      success: true,
      scrutinyAdded: DISMISSAL_SCRUTINY,
      scrutiny: newScrutiny,
      message: `${chairName} has been dismissed. The bank's scrutiny rose to ${newScrutiny}.`,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
