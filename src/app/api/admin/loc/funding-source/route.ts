// POST /api/admin/loc/funding-source — Set the funding source for a player's open LOC account
// Auth: requireAdmin
// Errors: 400, 401, 403, 404
//
// Note: this only changes the source flag on the loan. It does NOT retroactively
// shuffle already-deducted pool balances between deposits and reserves; the new
// split takes effect from the next draw or repay onward.

import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError, badRequest } from "@/lib/api/errors";
import { parseJsonBody } from "@/lib/api/validate";
import type { Character } from "@/lib/db/types";
import { ZOD_ACTIVE_CURRENCY_ENUM } from "@/lib/constants/currencies";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { isValidFundingSource } from "@/lib/lineOfCredit/fundingSource";
import type { LoanFundingSource } from "@/lib/db/types/character";

const bodySchema = z.object({
  characterId: z.string().min(1),
  currency: z.enum(ZOD_ACTIVE_CURRENCY_ENUM),
  source: z.enum(["deposits", "reserves", "both"]),
});

export async function POST(request: Request) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const parsed = await parseJsonBody(request, bodySchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    const { characterId, currency, source } = parsed.data;
    const c = currency as CurrencyCode;
    if (!isValidFundingSource(source)) {
      return NextResponse.json(badRequest("Invalid funding source").toJson(), { status: 400 });
    }

    if (!ObjectId.isValid(characterId)) {
      return NextResponse.json(badRequest("Invalid characterId").toJson(), { status: 400 });
    }

    const db = await getDb();
    const charObjectId = new ObjectId(characterId);
    const res = await db.collection<Character>("characters").updateOne(
      { _id: charObjectId, [`lineOfCredit.accountsOpened.${c}`]: true },
      {
        $set: {
          [`lineOfCredit.fundingSource.${c}`]: source as LoanFundingSource,
          updatedAt: new Date(),
        },
      }
    );
    if (res.matchedCount === 0) {
      return NextResponse.json(
        badRequest("Character or LOC account not found for that currency").toJson(),
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, currency: c, source });
  } catch (error) {
    return handleRouteError(error);
  }
}
