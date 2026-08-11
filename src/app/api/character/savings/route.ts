import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { handleRouteError } from "@/lib/api/errors";
import { getCharacterByUserId } from "@/lib/db/characterLookup";
import { loadSavingsApyByCurrency } from "@/lib/api/savings/savingsApy";
import { turnsUntilSavingsCredit } from "@/lib/currency/savingsInterest";
import { getGameState } from "@/lib/gameState";

// GET /api/character/savings — APY map (half national prime) and savings account flags for the active character
// Auth: requireBasicAuth
// Errors: 401, 404
export async function GET() {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;

    const db = await getDb();
    const [character, gameState] = await Promise.all([
      getCharacterByUserId(db, auth.user.userId),
      getGameState(),
    ]);

    if (!character) {
      return NextResponse.json({ error: "Character not found" }, { status: 404 });
    }

    const apyByCurrency = await loadSavingsApyByCurrency(db);

    return NextResponse.json({
      apyByCurrency,
      savingsAccountsOpened: character.savingsAccountsOpened ?? {},
      savingsBalances: character.currencyBalances?.savings ?? {},
      interestEarned: character.currencyBalances?.interestEarned ?? {},
      savingsInterestEarnedLifetime: character.savingsInterestEarnedLifetime ?? 0,
      pendingInterest: character.currencyBalances?.pendingSavingsInterest ?? {},
      turnsUntilCredit: turnsUntilSavingsCredit(gameState?.currentTurn ?? 0),
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
