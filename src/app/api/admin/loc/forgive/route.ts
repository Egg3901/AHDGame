// POST /api/admin/loc/forgive — Admin: forgive all arrears or force-unfreeze draws for a LOC account
// Auth: requireAdmin
// Errors: 400, 403, 404

import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError, badRequest } from "@/lib/api/errors";
import { parseJsonBody } from "@/lib/api/validate";
import type { Character } from "@/lib/db/types";
import { ZOD_ACTIVE_CURRENCY_ENUM, FOREX_ACTIVE_CURRENCIES } from "@/lib/constants/currencies";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { insertLocLedgerEntry } from "@/lib/lineOfCredit/ledger";
import { getGameState } from "@/lib/gameState";

const bodySchema = z.object({
  characterId: z.string().min(1),
  currency: z.enum(ZOD_ACTIVE_CURRENCY_ENUM),
  action: z.enum(["forgive_arrears", "unfreeze"]),
});

export async function POST(request: Request) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const parsed = await parseJsonBody(request, bodySchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    const { characterId, currency, action } = parsed.data;
    const c = currency as CurrencyCode;

    if (!ObjectId.isValid(characterId)) {
      return NextResponse.json(badRequest("Invalid characterId").toJson(), { status: 400 });
    }

    const db = await getDb();
    const charObjectId = new ObjectId(characterId);
    const character = await db.collection<Character>("characters").findOne({ _id: charObjectId });
    if (!character?.lineOfCredit) {
      return NextResponse.json(badRequest("Character or LOC account not found").toJson(), {
        status: 404,
      });
    }

    const loc = character.lineOfCredit;
    const gameState = await getGameState();
    const turn = gameState?.currentTurn ?? 0;

    if (action === "forgive_arrears") {
      const forgiven = loc.arrears?.[c] ?? 0;
      if (forgiven <= 0) {
        return NextResponse.json(badRequest("No arrears to forgive for this currency").toJson(), {
          status: 400,
        });
      }

      // Clear drawFrozen when this forgiveness zeroes out all outstanding arrears.
      let otherArrearsTotal = 0;
      for (const other of FOREX_ACTIVE_CURRENCIES) {
        if (other === c) continue;
        otherArrearsTotal += loc.arrears?.[other] ?? 0;
      }
      const clearFreeze = loc.drawFrozen === true && otherArrearsTotal <= 0;

      const set: Record<string, unknown> = {
        [`lineOfCredit.arrears.${c}`]: 0,
        updatedAt: new Date(),
      };
      if (clearFreeze) set["lineOfCredit.drawFrozen"] = false;

      await db.collection<Character>("characters").updateOne({ _id: charObjectId }, { $set: set });

      await insertLocLedgerEntry(db, {
        characterId: charObjectId,
        currencyCode: c,
        type: "admin_forgive",
        amount: forgiven,
        balanceAfter: loc.balances?.[c] ?? 0,
        arrearsAfter: 0,
        turn,
        meta: { adminAction: true },
      });

      if (clearFreeze) {
        await insertLocLedgerEntry(db, {
          characterId: charObjectId,
          currencyCode: c,
          type: "unfreeze",
          amount: 0,
          balanceAfter: loc.balances?.[c] ?? 0,
          arrearsAfter: 0,
          turn,
          meta: { adminAction: true },
        });
      }

      return NextResponse.json({
        success: true,
        action,
        currency: c,
        forgiven,
        drawUnfrozen: clearFreeze,
      });
    }

    // action === "unfreeze"
    if (!loc.drawFrozen) {
      return NextResponse.json(
        badRequest("Draws are not currently frozen for this account").toJson(),
        { status: 400 }
      );
    }

    await db
      .collection<Character>("characters")
      .updateOne(
        { _id: charObjectId },
        { $set: { "lineOfCredit.drawFrozen": false, updatedAt: new Date() } }
      );

    await insertLocLedgerEntry(db, {
      characterId: charObjectId,
      currencyCode: c,
      type: "unfreeze",
      amount: 0,
      balanceAfter: loc.balances?.[c] ?? 0,
      arrearsAfter: loc.arrears?.[c] ?? 0,
      turn,
      meta: { adminAction: true },
    });

    return NextResponse.json({ success: true, action, currency: c });
  } catch (error) {
    return handleRouteError(error);
  }
}
