import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError, notFound } from "@/lib/api/errors";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { processCentralBankChairSelection } from "@/lib/turn/centralBankChairSelection";
import { getGameState } from "@/lib/gameState";
import { createAdminLog } from "@/lib/adminLog";

export async function POST(request: Request, { params }: { params: Promise<{ code: string }> }) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const { code } = await params;
    const countryId = code.toUpperCase() as CountryId;
    const config = COUNTRY_CONFIGS[countryId];
    if (!config) return NextResponse.json(notFound("Country not found").toJson(), { status: 404 });

    const db = await getDb();
    const gameState = await getGameState();
    const currentTurn = gameState?.currentTurn ?? 0;
    const gameNow = gameState?.lastTurnProcessed
      ? new Date(gameState.lastTurnProcessed)
      : new Date();

    const result = await processCentralBankChairSelection(db, currentTurn, gameNow);

    await createAdminLog({
      category: "election",
      action: "central_bank_chair_selection_triggered",
      username: auth.admin.username,
      adminUsername: auth.admin.username,
      details: `Triggered chair selection for ${config.centralBank.name}: ${result.selectionsTriggered} selections, ${result.politicalPicks} political, ${result.economicPicks} economic`,
    });

    return NextResponse.json({ success: true, result });
  } catch (error) {
    return handleRouteError(error);
  }
}
