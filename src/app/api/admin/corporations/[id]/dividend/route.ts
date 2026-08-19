// POST /api/admin/corporations/[id]/dividend
// Forces an immediate dividend payout based on current dividendRate.
// Distributes liquidCapital * dividendRate% proportionally to character shareholders.
// Auth: requireAdmin
// Errors: 403, 404

import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import type { AnyBulkWriteOperation } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError, notFound } from "@/lib/api/errors";
import type { Corporation, Character } from "@/lib/db/types";
import { isForexEnabled } from "@/lib/currency/featureFlag";
import { buildPersonalBalanceBulkOp } from "@/lib/currency/characterFunds";
import { resolveCorpLiquidCurrencyCode } from "@/lib/currency/corporationCapital";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const { id } = await params;
    const db = await getDb();

    const corp = await db
      .collection<Corporation>("corporations")
      .findOne({ _id: new ObjectId(id) });
    if (!corp) throw notFound("Corporation not found");

    const dividendRate = corp.dividendRate ?? 0;
    if (dividendRate <= 0) {
      return NextResponse.json({ success: true, paid: 0, note: "Dividend rate is 0" });
    }

    const totalPayout = corp.liquidCapital * (dividendRate / 100);
    if (totalPayout <= 0) {
      return NextResponse.json({ success: true, paid: 0, note: "Nothing to distribute" });
    }

    // Build per-character payouts (only character shareholders, not corp-owned shares)
    const charPayouts = new Map<string, number>();
    for (const sh of corp.shareholders) {
      if (!sh.characterId) continue;
      const proportion = sh.shares / corp.totalShares;
      const amount = totalPayout * proportion;
      if (amount > 0) {
        const key = sh.characterId.toString();
        charPayouts.set(key, (charPayouts.get(key) ?? 0) + amount);
      }
    }

    if (charPayouts.size === 0) {
      return NextResponse.json({ success: true, paid: 0, note: "No character shareholders" });
    }

    // Dividends are paid in the corporation's home currency. Resolve via the
    // canonical helper so admin-relocated corps (where `liquidCurrencyCode`
    // may diverge from `countryId`'s default currency) credit shareholders in
    // the same unit the `-totalPayout` deduction leaves, preventing silent
    // money creation/destruction at the FX ratio. (A28)
    const forexEnabled = await isForexEnabled();
    const corpCurrency = resolveCorpLiquidCurrencyCode(corp) ?? "USD";
    const charOps: AnyBulkWriteOperation<Character>[] = [...charPayouts.entries()].map(
      ([charId, amount]) =>
        buildPersonalBalanceBulkOp(
          new ObjectId(charId),
          amount,
          corpCurrency,
          forexEnabled
        ) as AnyBulkWriteOperation<Character>
    );

    await Promise.all([
      db.collection<Character>("characters").bulkWrite(charOps),
      db
        .collection<Corporation>("corporations")
        .updateOne(
          { _id: new ObjectId(id) },
          { $inc: { liquidCapital: -totalPayout }, $set: { updatedAt: new Date() } }
        ),
    ]);

    return NextResponse.json({ success: true, paid: totalPayout, recipients: charPayouts.size });
  } catch (error) {
    return handleRouteError(error);
  }
}
