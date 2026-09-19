// GET /api/corporations/buyer-search?q=...&exclude=<corpId>
// Name search for supply-agreement counterparties and acquisition targets:
// player-run corporations across ALL countries (not just the supplier's own),
// so a CEO can contract with / offer to buy a foreign player-owned corp (#106),
// plus AI-run (NPP) private corps, whose acquisition offers auto-resolve at the
// asking price instead of waiting for a human Accept (#217).
// Player-run seats need a human who can accept (missing `ceoType` counts as
// character: founding historically omitted it). NPP seats need no acceptor but
// must be genuinely AI-run: caretaker-run player corps stay excluded.
// Excludes state-owned corps, imperial seats, and the caller itself.
// Auth: public read. Errors: none
import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { ObjectId } from "mongodb";
import { handleRouteError } from "@/lib/api/errors";
import type { Corporation } from "@/lib/db/types";
import { escapeRegex } from "@/lib/utils/escapeRegex";
import { isStateOwned } from "@/lib/nationalization/nationalCorporation";
import { PLAYER_RUN_CEO_FILTER } from "@/lib/corporations/playerRunCeo";

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
        // Not state-owned; player-run (a human CEO must be able to accept) or
        // genuinely AI-run (offers auto-resolve, #217). Any country is
        // eligible; that is the point of #106.
        countryOwnerId: { $exists: false },
        $or: [
          ...PLAYER_RUN_CEO_FILTER.$or,
          { ceoType: "npp" as const, caretakerCeo: { $exists: false } },
        ],
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
        nppRun: c.ceoType === "npp" && !c.caretakerCeo,
      }));
    return NextResponse.json({ results });
  } catch (error) {
    return handleRouteError(error);
  }
}
