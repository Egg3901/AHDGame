// GET: the authenticated player's OWN share-trade history with FIFO realized P&L,
//      optionally for a corporation they are CEO of instead of themselves.
// Auth: requireAuthWithCharacter. A viewer can only ever read their own tape —
//       the per-corporation PUBLIC tape already lives at
//       /api/corporations/[id]/shares/history and is a different surface.
// Errors: 400 (bad query), 401, 403 (not CEO of the requested corp), 500
import { NextResponse } from "next/server";
import { withNoStore } from "@/lib/api/withNoStore";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { handleRouteError, badRequest, forbidden } from "@/lib/api/errors";
import type { Corporation, ShareTradeHistory } from "@/lib/db/types";
import { computeRealizedPnlByCorporation, type LedgerViewer } from "@/lib/corporations/tradeLedger";

const querySchema = z.object({
  /** Read a corporation's book instead of the character's. Must be its CEO. */
  corporationId: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});

/**
 * Rows are fetched in CHRONOLOGICAL order because the FIFO walk is
 * order-dependent, then re-sorted newest-first for display inside
 * `computeRealizedPnlByCorporation`. Do not "optimize" this to a descending
 * query: it would silently invert every cost basis.
 */
async function handleGET(request: Request) {
  try {
    const auth = await requireAuthWithCharacter();
    if (!auth.ok) return auth.response;

    const url = new URL(request.url);
    const parsed = querySchema.safeParse({
      corporationId: url.searchParams.get("corporationId") ?? undefined,
      limit: url.searchParams.get("limit") ?? undefined,
    });
    if (!parsed.success) {
      throw badRequest(parsed.error.issues[0]?.message ?? "Invalid query");
    }
    const { corporationId, limit } = parsed.data;

    const db = await getDb();
    const characterId = auth.user.character._id;

    let viewer: LedgerViewer;
    let match: Record<string, unknown>;

    if (corporationId) {
      if (!ObjectId.isValid(corporationId)) throw badRequest("Invalid corporation id");
      const corpId = new ObjectId(corporationId);
      const corp = await db
        .collection<Corporation>("corporations")
        .findOne({ _id: corpId }, { projection: { ceoId: 1, userId: 1 } });
      if (!corp) throw badRequest("Corporation not found");
      // Only the sitting CEO may read a corp's own book. Its trades are its
      // owner's private business; the public tape is the other endpoint.
      const isCeo = corp.ceoId?.toString() === characterId.toString();
      if (!isCeo) throw forbidden("Only the CEO can view this corporation's trade history");
      viewer = { corporationId: corpId };
      match = {
        $or: [{ "from.corporationId": corpId }, { "to.corporationId": corpId }],
      };
    } else {
      viewer = { characterId };
      match = {
        $or: [
          { "from.characterId": characterId },
          { "to.characterId": characterId },
          { "from.imperialCharacterId": characterId },
          { "to.imperialCharacterId": characterId },
        ],
      };
    }

    const ownRows = await db
      .collection<ShareTradeHistory>("shareTradeHistory")
      .find(match)
      .sort({ turn: 1, createdAt: 1 })
      .limit(limit)
      .toArray();

    // Splits carry no from/to, so the ownership query above cannot see them —
    // but they rescale open lots and the basis is wrong without them. Pull the
    // structure-change rows for exactly the corps the viewer actually traded,
    // over the same window, and merge them into the chronological walk.
    const corpIds = [...new Set(ownRows.map((r) => r.corporationId.toString()))].map(
      (id) => new ObjectId(id)
    );
    const splitRows = corpIds.length
      ? await db
          .collection<ShareTradeHistory>("shareTradeHistory")
          .find({
            corporationId: { $in: corpIds },
            kind: { $in: ["stock_split", "reverse_split"] },
          })
          .sort({ turn: 1, createdAt: 1 })
          .toArray()
      : [];

    const rows = [...ownRows, ...splitRows].sort(
      (a, b) => a.turn - b.turn || a.createdAt.getTime() - b.createdAt.getTime()
    );

    const result = computeRealizedPnlByCorporation(rows, viewer);

    // Name the corporations so the client does not need a second round trip.
    const corpNames = corpIds.length
      ? await db
          .collection<Corporation>("corporations")
          .find({ _id: { $in: corpIds } }, { projection: { name: 1, tickerSymbol: 1 } })
          .toArray()
      : [];
    const nameById = new Map(
      corpNames.map((c) => [c._id.toString(), { name: c.name, ticker: c.tickerSymbol ?? null }])
    );

    return NextResponse.json({
      scope: corporationId ? "corporation" : "character",
      totalRealizedPnlAnchor: result.totalRealizedPnlAnchor,
      hasUnmatchedSales: result.hasUnmatchedSales,
      entries: result.entries.map((e) => ({
        ...e,
        createdAt: e.createdAt.toISOString(),
        corporationName: nameById.get(e.corporationId)?.name ?? "Unknown",
        corporationTicker: nameById.get(e.corporationId)?.ticker ?? null,
      })),
      positions: [...result.byCorporation.entries()]
        .map(([corpId, r]) => ({
          corporationId: corpId,
          corporationName: nameById.get(corpId)?.name ?? "Unknown",
          corporationTicker: nameById.get(corpId)?.ticker ?? null,
          realizedPnlAnchor: r.totalRealizedPnlAnchor,
          openShares: r.openShares,
          openCostPerShareAnchor: r.openCostPerShareAnchor,
          hasUnmatchedSales: r.hasUnmatchedSales,
        }))
        .sort((a, b) => b.realizedPnlAnchor - a.realizedPnlAnchor),
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

export const GET = withNoStore(handleGET);
