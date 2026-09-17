import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { requireCeo, resolveCorporation } from "@/lib/api/corporations/resolveQuery";
import { requireCorporationActionsEnabled } from "@/lib/api/requireCorporationActions";
import { parseJsonBody } from "@/lib/api/validate";
import { handleRouteError } from "@/lib/api/errors";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import {
  supplyListingActionSchema,
  supplyListingQuerySchema,
} from "@/lib/api/schemas/supplyListings";
import { getCurrentTurn } from "@/lib/turn/currentTurn";
import { supplyAgreementRequiresState } from "@/lib/market/commodityMarketScope";
import type { Corporation, GameConfig, State } from "@/lib/db/types";
import type { SupplyListing, SupplyListingView } from "@/lib/db/types/supplyListing";

type Context = { params: Promise<{ id: string }> };
const privateHeaders = { "Cache-Control": "private, no-store" };
async function access(context: Context) {
  const auth = await requireBasicAuth();
  if (!auth.ok) return { ok: false as const, response: auth.response };
  const db = await getDb();
  const resolved = await resolveCorporation(db, (await context.params).id);
  if (!resolved.ok) return resolved;
  const denied = requireCeo(resolved.corporation, auth.user.userId);
  if (denied) return { ok: false as const, response: denied };
  const config = await db
    .collection<GameConfig>("gameConfig")
    .findOne({ _id: "default" }, { projection: { supplyAgreementsEnabled: 1 } });
  if (!config?.supplyAgreementsEnabled)
    return {
      ok: false as const,
      response: NextResponse.json({ error: "Supply agreements are not enabled." }, { status: 403 }),
    };
  return { ok: true as const, db, corp: resolved.corporation, userId: auth.user.userId };
}

/** Read only public advertisements, never private supply agreements. */
export async function GET(request: Request, context: Context) {
  try {
    const a = await access(context);
    if (!a.ok) return a.response;
    const url = new URL(request.url);
    const query = supplyListingQuerySchema.safeParse({
      commodity: url.searchParams.get("commodity") ?? undefined,
      page: url.searchParams.get("page") ?? 0,
    });
    if (!query.success)
      return NextResponse.json({ error: "Invalid listing filter" }, { status: 400 });
    const turn = await getCurrentTurn(a.db);
    const collection = a.db.collection<SupplyListing>("supplyListings");
    const [rows, own] = await Promise.all([
      collection
        .find({
          expiresAtTurn: { $gt: turn },
          ...(query.data.commodity ? { commodity: query.data.commodity } : {}),
        })
        .sort({ updatedAt: -1, _id: 1 })
        .skip(query.data.page * 30)
        .limit(31)
        .toArray(),
      collection
        .find({ corporationId: a.corp._id, expiresAtTurn: { $gt: turn } })
        .limit(10)
        .toArray(),
    ]);
    const corps = await a.db
      .collection<Corporation>("corporations")
      .find({ _id: { $in: [...rows, ...own].map((row) => row.corporationId) } })
      .project({ _id: 1, name: 1, userId: 1, ceoVacant: 1 })
      .toArray();
    const byId = new Map(corps.map((c) => [c._id.toString(), c]));
    const serialize = (row: SupplyListing): SupplyListingView | null => {
      const corp = byId.get(row.corporationId.toString());
      const own = row.corporationId.equals(a.corp._id);
      if (!corp || (!own && (corp.ceoVacant || corp.userId?.toString() !== row.publishedByUserId)))
        return null;
      return {
        id: row._id,
        corporationId: row.corporationId.toString(),
        corporationName: corp.name,
        slot: row.slot,
        own,
        side: row.side,
        commodity: row.commodity,
        ...(row.stateId ? { stateId: row.stateId } : {}),
        volumeCap: row.volumeCap,
        pricePremium: row.pricePremium,
        ...(row.durationTurns != null ? { durationTurns: row.durationTurns } : {}),
        expiresAtTurn: row.expiresAtTurn,
      };
    };
    return NextResponse.json(
      {
        listings: rows.slice(0, 30).map(serialize).filter(Boolean),
        ownListings: own.map(serialize).filter(Boolean),
        hasMore: rows.length > 30,
        currentTurn: turn,
      },
      { headers: privateHeaders }
    );
  } catch (error) {
    return handleRouteError(error);
  }
}

/** Publish or withdraw a bounded advertisement; neither action creates a contract. */
export async function POST(request: Request, context: Context) {
  try {
    const a = await access(context);
    if (!a.ok) return a.response;
    const guard = await requireCorporationActionsEnabled(a.db);
    if (guard) return guard;
    const limit = checkRateLimit(`supply-listings:${a.userId}`, 20, 60000);
    if (!limit.ok) return rateLimitResponse(limit.retryAfter);
    const parsed = await parseJsonBody(request, supplyListingActionSchema);
    if (!parsed.success)
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    const body = parsed.data;
    const id = `${a.corp._id}:${body.slot}`;
    const collection = a.db.collection<SupplyListing>("supplyListings");
    if (body.action === "withdraw") {
      await collection.deleteOne({ _id: id, corporationId: a.corp._id });
      return NextResponse.json({ success: true }, { headers: privateHeaders });
    }
    const stateId = supplyAgreementRequiresState(body.commodity) ? body.stateId : undefined;
    if (
      stateId &&
      !(await a.db
        .collection<State>("states")
        .findOne({ _id: stateId }, { projection: { _id: 1 } }))
    )
      return NextResponse.json({ error: "Unknown fulfillment state" }, { status: 400 });
    const turn = await getCurrentTurn(a.db);
    const row: SupplyListing = {
      _id: id,
      corporationId: a.corp._id,
      publishedByUserId: a.userId,
      slot: body.slot,
      side: body.side,
      commodity: body.commodity,
      ...(stateId ? { stateId } : {}),
      volumeCap: body.volumeCap,
      pricePremium: body.pricePremium,
      ...(body.durationTurns != null ? { durationTurns: body.durationTurns } : {}),
      expiresAtTurn: turn + body.validForTurns,
      updatedAt: new Date(),
    };
    try {
      await collection.replaceOne(
        { _id: id, corporationId: a.corp._id, expiresAtTurn: { $lte: turn } },
        row,
        { upsert: true }
      );
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === 11000) {
        return NextResponse.json(
          { error: "This offer slot is already occupied. Refresh the board before publishing." },
          { status: 409 }
        );
      }
      throw error;
    }
    return NextResponse.json({ success: true }, { headers: privateHeaders });
  } catch (error) {
    return handleRouteError(error);
  }
}
