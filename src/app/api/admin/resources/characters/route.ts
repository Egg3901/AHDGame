import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError } from "@/lib/api/errors";
import type { Character } from "@/lib/db/types";
export async function GET() {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const db = await getDb();

    const characters = await db
      .collection<Character>("characters")
      .find({})
      .sort({ name: 1 })
      .toArray();

    const characterList = characters.map((char) => ({
      id: char._id.toString(),
      name: char.name,
      party: char.party,
      homeState: char.homeState,
      actions: char.actions,
      // LOCAL home-currency balance (canonical source of truth).
      funds: char.currencyBalances?.campaign ?? char.funds ?? 0,
    }));

    return NextResponse.json({
      characters: characterList,
      total: characterList.length,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
