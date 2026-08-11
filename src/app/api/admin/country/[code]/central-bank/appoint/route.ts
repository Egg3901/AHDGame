import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { parseJsonBody, schemas } from "@/lib/api/validate";
import { handleRouteError, notFound, badRequest } from "@/lib/api/errors";
import { createAdminLog } from "@/lib/adminLog";
import { createNotification } from "@/lib/notifications";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import type { CentralBank } from "@/lib/db/types";
import { CHAIR_TERM_TURNS } from "@/lib/turn/centralBankChairSelection";
import { getGameState } from "@/lib/gameState";
import { getBankId } from "@/lib/centralBank/helpers";

const schema = z.object({
  characterId: schemas.objectId.nullable(),
});

export async function POST(request: Request, { params }: { params: Promise<{ code: string }> }) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const { code } = await params;
    const countryId = code.toUpperCase() as CountryId;
    const config = COUNTRY_CONFIGS[countryId];
    if (!config) return NextResponse.json(notFound("Country not found").toJson(), { status: 404 });

    const parsed = await parseJsonBody(request, schema);
    if (!parsed.success)
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });

    const db = await getDb();
    const centralBanks = db.collection<CentralBank>("centralBanks");
    const characters = db.collection("characters");
    const bankId = getBankId(countryId);

    // Ensure bank doc exists
    const existing = await centralBanks.findOne({ _id: bankId });
    if (!existing) {
      await centralBanks.insertOne({
        _id: bankId,
        countryId,
        chairCharacterId: null,
        chairCharacterName: null,
        chairAppointedAt: null,
        chairAppointedBy: null,
        primeRate: config.centralBank.defaultPrimeRate,
        rateHistory: [],
        chairInfamy: 0,
        chairTermExpiresAtTurn: null,
        nominations: [],
        lobbyingPool: [],
        interestRateHistory: [],
        inflationHistory: [],
        gdpGrowthHistory: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      } as CentralBank);
    }

    const bank = (await centralBanks.findOne({ _id: bankId }))!;

    // Clear any legacy `currentOffice.type === "centralBankChair"` left over
    // from the pre-stacking era so the previous chair's slot isn't
    // misreported. Chair status itself lives on this bank document.
    if (bank.chairCharacterId) {
      await characters.updateOne(
        {
          _id: new ObjectId(bank.chairCharacterId),
          "currentOffice.type": "centralBankChair",
        },
        { $set: { currentOffice: null } }
      );
    }

    if (parsed.data.characterId === null) {
      // Vacate only — next chair selection phase may propose a replacement (same as player resign)
      await centralBanks.updateOne(
        { _id: bankId },
        {
          $set: {
            chairCharacterId: null,
            chairCharacterName: null,
            chairAppointedAt: null,
            chairAppointedBy: null,
            chairInfamy: 0,
            chairTermExpiresAtTurn: null,
            chairSelectionPending: null,
            vacancyAwaitingAutomaticSelection: true,
            updatedAt: new Date(),
          },
        }
      );

      await createAdminLog({
        category: "election",
        action: "central_bank_chair_vacated",
        username: auth.admin.username,
        adminUsername: auth.admin.username,
        details: `Vacated ${config.centralBank.chairTitle} for ${config.centralBank.name}`,
      });

      return NextResponse.json({ success: true, action: "vacated" });
    }

    // Appoint new chair
    const charId = new ObjectId(parsed.data.characterId);
    const character = await characters.findOne({ _id: charId });
    if (!character) {
      return NextResponse.json(badRequest("Character not found").toJson(), { status: 400 });
    }

    // Chair role lives on the bank document; do NOT overwrite the character's
    // currentOffice. That would wipe any elected seat they hold (Councillor,
    // Senator, etc.) and strip the stacked office bonus we grant in
    // actionRefresh.ts.

    // Update bank document
    const gameState = await getGameState();
    const currentTurn = gameState?.currentTurn ?? 0;

    await centralBanks.updateOne(
      { _id: bankId },
      {
        $set: {
          chairCharacterId: charId,
          chairCharacterName: character.name,
          chairAppointedAt: new Date(),
          chairAppointedBy: new ObjectId(auth.admin.userId),
          chairInfamy: 0,
          chairTermExpiresAtTurn: currentTurn + CHAIR_TERM_TURNS,
          chairSelectionPending: null,
          vacancyAwaitingAutomaticSelection: false,
          updatedAt: new Date(),
        },
      }
    );

    // Notify the appointed character
    await createNotification({
      userId: character.userId,
      type: "system",
      title: `Appointed as ${config.centralBank.chairTitle}`,
      message: `You have been appointed as the ${config.centralBank.chairTitle} of the ${config.centralBank.name}.`,
    });

    await createAdminLog({
      category: "election",
      action: "central_bank_chair_appointed",
      username: auth.admin.username,
      characterName: character.name,
      adminUsername: auth.admin.username,
      details: `Appointed ${character.name} as ${config.centralBank.chairTitle} for ${config.centralBank.name}`,
    });

    return NextResponse.json({
      success: true,
      action: "appointed",
      characterName: character.name,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
