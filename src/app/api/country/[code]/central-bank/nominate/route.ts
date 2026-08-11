import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { parseJsonBody, schemas } from "@/lib/api/validate";
import { handleRouteError, forbidden, badRequest, notFound } from "@/lib/api/errors";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import type { CentralBank } from "@/lib/db/types/centralBank";
import type { Character } from "@/lib/db/types";
import { isNominationWindowOpen } from "@/lib/turn/centralBankChairSelection";
import { getGameState } from "@/lib/gameState";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { notifyCbExecutiveNominationDiscord } from "@/lib/centralBankChairEvents";
import { getCentralBankScope } from "@/lib/centralBank/helpers";
import { runWithOptionalTransaction } from "@/lib/db/runWithOptionalTransaction";

interface RouteContext {
  params: Promise<{ code: string }>;
}

const schema = z.object({
  characterId: schemas.objectId,
});

export async function POST(request: Request, context: RouteContext) {
  try {
    const authResult = await requireAuthWithCharacter();
    if (!authResult.ok) return authResult.response;

    const rateLimit = checkRateLimit(authResult.user.userId, 10, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);
    const auth = authResult.user;

    const { code } = await context.params;
    const countryId = code.toUpperCase() as CountryId;
    const config = COUNTRY_CONFIGS[countryId];
    if (!config) return NextResponse.json(notFound("Country not found").toJson(), { status: 404 });

    const db = await getDb();
    const { bankId, memberCountries } = await getCentralBankScope(db, countryId);

    // Caller must be an executive of a member country for this bank
    const callerCountryId = auth.character.countryId as CountryId;
    const callerConfig = COUNTRY_CONFIGS[callerCountryId];
    const execOffice = callerConfig?.officeTypes.find((o) => o.isExecutive);
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
      return NextResponse.json(forbidden().toJson(), { status: 403 });

    const parsed = await parseJsonBody(request, schema);
    if (!parsed.success)
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });

    const centralBanks = db.collection<CentralBank>("centralBanks");

    const bank = await centralBanks.findOne({ _id: bankId });
    if (!bank)
      return NextResponse.json(notFound("Central bank not found").toJson(), { status: 404 });

    // Check nomination window
    const gameState = await getGameState();
    const currentTurn = gameState?.currentTurn ?? 0;
    if (!isNominationWindowOpen(bank, currentTurn))
      return NextResponse.json(
        badRequest(
          "Nominations are not open. The window opens during the final year of the chair's term or when the seat is vacant."
        ).toJson(),
        { status: 400 }
      );

    // Max 3 nominations
    if ((bank.nominations?.length ?? 0) >= 3)
      return NextResponse.json(badRequest("Maximum of 3 nominations reached").toJson(), {
        status: 400,
      });

    // Validate target character
    const targetId = new ObjectId(parsed.data.characterId);
    const target = await db.collection<Character>("characters").findOne({ _id: targetId });
    if (!target)
      return NextResponse.json(badRequest("Character not found").toJson(), { status: 400 });

    // Must be a player
    if (!target.userId)
      return NextResponse.json(badRequest("Only player characters can be nominated").toJson(), {
        status: 400,
      });

    // Must be in this bank's member countries
    if (!memberCountries.includes(target.countryId as CountryId))
      return NextResponse.json(badRequest("Character must be in a member country").toJson(), {
        status: 400,
      });

    // Target must not hold the executive office
    const targetExecOffice = COUNTRY_CONFIGS[target.countryId as CountryId]?.officeTypes.find(
      (o) => o.isExecutive
    );
    if (targetExecOffice && target.currentOffice?.type === targetExecOffice.key)
      return NextResponse.json(
        badRequest("The current executive cannot be nominated for central bank chair").toJson(),
        { status: 400 }
      );

    // Not already nominated
    const alreadyNominated = (bank.nominations ?? []).some(
      (n) => n.characterId.toString() === targetId.toString()
    );
    if (alreadyNominated)
      return NextResponse.json(badRequest("Character is already nominated").toJson(), {
        status: 400,
      });

    // Caller must have at least 1 action point
    if ((auth.character.actions ?? 0) < 1)
      return NextResponse.json(
        badRequest("You need at least 1 action point to nominate").toJson(),
        { status: 400 }
      );

    const nomination = {
      characterId: targetId,
      characterName: target.name,
      nominatedBy: auth.character._id,
      nominatedByName: auth.character.name,
      nominatedAt: new Date(),
    };
    try {
      await runWithOptionalTransaction(
        async (session) => {
          const debitResult = await db
            .collection<Character>("characters")
            .updateOne(
              { _id: auth.character._id, actions: { $gte: 1 } },
              { $inc: { actions: -1 } },
              { session }
            );
          if (debitResult.modifiedCount === 0) throw new Error("INSUFFICIENT_ACTIONS");

          const nominationResult = await centralBanks.updateOne(
            { _id: bankId, "nominations.characterId": { $ne: targetId } },
            {
              $push: { nominations: nomination },
              $set: { updatedAt: new Date() },
            },
            { session }
          );
          if (nominationResult.modifiedCount === 0) throw new Error("NOMINATION_CONFLICT");
        },
        async () => {
          const debitResult = await db
            .collection<Character>("characters")
            .updateOne(
              { _id: auth.character._id, actions: { $gte: 1 } },
              { $inc: { actions: -1 } }
            );
          if (debitResult.modifiedCount === 0) throw new Error("INSUFFICIENT_ACTIONS");

          try {
            const nominationResult = await centralBanks.updateOne(
              { _id: bankId, "nominations.characterId": { $ne: targetId } },
              {
                $push: { nominations: nomination },
                $set: { updatedAt: new Date() },
              }
            );
            if (nominationResult.modifiedCount === 0) throw new Error("NOMINATION_CONFLICT");
          } catch (error) {
            await db
              .collection<Character>("characters")
              .updateOne({ _id: auth.character._id }, { $inc: { actions: 1 } });
            throw error;
          }
        }
      );
    } catch (error) {
      if ((error as Error).message === "INSUFFICIENT_ACTIONS") {
        return NextResponse.json(
          badRequest("You need at least 1 action point to nominate").toJson(),
          { status: 400 }
        );
      }
      if ((error as Error).message === "NOMINATION_CONFLICT") {
        return NextResponse.json(
          badRequest("This nomination was already submitted. Please refresh.").toJson(),
          { status: 409 }
        );
      }
      throw error;
    }

    const updated = await centralBanks.findOne({ _id: bankId });
    const nominations = (updated?.nominations ?? []).map((n) => ({
      characterId: n.characterId.toString(),
      characterName: n.characterName,
      nominatedByName: n.nominatedByName,
      nominatedAt: n.nominatedAt,
    }));

    notifyCbExecutiveNominationDiscord(countryId, target.name, auth.character.name).catch((err) =>
      console.error("[central-bank/nominate] Discord webhook failed:", err)
    );

    return NextResponse.json({ success: true, nominations });
  } catch (error) {
    return handleRouteError(error);
  }
}
