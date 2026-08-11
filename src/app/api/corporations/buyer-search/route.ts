// GET /api/corporations/buyer-search?q=...&exclude=<corpId>
// Name search for supply-agreement counterparties: private, player-run
// corporations across ALL countries (not just the supplier's own), so a CEO can
// contract with a foreign player-owned corp (#106). Restricted to
// `ceoType: "character"` so the buyer actually has a human CEO who can accept the
// offer; excludes state-owned corps and the supplier itself.
// Auth: public read. Errors: 400
import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { ObjectId } from "mongodb";
import { handleRouteError } from "@/lib/api/errors";
import type { Corporation } from "@/lib/db/types";
import { escapeRegex } from "@/lib/utils/escapeRegex";
import { isStateOwned } from "@/lib/nationalization/nationalCorporation";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const q = url.searchParams.get("q")?.trim() ?? "";
    if (q.length < 2) return NextResponse.json({ results: [] });
    const excludeId = url.searchParams.get("exclude");

    const db = await getDb();
    const rows = await db
      .collection<Corporation>("corporations")
      .find({
        // Private (not state-owned) and player-run — a human CEO must be able to
        // accept. Any country is eligible; that is the point of #106.
        countryOwnerId: { $exists: false },
        ceoType: "character",
        ...(excludeId && ObjectId.isValid(excludeId)
          ? { _id: { $ne: new ObjectId(excludeId) } }
          : {}),
        name: { $regex: escapeRegex(q), $options: "i" },
      })
      .limit(10)
      .toArray();

    const results = rows
      .filter((c) => !isStateOwned(c))
      .map((c) => ({
        id: String(c._id),
        name: c.name,
        ticker: c.tickerSymbol ?? null,
        countryId: c.countryId ?? null,
      }));
    return NextResponse.json({ results });
  } catch (error) {
    return handleRouteError(error);
  }
}
