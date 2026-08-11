import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { requireCorporationActionsEnabled } from "@/lib/api/requireCorporationActions";
import { requireCorpDealsEnabled } from "@/lib/api/requireCorpDeals";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { handleRouteError } from "@/lib/api/errors";
import { parseJsonBody } from "@/lib/api/validate";
import {
  corporationQueryFromParamId,
  resolveCorporation,
  requireCeo,
} from "@/lib/api/corporations/resolveQuery";
import { getGameState } from "@/lib/gameState";
import { getGameStateCollection } from "@/lib/db/collections";
import type { Corporation } from "@/lib/db/types";
import type { AcquisitionOffer } from "@/lib/db/types/acquisitionOffer";
import {
  proposeAcquisitionOffer,
  acceptAcquisitionOffer,
  resolveAcquisitionOfferStatus,
  listDealsForCorp,
} from "@/lib/corporations/commands/acquisitions/acquisitionOffers";

interface RouteParams {
  params: Promise<{ id: string }>;
}

const dealsBodySchema = z.object({
  action: z.string().optional(),
  targetCorporationId: z.string().optional(),
  priceAnchor: z.number().optional(),
  offerId: z.string().optional(),
});

/** GET — pending incoming/outgoing acquisition offers for a corp the viewer runs. */
export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;
    const { id } = await params;
    const db = await getDb();

    const resolved = await resolveCorporation(db, id);
    if (!resolved.ok) return resolved.response;
    const ceoCheck = requireCeo(resolved.corporation, auth.user.userId);
    if (ceoCheck) return ceoCheck;

    const gs = await getGameStateCollection(db);
    const flagDoc = await gs.findOne({ _id: "current" }, { projection: { corpDealsEnabled: 1 } });
    const enabled = Boolean(flagDoc?.corpDealsEnabled);
    if (!enabled) return NextResponse.json({ enabled: false, incoming: [], outgoing: [] });

    const deals = await listDealsForCorp(db, resolved.corporation._id);
    return NextResponse.json({ enabled: true, ...deals });
  } catch (error) {
    return handleRouteError(error);
  }
}

/** POST — dispatch a deal action against a corp the viewer runs (`id` = their corp). */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;

    const rateLimit = checkRateLimit(`deals:${auth.user.userId}`, 10, 60_000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const { id } = await params;
    const db = await getDb();
    const corpGuard = await requireCorporationActionsEnabled(db);
    if (corpGuard) return corpGuard;
    const dealsGuard = await requireCorpDealsEnabled(db);
    if (dealsGuard) return dealsGuard;

    const resolved = await resolveCorporation(db, id);
    if (!resolved.ok) return resolved.response;
    const myCorp = resolved.corporation;
    const ceoCheck = requireCeo(myCorp, auth.user.userId);
    if (ceoCheck) return ceoCheck;

    const parsed = await parseJsonBody(request, dealsBodySchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    const body = parsed.data;
    const gameState = await getGameState();
    const currentTurn = gameState?.currentTurn ?? 0;

    if (body.action === "propose") {
      const targetQuery = corporationQueryFromParamId(body.targetCorporationId ?? "");
      if (!targetQuery)
        return NextResponse.json({ error: "Invalid target corporation" }, { status: 400 });
      const target = await db.collection<Corporation>("corporations").findOne(targetQuery);
      if (!target)
        return NextResponse.json({ error: "Target corporation not found" }, { status: 404 });

      const result = await proposeAcquisitionOffer(db, {
        acquirer: myCorp,
        target,
        priceAnchor: Number(body.priceAnchor),
        proposerCharacterId: myCorp.ceoId,
        proposerUserId: auth.user.userId ? new ObjectId(auth.user.userId) : undefined,
        currentTurn,
      });
      if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
      return NextResponse.json({ ok: true, offerId: result.offerId.toString() });
    }

    if (body.action === "accept" || body.action === "reject" || body.action === "withdraw") {
      if (!body.offerId || !ObjectId.isValid(body.offerId))
        return NextResponse.json({ error: "Invalid offer id" }, { status: 400 });
      const offer = await db
        .collection<AcquisitionOffer>("acquisitionOffers")
        .findOne({ _id: new ObjectId(body.offerId) });
      if (!offer) return NextResponse.json({ error: "Offer not found" }, { status: 404 });

      if (body.action === "withdraw") {
        if (!offer.acquirerCorporationId.equals(myCorp._id))
          return NextResponse.json(
            { error: "Only the offering corporation can withdraw" },
            { status: 403 }
          );
        const r = await resolveAcquisitionOfferStatus(db, offer, "withdrawn", currentTurn);
        return r.ok
          ? NextResponse.json({ ok: true })
          : NextResponse.json({ error: r.error }, { status: r.status });
      }

      // accept / reject must be done by the TARGET's CEO
      if (!offer.targetCorporationId.equals(myCorp._id))
        return NextResponse.json(
          { error: "Only the target corporation can respond" },
          { status: 403 }
        );

      if (body.action === "reject") {
        const r = await resolveAcquisitionOfferStatus(db, offer, "rejected", currentTurn);
        return r.ok
          ? NextResponse.json({ ok: true })
          : NextResponse.json({ error: r.error }, { status: r.status });
      }

      const r = await acceptAcquisitionOffer(db, { offer, currentTurn });
      if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
      return NextResponse.json({
        ok: true,
        acquired: true,
        sectorsMoved: r.sectorsMoved,
        acquirerName: r.acquirerName,
        targetName: r.targetName,
      });
    }

    return NextResponse.json({ error: "Unknown deal action" }, { status: 400 });
  } catch (error) {
    return handleRouteError(error);
  }
}
