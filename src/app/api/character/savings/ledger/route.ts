import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { getCharacterByUserId } from "@/lib/db/characterLookup";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { handleRouteError } from "@/lib/api/errors";
import { fetchSavingsLedgerForCharacter } from "@/lib/savings/ledger";
import { ZOD_ACTIVE_CURRENCY_ENUM } from "@/lib/constants/currencies";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { z } from "zod";

const querySchema = z.object({
  currency: z.enum(ZOD_ACTIVE_CURRENCY_ENUM).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

// GET /api/character/savings/ledger — Transaction history for high-yield savings
// Auth: requireBasicAuth
// Errors: 401, 404
export async function GET(request: Request) {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;

    const url = new URL(request.url);
    const parsed = querySchema.safeParse({
      currency: url.searchParams.get("currency") ?? undefined,
      limit: url.searchParams.get("limit") ?? undefined,
    });
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid query" }, { status: 400 });
    }
    const limit = parsed.data.limit ?? 50;
    const currency = parsed.data.currency as CurrencyCode | undefined;

    const db = await getDb();
    const character = await getCharacterByUserId(db, auth.user.userId);

    if (!character) {
      return NextResponse.json({ error: "Character not found" }, { status: 404 });
    }

    const entries = await fetchSavingsLedgerForCharacter(db, character._id, currency, limit);

    return NextResponse.json({ entries });
  } catch (error) {
    return handleRouteError(error);
  }
}
