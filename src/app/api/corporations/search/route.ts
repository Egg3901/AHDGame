// GET /api/corporations/search?q=...&limit=...
// General corporation name/ticker search for pickers that need the whole
// universe rather than a filtered slice. `buyer-search` restricts to
// player-run private corps and `country/[code]/corp-search` to one country's
// non-state corps; a bank refusing business can refuse anyone, so neither
// filter applies here.
// Auth: public read. Errors: none (an empty query returns no results)
import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { handleRouteError } from "@/lib/api/errors";
import type { Corporation } from "@/lib/db/types";
import { escapeRegex } from "@/lib/utils/escapeRegex";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const q = url.searchParams.get("q")?.trim() ?? "";
    if (q.length < 2) return NextResponse.json({ results: [] });

    const limitParam = Number.parseInt(url.searchParams.get("limit") ?? "8", 10);
    const limit = Math.min(Number.isNaN(limitParam) ? 8 : Math.max(1, limitParam), 20);

    const escaped = escapeRegex(q);
    const db = await getDb();
    const rows = await db
      .collection<Corporation>("corporations")
      .find(
        { $or: [{ name: { $regex: escaped, $options: "i" } }, { tickerSymbol: escaped }] },
        { projection: { name: 1, tickerSymbol: 1, sequentialId: 1, countryId: 1, logoUrl: 1 } }
      )
      .limit(limit)
      .sort({ name: 1 })
      .toArray();

    return NextResponse.json({
      results: rows.map((c) => ({
        id: c._id.toString(),
        name: c.name,
        ticker: c.tickerSymbol ?? null,
        sequentialId: c.sequentialId ?? null,
        countryId: c.countryId ?? null,
        logoUrl: c.logoUrl ?? null,
      })),
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
