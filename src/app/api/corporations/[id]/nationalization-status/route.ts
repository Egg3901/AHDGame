// GET /api/corporations/[id]/nationalization-status
// Status card data for a private corp page: pending taking countdown + ownership
// flags (spun-out / golden share / open auction). Public read.
// Errors: 404 (corp not found)
import { NextResponse } from "next/server";
import { getAuthUserWithCharacter } from "@/lib/auth";
import { isForexEnabled } from "@/lib/currency/featureFlag";
import { withNoStore } from "@/lib/api/withNoStore";
import type { NationalizationAuction, Corporation } from "@/lib/db/types";
import { getDb } from "@/lib/mongodb";
import { resolveCorporation } from "@/lib/api/corporations/resolveQuery";
import { handleRouteError } from "@/lib/api/errors";
import { getCurrentTurn } from "@/lib/turn/currentTurn";
import { buildCorpNationalizationStatus } from "@/lib/nationalization/corpNationalizationStatus";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export const GET = withNoStore(async function GET(_request: Request, { params }: RouteParams) {
  try {
    const { id } = await params;
    const db = await getDb();
    const resolved = await resolveCorporation(db, id);
    if (!resolved.ok) return resolved.response;
    const currentTurn = await getCurrentTurn(db);
    const status = await buildCorpNationalizationStatus(db, resolved.corporation, currentTurn);
    const auth = status.hasStatus ? await getAuthUserWithCharacter() : null;
    const actor = auth?.hasCharacter ? auth.character : undefined;
    const corporation = resolved.corporation;
    let hasExposure = !!auth && corporation.userId?.toString() === auth.userId;
    if (actor && !hasExposure) {
      hasExposure =
        corporation.shareholders?.some(
          (holder) => holder.characterId?.equals(actor._id) && holder.shares > 0
        ) === true;
      const heldByCorps =
        corporation.shareholders
          ?.filter((holder) => holder.corporationId && holder.shares > 0)
          .map((holder) => holder.corporationId!) ?? [];
      if (!hasExposure && heldByCorps.length > 0) {
        hasExposure = !!(await db.collection<Corporation>("corporations").findOne(
          {
            _id: { $in: heldByCorps },
            ceoId: actor._id,
            ceoVacant: { $ne: true },
          },
          { projection: { _id: 1 } }
        ));
      }
    }
    let canBid = false;
    if (status.auction) {
      const auction = actor
        ? await db
            .collection<NationalizationAuction>("nationalizationAuctions")
            .findOne({ corporationId: resolved.corporation._id, status: "open" })
        : null;
      if (
        actor &&
        auction &&
        actor.countryId === auction.countryId &&
        currentTurn <= auction.closesAtTurn
      ) {
        const highest = auction.bids.reduce((value, bid) => Math.max(value, bid.amount), 0);
        const minimumBid = Math.max(auction.reservePrice, highest + 1);
        const priorPersonal = auction.bids
          .filter((bid) => bid.characterId?.equals(actor._id))
          .reduce((value, bid) => value + bid.amount, 0);
        const personalBalance = (await isForexEnabled())
          ? (actor.currencyBalances?.personal?.[auction.reserveCurrency] ?? 0)
          : (actor.cashOnHand ?? 0);
        canBid = personalBalance >= Math.max(1, minimumBid - priorPersonal);
        if (!canBid) {
          const corporations = await db
            .collection<Corporation>("corporations")
            .find({ ceoId: actor._id, ceoVacant: { $ne: true } })
            .project<Pick<Corporation, "_id" | "liquidCapital" | "liquidCurrencyCode">>({
              _id: 1,
              liquidCapital: 1,
              liquidCurrencyCode: 1,
            })
            .toArray();
          canBid = corporations.some((corp) => {
            const prior = auction.bids
              .filter((bid) => bid.corporationId?.equals(corp._id))
              .reduce((value, bid) => value + bid.amount, 0);
            return (
              (corp.liquidCurrencyCode ?? "USD") === auction.reserveCurrency &&
              corp.liquidCapital >= Math.max(1, minimumBid - prior)
            );
          });
        }
      }
    }
    return NextResponse.json({ ...status, canBid, hasExposure });
  } catch (error) {
    return handleRouteError(error);
  }
});
