import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireAuth } from "@/lib/api/requireAuth";
import { handleRouteError } from "@/lib/api/errors";
import { findPartyBySequentialId } from "@/lib/db/partyLookup";
import { listHolderTreasuryTransactions } from "@/lib/db/treasuryTransactionLookup";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import type { TreasuryTransactionCategory } from "@/lib/db/types";

const VALID_CATEGORIES: TreasuryTransactionCategory[] = [
  "donations",
  "caucus_tax",
  "transfers",
  "slate",
  "gotv",
  "suppression",
  "whip_ops",
  "recruitment",
  "operations",
  "fund_generation",
  "campaign_donation",
];

// GET /api/country/[code]/parties/[id]/treasury/transactions — Paginated treasury audit log
// Auth: requireAuth
// Query: ?before=<ISO>&limit=<1-200>&category=<...>&direction=credit|debit
// Errors: 400, 401, 404
export async function GET(
  request: Request,
  { params }: { params: Promise<{ code: string; id: string }> }
) {
  try {
    const { code, id } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return NextResponse.json({ error: "Invalid country code" }, { status: 400 });
    }

    const auth = await requireAuth();
    if (!auth.ok) return auth.response;

    const db = await getDb();
    const party = await findPartyBySequentialId(db, id, countryId);
    if (!party) return NextResponse.json({ error: "Party not found" }, { status: 404 });
    const partyId = String(party.sequentialId);

    const url = new URL(request.url);
    const beforeRaw = url.searchParams.get("before");
    const limitRaw = url.searchParams.get("limit");
    const categoryRaw = url.searchParams.get("category") as TreasuryTransactionCategory | null;
    const directionRaw = url.searchParams.get("direction");

    const before = beforeRaw ? new Date(beforeRaw) : undefined;
    if (before && Number.isNaN(before.getTime())) {
      return NextResponse.json({ error: "Invalid 'before' timestamp" }, { status: 400 });
    }
    const limit = limitRaw ? Math.max(1, Math.min(200, Number(limitRaw))) : 50;
    const category =
      categoryRaw && VALID_CATEGORIES.includes(categoryRaw) ? categoryRaw : undefined;
    const direction =
      directionRaw === "credit" || directionRaw === "debit" ? directionRaw : undefined;

    const rows = await listHolderTreasuryTransactions(db, {
      holderType: "party",
      holderId: partyId,
      countryId,
      options: {
        before,
        limit,
        category,
        direction,
      },
    });

    return NextResponse.json({
      items: rows.map((r) => ({
        id: r._id.toString(),
        holderType: r.holderType,
        holderId: r.holderId,
        category: r.category,
        direction: r.direction,
        amount: r.amount,
        currencyCode: r.currencyCode,
        memo: r.memo,
        counterparty: r.counterparty ?? null,
        initiatedBy: r.initiatedBy ?? null,
        turn: r.turn,
        createdAt: r.createdAt.toISOString(),
      })),
      // Cursor for the next page — caller passes this back as `before`.
      nextBefore: rows.length > 0 ? rows[rows.length - 1].createdAt.toISOString() : null,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
