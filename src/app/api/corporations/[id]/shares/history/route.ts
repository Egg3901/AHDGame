import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { handleRouteError } from "@/lib/api/errors";
import { shareHistoryQuerySchema } from "@/lib/api/schemas/shareHistory";
import { resolveCorporation } from "@/lib/api/corporations/resolveQuery";
import type { ShareTradeHistory } from "@/lib/db/types";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/corporations/[id]/shares/history
 * Paginated trade history for a corporation — newest first.
 * Auth: public read (visibility matches the shareholder register).
 * Errors: 400 (bad query), 404 (corp not found).
 */
export async function GET(request: Request, { params }: RouteParams) {
  try {
    const { id } = await params;
    const url = new URL(request.url);
    const parsed = shareHistoryQuerySchema.safeParse({
      page: url.searchParams.get("page") ?? undefined,
      pageSize: url.searchParams.get("pageSize") ?? undefined,
    });
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid query" },
        { status: 400 }
      );
    }
    const { page, pageSize } = parsed.data;

    const db = await getDb();
    const resolved = await resolveCorporation(db, id);
    if (!resolved.ok) return resolved.response;
    const { corporation } = resolved;

    const filter = { corporationId: corporation._id };
    const total = await db
      .collection<ShareTradeHistory>("shareTradeHistory")
      .countDocuments(filter);

    const entries = await db
      .collection<ShareTradeHistory>("shareTradeHistory")
      .find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .toArray();

    return NextResponse.json({
      page,
      pageSize,
      total,
      pageCount: total === 0 ? 1 : Math.ceil(total / pageSize),
      entries: entries.map((e) => ({
        id: e._id.toString(),
        kind: e.kind,
        turn: e.turn,
        createdAt: e.createdAt,
        shares: e.shares,
        pricePerShareAnchor: e.pricePerShareAnchor,
        totalAnchor: e.totalAnchor,
        corpCurrencyCode: e.corpCurrencyCode,
        from: e.from
          ? {
              characterId: e.from.characterId?.toString(),
              imperialCharacterId: e.from.imperialCharacterId?.toString(),
              corporationId: e.from.corporationId?.toString(),
              name: e.from.name,
            }
          : null,
        to: e.to
          ? {
              characterId: e.to.characterId?.toString(),
              imperialCharacterId: e.to.imperialCharacterId?.toString(),
              corporationId: e.to.corporationId?.toString(),
              name: e.to.name,
            }
          : null,
        note: e.note,
        structureChange: e.structureChange ?? null,
      })),
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
