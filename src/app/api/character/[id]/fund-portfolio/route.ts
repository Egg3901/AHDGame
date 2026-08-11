import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { getAuthUserWithCharacter } from "@/lib/auth";
import { handleRouteError, notFound } from "@/lib/api/errors";
import { isIndexFundsEnabled } from "@/lib/indexFunds/featureFlag";
import {
  listCharacterPositions,
  listFundsByIds,
  listCharacterFundTransactions,
} from "@/lib/indexFunds/fundQueries";
import { INDEX_FUNDS_DISABLED_MESSAGE } from "@/lib/indexFunds/featureFlag";

// GET /api/character/[id]/fund-portfolio — Character's fund positions and recent transactions
// Auth: the character owner or admin
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await getAuthUserWithCharacter();
    if (!auth) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

    const db = await getDb();
    if (!(await isIndexFundsEnabled())) {
      return NextResponse.json({ error: INDEX_FUNDS_DISABLED_MESSAGE }, { status: 403 });
    }

    const { id } = await params;
    let characterId: ObjectId;
    try {
      characterId = new ObjectId(id);
    } catch {
      throw notFound("Invalid character ID");
    }

    // Access check: only the character owner or admin can view portfolio.
    if (!auth.isAdmin && auth.character?._id?.toString() !== characterId.toString()) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    const positions = await listCharacterPositions(db, characterId);

    // Enrich positions with fund details — one batched fund load instead of a
    // findOne per position.
    const uniqueFundIds = [
      ...new Map(positions.map((pos) => [pos.fundId.toString(), pos.fundId])).values(),
    ];
    const funds = await listFundsByIds(db, uniqueFundIds);
    const fundById = new Map(funds.map((fund) => [fund._id.toString(), fund]));
    const enrichedPositions = positions.map((pos) => {
      const fund = fundById.get(pos.fundId.toString()) ?? null;
      return {
        fundId: fund?.slug ?? pos.fundId.toString(),
        slug: fund?.slug ?? null,
        name: fund?.name ?? null,
        tickerSymbol: fund?.tickerSymbol ?? null,
        anchorCurrencyCode: fund?.anchorCurrencyCode ?? null,
        units: pos.units,
        // #857 grandfather: legacy units redeem rate-free. Default absent →
        // full position (matches the redeem debit's `legacyUnits ?? units`).
        legacyUnits: pos.legacyUnits ?? pos.units,
        avgNavAnchor: pos.avgNavAnchor ?? null,
        currentNav: fund?.quotedNav ?? null,
        marketValueAnchor: fund ? pos.units * fund.quotedNav : null,
        status: fund?.status ?? null,
      };
    });

    // Recent transactions for this character.
    const transactions = await listCharacterFundTransactions(db, characterId, 30);

    return NextResponse.json({
      positions: enrichedPositions,
      transactions: transactions.map((tx) => ({
        id: tx._id.toString(),
        fundId: tx.fundId.toString(), // internal ObjectId — used only for dedup key
        kind: tx.kind,
        units: tx.units ?? null,
        navAnchor: tx.navAnchor ?? null,
        amountAnchor: tx.amountAnchor,
        note: tx.note ?? null,
        createdAt: tx.createdAt,
      })),
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
