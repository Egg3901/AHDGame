import { ObjectId } from "mongodb";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { parseJsonBody } from "@/lib/api/validate";
import { supplyListingTakeSchema } from "@/lib/api/schemas/supplyListings";
import { handleRouteError, errorResponse } from "@/lib/api/errors";
import { resolveCorporation, requireCeo } from "@/lib/api/corporations/resolveQuery";
import { recordAudit } from "@/lib/audit/recordAudit";
import { getCurrentTurn } from "@/lib/turn/currentTurn";
import type { Corporation } from "@/lib/db/types";
import { isAgreementPremiumLegal, type SupplyAgreement } from "@/lib/db/types/supplyAgreement";
import type { SupplyListing } from "@/lib/db/types/supplyListing";
import { supplyAgreementRequiresState } from "@/lib/market/commodityMarketScope";
import {
  SupplyAgreementCommandError,
  makeOffer,
  responseForCommandError,
  validateCapacity,
} from "@/lib/corporations/commands/supplyAgreements";
import {
  checkSupplyContractParties,
  requireSupplyExchangeAccess,
} from "@/lib/corporations/supplyExchange/guards";
import { notifySupplyAgreementEvent } from "@/lib/corporations/supplyExchange/notifications";

/** Below this the remainder of a listing is rounding dust and the take consumes it whole. */
const LISTING_DUST_UNITS = 1e-6;

/**
 * POST /api/corporations/[id]/supply-listings/take: take a standing offer.
 *
 * A listing is the publisher's standing consent, so taking it creates an ACTIVE
 * agreement directly. The taker names a volume up to what is left; the listing
 * is decremented with a compare-and-set on the volume this request read, so two
 * takers racing for the same units cannot both win them.
 */
export async function takeSupplyListing(request: Request, takerCorpId: string) {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;
    const parsed = await parseJsonBody(request, supplyListingTakeSchema);
    if (!parsed.success) return errorResponse(parsed.status, parsed.error);
    const db = await getDb();

    const resolved = await resolveCorporation(db, takerCorpId);
    if (!resolved.ok) return resolved.response;
    const taker = resolved.corporation;
    const ceoCheck = requireCeo(taker, auth.user.userId);
    if (ceoCheck) return ceoCheck;
    const gate = await requireSupplyExchangeAccess(db, auth.user.userId);
    if (gate) return gate;

    const listings = db.collection<SupplyListing>("supplyListings");
    const turn = await getCurrentTurn(db);
    const listing = await listings.findOne({ _id: parsed.data.listingId });
    if (!listing || listing.expiresAtTurn <= turn) {
      return errorResponse(404, "This offer is no longer available");
    }
    if (listing.corporationId.equals(taker._id)) {
      return errorResponse(400, "A corporation cannot take its own offer");
    }
    if (parsed.data.volume > listing.volumeCap) {
      return errorResponse(
        409,
        `Only ${Math.floor(listing.volumeCap * 100) / 100} units are left on this offer`
      );
    }
    if (supplyAgreementRequiresState(listing.commodity) && !listing.stateId) {
      return errorResponse(409, "This offer names no fulfillment state and cannot be taken");
    }
    if (!isAgreementPremiumLegal(listing.pricePremium)) {
      return errorResponse(409, "This offer's price is outside the contract band");
    }

    const publisher = await db
      .collection<Corporation>("corporations")
      .findOne({ _id: listing.corporationId });
    // The same staleness rule the board applies when listing: the offer binds
    // only while the CEO who posted it still runs the corporation.
    if (
      !publisher ||
      publisher.ceoVacant ||
      publisher.userId?.toString() !== listing.publishedByUserId
    ) {
      return errorResponse(409, "This offer is no longer available");
    }

    const supplier = listing.side === "sell" ? publisher : taker;
    const buyer = listing.side === "sell" ? taker : publisher;
    const partiesError = await checkSupplyContractParties(db, {
      supplier,
      buyer,
      commodity: listing.commodity,
    });
    if (partiesError) return errorResponse(403, partiesError);

    const remaining = listing.volumeCap - parsed.data.volume;
    const consumesListing = remaining < LISTING_DUST_UNITS;
    const volume = consumesListing ? listing.volumeCap : parsed.data.volume;

    let capacity: Awaited<ReturnType<typeof validateCapacity>>;
    try {
      capacity = await validateCapacity(db, supplier, {
        commodity: listing.commodity,
        stateId: listing.stateId,
        volumeCap: volume,
      });
    } catch (error) {
      if (error instanceof SupplyAgreementCommandError) {
        // The raw message addresses the supplier as "your corporation"; a buyer
        // taking a sell offer should not read it as their own shortfall.
        const message = supplier._id.equals(taker._id)
          ? error.message
          : "The seller cannot cover this volume right now.";
        return responseForCommandError(new SupplyAgreementCommandError(message));
      }
      throw error;
    }

    // Claim the units first. The filter pins the volume this request read, so a
    // concurrent take or a republish makes this a miss rather than a double fill.
    const claimFilter = {
      _id: listing._id,
      volumeCap: listing.volumeCap,
      expiresAtTurn: { $gt: turn },
    };
    const claimed = consumesListing
      ? (await listings.deleteOne(claimFilter)).deletedCount === 1
      : (await listings.updateOne(claimFilter, { $set: { volumeCap: remaining } }))
          .modifiedCount === 1;
    if (!claimed) {
      return errorResponse(409, "This offer changed while you were taking it. Refresh the board.");
    }

    const now = new Date();
    const currentTurn = capacity.currentTurn;
    const offer = makeOffer({
      revision: 1,
      proposedByCorpId: publisher._id,
      terms: {
        volumeCap: volume,
        pricePremium: listing.pricePremium,
        exclusive: false,
        ...(listing.durationTurns != null ? { durationTurns: listing.durationTurns } : {}),
      },
      proposedAt: now,
      proposedAtTurn: currentTurn,
    });
    const agreement: SupplyAgreement = {
      _id: new ObjectId(),
      ...(capacity.volumeCapValidated ? { volumeCapBasis: "scaledCapacity" as const } : {}),
      supplierCorpId: supplier._id,
      buyerCorpId: buyer._id,
      commodity: listing.commodity,
      ...(listing.stateId ? { stateId: listing.stateId } : {}),
      volumeCap: volume,
      pricePremium: listing.pricePremium,
      exclusive: false,
      ...(listing.durationTurns != null ? { durationTurns: listing.durationTurns } : {}),
      listingId: listing._id,
      status: "active",
      startsAtTurn: currentTurn,
      ...(listing.durationTurns != null
        ? { expiresAtTurn: currentTurn + listing.durationTurns }
        : {}),
      proposedByCorpId: publisher._id,
      currentOffer: offer,
      offers: [offer],
      createdAt: now,
      updatedAt: now,
    };
    try {
      await db.collection<SupplyAgreement>("supplyAgreements").insertOne(agreement);
    } catch (error) {
      // Give the units back so a failed write does not eat the publisher's offer.
      try {
        if (consumesListing) await listings.insertOne(listing);
        else await listings.updateOne({ _id: listing._id }, { $inc: { volumeCap: volume } });
      } catch (restoreError) {
        console.error("[takeSupplyListing] could not restore listing volume:", restoreError);
      }
      throw error;
    }

    recordAudit({
      source: "api",
      action: "commodity.trade",
      category: "market",
      subject: { type: "supplyAgreement", id: agreement._id!, name: agreement.commodity },
      counterparty: { type: "corporation", id: publisher._id },
      refs: { corporationId: taker._id },
      delta: [
        { field: "status", before: null, after: "active" },
        { field: "listingId", before: null, after: listing._id },
        { field: "volumeCap", before: null, after: volume },
        { field: "pricePremium", before: null, after: listing.pricePremium },
      ],
      outcome: "ok",
    });

    const terms = `${Math.round(volume * 100) / 100} units per turn at ${listing.pricePremium >= 0 ? "+" : ""}${Math.round(listing.pricePremium * 1000) / 10}%.`;
    await notifySupplyAgreementEvent({
      recipient: publisher,
      actor: taker,
      agreementId: agreement._id!,
      commodity: listing.commodity,
      event: "taken",
      detail: terms,
    });
    await notifySupplyAgreementEvent({
      recipient: taker,
      actor: publisher,
      agreementId: agreement._id!,
      commodity: listing.commodity,
      event: "started",
      detail: terms,
    });

    return NextResponse.json({
      success: true,
      agreementId: agreement._id!.toString(),
      status: "active",
      remainingVolume: consumesListing ? 0 : remaining,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
