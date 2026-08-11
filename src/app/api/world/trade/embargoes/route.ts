import { NextResponse } from "next/server";
import { z } from "zod";
import { ObjectId, type Filter } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { requireTradeMinister } from "@/lib/api/requireTradeMinister";
import { handleRouteError, badRequest, notFound } from "@/lib/api/errors";
import { parseJsonBody } from "@/lib/api/validate";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { ZOD_COUNTRY_ENUM, type CountryId } from "@/lib/constants/countries";
import { COMMODITY_TYPES } from "@/lib/constants/commodities";
import { getCurrentTurn } from "@/lib/turn/currentTurn";
import type { TradeEmbargo } from "@/lib/db/types/tradeEmbargo";
import type { Bill } from "@/lib/db/types";
import { NATIONAL_TERMINAL_STATUSES } from "@/lib/congress/billProposalLimits";
import { imposeEmbargo, liftEmbargo } from "@/lib/trade/commands/embargoCommands";
import { resolveLegislatedEmbargoes } from "@/lib/trade/reconcileEmbargoes";
import { getCabinetMembersCollection } from "@/lib/db/collections/cabinetMembers";
import { TRADE_MINISTER_POSITION_BY_COUNTRY } from "@/lib/constants/internationalOrganizations";
import { TRADE_EMBARGO_MAX_DURATION_TURNS } from "@/lib/trade/constants";

const imposeSchema = z.object({
  sourceCountry: z.enum(ZOD_COUNTRY_ENUM),
  targetCountry: z.enum(ZOD_COUNTRY_ENUM),
  commodity: z.union([z.enum(COMMODITY_TYPES), z.literal("all")]),
  direction: z.enum(["export", "import", "both"]),
  mode: z.enum(["block", "cap"]),
  cap: z.number().min(0).optional(),
  durationTurns: z.number().int().min(1).max(TRADE_EMBARGO_MAX_DURATION_TURNS),
});

// POST /api/world/trade/embargoes - Impose a temporary trade embargo.
// Auth: requireAuthWithCharacter + requireTradeMinister(sourceCountry)
// Errors: 400, 401, 403, 429
export async function POST(request: Request) {
  try {
    const auth = await requireAuthWithCharacter();
    if (!auth.ok) return auth.response;

    const rl = checkRateLimit(`embargo:${auth.user.character._id.toString()}`, 10, 60_000);
    if (!rl.ok) return rateLimitResponse(rl.retryAfter);

    const parsed = await parseJsonBody(request, imposeSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    const input = parsed.data;

    const db = await getDb();
    const isAdmin = auth.user.isAdmin === true;
    const sourceCountry = input.sourceCountry as CountryId;

    const minister = await requireTradeMinister(
      sourceCountry,
      auth.user.character._id,
      auth.user.character.name,
      db,
      isAdmin
    );
    if (!minister.ok) return minister.response;

    // Charge one cabinet action when a seated trade minister acts (not for an
    // admin override or a head-of-government fallback on a vacant seat — neither
    // draws on a ministerial action pool). Refunded if the embargo is rejected.
    const seatPositionId = TRADE_MINISTER_POSITION_BY_COUNTRY[sourceCountry];
    const charging = seatPositionId != null && minister.auth.positionId === seatPositionId;
    const membersCol = getCabinetMembersCollection(db);
    let chargedMemberId: ObjectId | null = null;
    if (charging) {
      const member = await membersCol.findOne({
        countryId: sourceCountry,
        positionId: seatPositionId,
      });
      // Backfill legacy members missing the action pool so the atomic spend matches.
      if (member && member.ministerialActions == null) {
        await membersCol.updateOne({ _id: member._id }, { $set: { ministerialActions: 2 } });
        member.ministerialActions = 2;
      }
      if ((member?.ministerialActions ?? 0) < 1) {
        throw badRequest("No cabinet actions remaining to impose an embargo this turn.");
      }
      const spend = await membersCol.updateOne(
        { _id: member!._id, ministerialActions: { $gte: 1 } },
        { $inc: { ministerialActions: -1 } }
      );
      if (spend.modifiedCount === 0) {
        throw badRequest("No cabinet actions remaining to impose an embargo this turn.");
      }
      chargedMemberId = member!._id;
    }

    const currentTurn = await getCurrentTurn(db);
    try {
      const result = await imposeEmbargo(db, {
        sourceCountry,
        targetCountry: input.targetCountry as CountryId,
        commodity: input.commodity,
        direction: input.direction,
        mode: input.mode,
        cap: input.cap,
        durationTurns: input.durationTurns,
        currentTurn,
        createdBy: auth.user.character._id,
      });
      if (!result.ok) throw badRequest(result.error);
      return NextResponse.json({ success: true, embargoId: result.embargoId.toString() });
    } catch (err) {
      // Refund the cabinet action — the embargo was rejected or failed to enact.
      if (chargedMemberId) {
        await membersCol.updateOne({ _id: chargedMemberId }, { $inc: { ministerialActions: 1 } });
      }
      throw err;
    }
  } catch (error) {
    return handleRouteError(error);
  }
}

// GET /api/world/trade/embargoes?country=XX - List active embargoes (and pending
// embargo bills) touching a country, or all if no country. Public.
// Auth: none
// Errors: 400, 500
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const country = url.searchParams.get("country");
    const db = await getDb();
    const currentTurn = await getCurrentTurn(db);

    // This GET is public — it must not mutate state. Minister (temporary)
    // embargoes are read straight from the store; legislated (durable) embargoes
    // are derived read-only from signed bills via the same pure resolver the turn
    // uses to materialize them. (The turn's reconcile is what writes the
    // legislation rows the clearing engine enforces; this endpoint never writes.)
    const activeOr = [{ expiresTurn: { $exists: false } }, { expiresTurn: { $gte: currentTurn } }];
    const ministerFilter = {
      origin: "minister",
      $and: [
        { $or: activeOr },
        ...(country ? [{ $or: [{ sourceCountry: country }, { targetCountry: country }] }] : []),
      ],
    } as Filter<TradeEmbargo>;
    const ministerRows = await db
      .collection<TradeEmbargo>("tradeEmbargoes")
      .find(ministerFilter)
      .toArray();

    const signedEmbargoBills = await db
      .collection<Bill>("bills")
      .find(
        {
          status: "signed",
          provisions: { $elemMatch: { type: { $in: ["embargo", "end_embargo"] } } },
        },
        { projection: { _id: 1, countryId: 1, sponsorId: 1, provisions: 1 } }
      )
      .toArray();
    const legislated = resolveLegislatedEmbargoes(signedEmbargoBills, currentTurn).filter(
      (e) => !country || e.sourceCountry === country || e.targetCountry === country
    );

    const items = [
      ...ministerRows.map((e) => ({
        id: e._id.toString(),
        sourceCountry: e.sourceCountry,
        targetCountry: e.targetCountry,
        commodity: e.commodity,
        direction: e.direction,
        mode: e.mode,
        cap: e.cap ?? null,
        origin: e.origin,
        expiresTurn: e.expiresTurn ?? null,
      })),
      ...legislated.map((e) => ({
        id: `leg:${e.sourceBillId?.toString() ?? "?"}:${e.targetCountry}:${e.commodity}:${e.direction}`,
        sourceCountry: e.sourceCountry,
        targetCountry: e.targetCountry,
        commodity: e.commodity,
        direction: e.direction,
        mode: e.mode,
        cap: e.cap ?? null,
        origin: e.origin,
        expiresTurn: null as number | null,
      })),
    ];

    // In-flight embargo legislation: bills carrying an embargo/end_embargo
    // provision that haven't been enacted (or rejected) yet. Once signed they
    // terminalize and reappear above as active embargoes (resolved read-only).
    const pendingBills = await db
      .collection<Bill>("bills")
      .find(
        {
          status: { $nin: NATIONAL_TERMINAL_STATUSES },
          provisions: { $elemMatch: { type: { $in: ["embargo", "end_embargo"] } } },
        },
        { projection: { _id: 1, title: 1, status: 1, countryId: 1, provisions: 1 } }
      )
      .toArray();

    const pending: Array<{
      billId: string;
      billTitle: string;
      status: string;
      action: "embargo" | "end_embargo";
      sourceCountry: CountryId;
      targetCountry: CountryId;
      commodity: string;
      direction: "export" | "import" | "both";
      mode: "block" | "cap" | null;
      cap: number | null;
    }> = [];
    for (const bill of pendingBills) {
      const source = bill.countryId;
      if (!source) continue;
      for (const p of bill.provisions ?? []) {
        if (p.type !== "embargo" && p.type !== "end_embargo") continue;
        // Country filter: include if this country imposes it OR is the target.
        if (country && source !== country && p.targetCountry !== country) continue;
        pending.push({
          billId: bill._id.toString(),
          billTitle: bill.title,
          status: bill.status,
          action: p.type,
          sourceCountry: source,
          targetCountry: p.targetCountry,
          commodity: p.commodity,
          direction: p.direction,
          mode: p.type === "embargo" ? p.mode : null,
          cap: p.type === "embargo" ? (p.cap ?? null) : null,
        });
      }
    }

    return NextResponse.json({ items, pending });
  } catch (error) {
    return handleRouteError(error);
  }
}

// DELETE /api/world/trade/embargoes?id=... - Lift a temporary embargo.
// Auth: requireAuthWithCharacter + requireTradeMinister(embargo.sourceCountry)
// Errors: 400, 401, 403, 404
export async function DELETE(request: Request) {
  try {
    const auth = await requireAuthWithCharacter();
    if (!auth.ok) return auth.response;

    const url = new URL(request.url);
    const id = url.searchParams.get("id");
    if (!id || !ObjectId.isValid(id)) throw badRequest("Invalid embargo id");

    const db = await getDb();
    const embargo = await db
      .collection<TradeEmbargo>("tradeEmbargoes")
      .findOne({ _id: new ObjectId(id) });
    if (!embargo) throw notFound("Embargo not found");

    const minister = await requireTradeMinister(
      embargo.sourceCountry,
      auth.user.character._id,
      auth.user.character.name,
      db,
      auth.user.isAdmin === true
    );
    if (!minister.ok) return minister.response;

    const result = await liftEmbargo(db, new ObjectId(id), embargo.sourceCountry);
    if (!result.ok) throw badRequest(result.error);

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleRouteError(error);
  }
}
