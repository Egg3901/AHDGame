import { ObjectId, type Db, type UpdateFilter } from "mongodb";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { parseJsonBody } from "@/lib/api/validate";
import {
  supplyAgreementProposalSchema,
  supplyAgreementUpdateSchema,
} from "@/lib/api/schemas/supplyAgreements";
import { handleRouteError } from "@/lib/api/errors";
import { resolveCorporation, requireCeo } from "@/lib/api/corporations/resolveQuery";
import { createNotification } from "@/lib/notifications";
import type { Corporation, CorporateSector } from "@/lib/db/types";
import type { GameState } from "@/lib/db/types/gameState";
import type { GameConfig } from "@/lib/db/types/gameConfig";
import {
  isAgreementPremiumLegal,
  SUPPLY_AGREEMENT_PRICE_BAND,
  CONTRACT_OVERCOMMIT_TOLERANCE,
  CONTRACT_CANCEL_NOTICE_TURNS,
  type SupplyAgreementOffer,
  type SupplyAgreement,
} from "@/lib/db/types/supplyAgreement";
import { COMMODITY_TYPES, type CommodityType } from "@/lib/constants/commodities";
import { getMarketSystemModeForDb, marketAtLeast } from "@/lib/market/featureFlag";
import { recordAudit } from "@/lib/audit/recordAudit";
import { computeSupplierCommodityCapacityUnits } from "@/lib/corporations/supplyAgreementCapacity";
import {
  isStateScopedCommodity,
  supplyAgreementRequiresState,
} from "@/lib/market/commodityMarketScope";
import type { State } from "@/lib/db/types/state";

/**
 * Private supply agreement lifecycle (bilateral, both-consent). Either CEO can
 * open a negotiation, the receiving CEO can counter or accept, and either side
 * may cancel. Offers are retained as an embedded revision history.
 */

type AgreementTerms = Pick<
  SupplyAgreement,
  "commodity" | "stateId" | "volumeCap" | "pricePremium" | "exclusive" | "durationTurns"
>;

function makeOffer(args: {
  revision: number;
  proposedByCorpId: ObjectId;
  terms: Omit<AgreementTerms, "commodity" | "stateId">;
  proposedAt: Date;
  proposedAtTurn?: number;
}): SupplyAgreementOffer {
  return {
    revision: args.revision,
    proposedByCorpId: args.proposedByCorpId,
    volumeCap: args.terms.volumeCap,
    pricePremium: args.terms.pricePremium,
    exclusive: args.terms.exclusive,
    ...(args.terms.durationTurns !== undefined ? { durationTurns: args.terms.durationTurns } : {}),
    ...(args.proposedAtTurn !== undefined ? { proposedAtTurn: args.proposedAtTurn } : {}),
    proposedAt: args.proposedAt,
  };
}

function latestOffer(agreement: SupplyAgreement): SupplyAgreementOffer {
  if (agreement.currentOffer) return agreement.currentOffer;
  const history = agreement.offers;
  const last = history?.[history.length - 1];
  if (last) return last;
  return {
    revision: 1,
    proposedByCorpId: agreement.proposedByCorpId,
    volumeCap: agreement.volumeCap,
    pricePremium: agreement.pricePremium,
    exclusive: agreement.exclusive,
    ...(agreement.durationTurns !== undefined ? { durationTurns: agreement.durationTurns } : {}),
    proposedAt: agreement.createdAt,
  };
}

async function validateCapacity(
  db: Db,
  supplier: Corporation,
  terms: Pick<AgreementTerms, "commodity" | "stateId" | "volumeCap">
): Promise<{ volumeCapValidated: boolean; currentTurn: number; currentYear?: number }> {
  const world = await db
    .collection<GameState>("gameState")
    .findOne({ _id: "current" }, { projection: { currentTurn: 1, currentYear: 1 } });
  const currentTurn = world?.currentTurn ?? 0;
  if (!marketAtLeast(await getMarketSystemModeForDb(db), "plants")) {
    return { volumeCapValidated: false, currentTurn, currentYear: world?.currentYear };
  }

  const [sectors, config] = await Promise.all([
    db
      .collection<CorporateSector>("corporateSectors")
      .find(
        { corporationId: supplier._id },
        {
          projection: {
            sectorType: 1,
            capitalStock: 1,
            strategyId: 1,
            transitionFromStrategyId: 1,
            retoolRescaleApplied: 1,
            transitionStartTurn: 1,
            mothballed: 1,
            activeCapacityPercent: 1,
            productionPolicyLevel: 1,
            embargoSuspended: 1,
            embargoExportExposure: 1,
            countryId: 1,
            stateId: 1,
          },
        }
      )
      .toArray(),
    db
      .collection<GameConfig>("gameConfig")
      .findOne({ _id: "default" }, { projection: { commandEconomyEnabled: 1 } }),
  ]);
  const capacityUnits = computeSupplierCommodityCapacityUnits({
    sectors,
    commodity: terms.commodity,
    isNatcorp: !!supplier.countryOwnerId,
    turn: currentTurn,
    currentYear: world?.currentYear,
    commandEconomyEnabled: config?.commandEconomyEnabled === true,
    stateId: terms.stateId,
  });
  const maxCap = capacityUnits * CONTRACT_OVERCOMMIT_TOLERANCE;
  if (!(maxCap > 0)) {
    throw new SupplyAgreementCommandError(
      terms.stateId
        ? `Your corporation has no plant capacity producing ${terms.commodity} in ${terms.stateId}`
        : `Your corporation has no plant capacity producing ${terms.commodity}`
    );
  }
  if (terms.volumeCap > maxCap) {
    throw new SupplyAgreementCommandError(
      `volumeCap exceeds what your plants can make. Usable output for ${terms.commodity} at your current production policy is about ${Math.round(capacityUnits)} units per turn, so the most you can contract is ${Math.round(maxCap)}.`
    );
  }
  return { volumeCapValidated: true, currentTurn, currentYear: world?.currentYear };
}

class SupplyAgreementCommandError extends Error {}

function responseForCommandError(error: SupplyAgreementCommandError): NextResponse {
  return NextResponse.json({ error: error.message }, { status: 400 });
}

async function notifyOfferRecipient(args: {
  recipient: Corporation;
  proposer: Corporation;
  agreementId: ObjectId;
  commodity: CommodityType;
  revision: number;
  action: "proposed" | "countered";
}): Promise<void> {
  if (!args.recipient.userId) return;
  await createNotification({
    userId: args.recipient.userId,
    type: "corp_supply_agreement_offer",
    title: `Supply agreement ${args.action}`,
    message: `${args.proposer.name ?? "A corporation"} has ${args.action} a ${args.commodity} supply agreement. Review the offer in the Commodities tab.`,
    metadata: {
      corporationId: args.recipient._id.toString(),
      agreementId: args.agreementId.toString(),
      offerRevision: args.revision,
    },
  });
}

/** POST /api/corporations/[id]/supply-agreements: open a negotiation. */
export async function proposeSupplyAgreement(request: Request, initiatingCorpId: string) {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;
    const parsed = await parseJsonBody(request, supplyAgreementProposalSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    const db = await getDb();

    const resolved = await resolveCorporation(db, initiatingCorpId);
    if (!resolved.ok) return resolved.response;
    const initiator = resolved.corporation;
    const ceoCheck = requireCeo(initiator, auth.user.userId);
    if (ceoCheck) return ceoCheck;

    const body = parsed.data;
    const isSupplierInitiated = !!body.buyerCorpId;
    const counterpartyId = new ObjectId(
      isSupplierInitiated ? body.buyerCorpId! : body.supplierCorpId!
    );
    if (counterpartyId.equals(initiator._id)) {
      return NextResponse.json(
        { error: "A corporation cannot contract with itself" },
        { status: 400 }
      );
    }
    if (!(COMMODITY_TYPES as readonly string[]).includes(body.commodity)) {
      return NextResponse.json({ error: "Valid commodity required" }, { status: 400 });
    }
    // A state-scoped commodity (freight) is haulage capacity based in one
    // state and clears in that state's book, so its contract names the state
    // it is fulfilled from. Everything else is corporation-wide and ignores
    // any state the client sends.
    const commodity = body.commodity as CommodityType;
    let stateId: string | undefined;
    if (supplyAgreementRequiresState(commodity)) {
      if (!body.stateId) {
        return NextResponse.json(
          {
            error:
              "Freight capacity is sold in the state where it is based. Name the state this contract is fulfilled from.",
          },
          { status: 400 }
        );
      }
      stateId = body.stateId;
      const state = await db
        .collection<State>("states")
        .findOne({ _id: stateId }, { projection: { _id: 1 } });
      if (!state) {
        return NextResponse.json({ error: "Unknown state" }, { status: 400 });
      }
    }
    const volumeCap = body.volumeCap;
    const pricePremium = body.pricePremium;
    if (!isAgreementPremiumLegal(pricePremium)) {
      return NextResponse.json(
        {
          error: `Contract price must be within ±${Math.round(
            SUPPLY_AGREEMENT_PRICE_BAND * 100
          )}% of market`,
        },
        { status: 400 }
      );
    }

    const counterparty = await db
      .collection<Corporation>("corporations")
      .findOne({ _id: counterpartyId });
    if (!counterparty) {
      return NextResponse.json(
        {
          error: isSupplierInitiated
            ? "Buyer corporation not found"
            : "Supplier corporation not found",
        },
        { status: 404 }
      );
    }
    const supplier = isSupplierInitiated ? initiator : counterparty;
    const buyer = isSupplierInitiated ? counterparty : initiator;

    let volumeCapValidated = false;
    let currentTurn = 0;
    try {
      const capacity = await validateCapacity(db, supplier, {
        commodity,
        stateId,
        volumeCap,
      });
      volumeCapValidated = capacity.volumeCapValidated;
      currentTurn = capacity.currentTurn;
    } catch (error) {
      if (error instanceof SupplyAgreementCommandError) return responseForCommandError(error);
      throw error;
    }

    const now = new Date();
    const openingOffer = makeOffer({
      revision: 1,
      proposedByCorpId: initiator._id,
      terms: {
        volumeCap,
        pricePremium,
        exclusive: body.exclusive,
        ...(body.durationTurns !== undefined ? { durationTurns: body.durationTurns } : {}),
      },
      proposedAt: now,
      proposedAtTurn: currentTurn,
    });
    // GRANDFATHER STAMP. `volumeCap` only has a defined physical basis when the
    // block above actually ran — that is, when the world was already at plants
    // and the cap was checked against scaled capacity. Contracts signed in
    // earlier modes were checked against nothing at all, so at the plants flip
    // they would start assessing CONTRACT_SHORTFALL_PENALTY every turn on a
    // number no plant was ever sized to meet, with no player action behind it
    // and no way to renegotiate before the damage lands. The settlement pass
    // reads this stamp and assesses shortfall damages only on contracts that
    // carry it; a legacy contract still settles its price premium normally and
    // becomes damage-eligible as soon as the parties re-sign it.
    //
    // The field is written and read only by this pair of call sites, so it is
    // declared inline rather than widening the shared SupplyAgreement shape.
    const doc: SupplyAgreement = {
      ...(volumeCapValidated ? { volumeCapBasis: "scaledCapacity" as const } : {}),
      supplierCorpId: supplier._id,
      buyerCorpId: buyer._id,
      commodity,
      ...(stateId ? { stateId } : {}),
      volumeCap,
      pricePremium,
      exclusive: body.exclusive,
      ...(body.durationTurns !== undefined ? { durationTurns: body.durationTurns } : {}),
      status: "pending",
      proposedByCorpId: initiator._id,
      currentOffer: openingOffer,
      offers: [openingOffer],
      createdAt: now,
      updatedAt: now,
    };
    const res = await db.collection<SupplyAgreement>("supplyAgreements").insertOne(doc);

    recordAudit({
      source: "api",
      action: "commodity.trade",
      category: "market",
      subject: { type: "supplyAgreement", id: res.insertedId, name: doc.commodity },
      counterparty: { type: "corporation", id: counterparty._id },
      refs: { corporationId: initiator._id },
      delta: [
        { field: "status", before: null, after: "pending" },
        { field: "commodity", before: null, after: doc.commodity },
        ...(stateId ? [{ field: "stateId", before: null, after: stateId }] : []),
        { field: "volumeCap", before: null, after: volumeCap },
        { field: "pricePremium", before: null, after: pricePremium },
      ],
      outcome: "ok",
    });

    await notifyOfferRecipient({
      recipient: counterparty,
      proposer: initiator,
      agreementId: res.insertedId,
      commodity,
      revision: openingOffer.revision,
      action: "proposed",
    });

    return NextResponse.json({ success: true, agreementId: res.insertedId.toString() });
  } catch (error) {
    return handleRouteError(error);
  }
}

/**
 * PATCH /api/corporations/[id]/supply-agreements/[agreementId]: accept,
 * counter, or cancel. Only the CEO receiving the current offer can accept or
 * counter; either party can cancel.
 */
export async function updateSupplyAgreement(request: Request, corpId: string, agreementId: string) {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;
    const parsed = await parseJsonBody(request, supplyAgreementUpdateSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    const db = await getDb();
    if (!ObjectId.isValid(agreementId)) {
      return NextResponse.json({ error: "Invalid agreement id" }, { status: 400 });
    }

    const resolved = await resolveCorporation(db, corpId);
    if (!resolved.ok) return resolved.response;
    const corp = resolved.corporation;
    const ceoCheck = requireCeo(corp, auth.user.userId);
    if (ceoCheck) return ceoCheck;

    const agreement = await db
      .collection<SupplyAgreement>("supplyAgreements")
      .findOne({ _id: new ObjectId(agreementId) });
    if (!agreement) {
      return NextResponse.json({ error: "Agreement not found" }, { status: 404 });
    }

    const body = parsed.data;
    const isSupplier = agreement.supplierCorpId.equals(corp._id);
    const isBuyer = agreement.buyerCorpId.equals(corp._id);
    if (!isSupplier && !isBuyer) {
      return NextResponse.json({ error: "Not a party to this agreement" }, { status: 403 });
    }

    const currentOffer = latestOffer(agreement);
    const currentOfferAuthor = currentOffer.proposedByCorpId;

    if (body.action === "accept") {
      if (currentOfferAuthor.equals(corp._id)) {
        return NextResponse.json({ error: "Only the counterparty can accept" }, { status: 403 });
      }
      if (agreement.status !== "pending") {
        return NextResponse.json({ error: "Agreement is not pending" }, { status: 400 });
      }
      if (isStateScopedCommodity(agreement.commodity) && !agreement.stateId) {
        return NextResponse.json(
          {
            error:
              "This legacy freight proposal cannot be accepted because freight now sells in a state-local market. Ask the supplier to propose it again naming the state.",
          },
          { status: 409 }
        );
      }
      const gameState = await db
        .collection<GameState>("gameState")
        .findOne({ _id: "current" }, { projection: { currentTurn: 1 } });
      const currentTurn = gameState?.currentTurn ?? 0;
      const durationTurns = currentOffer.durationTurns ?? agreement.durationTurns;
      const now = new Date();
      const acceptedTerms = {
        volumeCap: currentOffer.volumeCap,
        pricePremium: currentOffer.pricePremium,
        exclusive: currentOffer.exclusive,
        ...(durationTurns !== undefined ? { durationTurns } : {}),
      };
      const accepted = await db.collection<SupplyAgreement>("supplyAgreements").updateOne(
        { _id: agreement._id, status: "pending", proposedByCorpId: currentOfferAuthor },
        {
          $set: {
            ...acceptedTerms,
            status: "active",
            startsAtTurn: currentTurn,
            ...(durationTurns !== undefined ? { expiresAtTurn: currentTurn + durationTurns } : {}),
            updatedAt: now,
          },
          ...(durationTurns === undefined ? { $unset: { expiresAtTurn: "" } } : {}),
        }
      );
      if (accepted.matchedCount === 0) {
        return NextResponse.json({ error: "This offer is no longer current" }, { status: 409 });
      }
      recordAudit({
        source: "api",
        action: "commodity.trade",
        category: "market",
        subject: { type: "supplyAgreement", id: agreement._id, name: agreement.commodity },
        counterparty: { type: "corporation", id: agreement.supplierCorpId },
        refs: { corporationId: agreement.buyerCorpId },
        delta: [{ field: "status", before: "pending", after: "active" }],
        outcome: "ok",
      });
      return NextResponse.json({ success: true, status: "active" });
    }

    if (body.action === "counter") {
      if (agreement.status !== "pending") {
        return NextResponse.json(
          { error: "Only pending agreements can be countered" },
          { status: 400 }
        );
      }
      if (currentOfferAuthor.equals(corp._id)) {
        return NextResponse.json(
          { error: "Only the counterparty can make the next offer" },
          { status: 403 }
        );
      }
      if (isStateScopedCommodity(agreement.commodity) && !agreement.stateId) {
        return NextResponse.json(
          {
            error:
              "This legacy freight proposal cannot be countered because freight now sells in a state-local market. Ask the supplier to propose it again naming the state.",
          },
          { status: 409 }
        );
      }
      if (!isAgreementPremiumLegal(body.pricePremium)) {
        return NextResponse.json(
          {
            error: `Contract price must be within ±${Math.round(
              SUPPLY_AGREEMENT_PRICE_BAND * 100
            )}% of market`,
          },
          { status: 400 }
        );
      }

      const supplier = isSupplier
        ? corp
        : await db
            .collection<Corporation>("corporations")
            .findOne({ _id: agreement.supplierCorpId });
      if (!supplier) {
        return NextResponse.json({ error: "Supplier corporation not found" }, { status: 404 });
      }
      let capacity: { volumeCapValidated: boolean; currentTurn: number };
      try {
        capacity = await validateCapacity(db, supplier, {
          commodity: agreement.commodity,
          stateId: agreement.stateId,
          volumeCap: body.volumeCap,
        });
      } catch (error) {
        if (error instanceof SupplyAgreementCommandError) return responseForCommandError(error);
        throw error;
      }

      const now = new Date();
      const revision = currentOffer.revision + 1;
      const offer = makeOffer({
        revision,
        proposedByCorpId: corp._id,
        terms: {
          volumeCap: body.volumeCap,
          pricePremium: body.pricePremium,
          exclusive: body.exclusive,
          ...(body.durationTurns !== undefined ? { durationTurns: body.durationTurns } : {}),
        },
        proposedAt: now,
        proposedAtTurn: capacity.currentTurn,
      });
      const update: UpdateFilter<SupplyAgreement> = {
        $set: {
          volumeCap: body.volumeCap,
          pricePremium: body.pricePremium,
          exclusive: body.exclusive,
          proposedByCorpId: corp._id,
          currentOffer: offer,
          updatedAt: now,
          ...(body.durationTurns !== undefined ? { durationTurns: body.durationTurns } : {}),
          ...(capacity.volumeCapValidated ? { volumeCapBasis: "scaledCapacity" } : {}),
        },
        $push: { offers: offer },
        ...(body.durationTurns === undefined ? { $unset: { durationTurns: "" } } : {}),
      };
      const result = await db
        .collection<SupplyAgreement>("supplyAgreements")
        .updateOne(
          { _id: agreement._id, status: "pending", proposedByCorpId: currentOfferAuthor },
          update
        );
      if (result.matchedCount === 0) {
        return NextResponse.json({ error: "This offer is no longer current" }, { status: 409 });
      }

      recordAudit({
        source: "api",
        action: "commodity.trade",
        category: "market",
        subject: { type: "supplyAgreement", id: agreement._id, name: agreement.commodity },
        counterparty: {
          type: "corporation",
          id: isSupplier ? agreement.buyerCorpId : agreement.supplierCorpId,
        },
        refs: { corporationId: corp._id },
        delta: [
          { field: "offerRevision", before: currentOffer.revision, after: revision },
          { field: "volumeCap", before: agreement.volumeCap, after: body.volumeCap },
          { field: "pricePremium", before: agreement.pricePremium, after: body.pricePremium },
        ],
        outcome: "ok",
      });

      const counterpartyId = isSupplier ? agreement.buyerCorpId : agreement.supplierCorpId;
      const counterparty = await db
        .collection<Corporation>("corporations")
        .findOne({ _id: counterpartyId });
      if (counterparty) {
        await notifyOfferRecipient({
          recipient: counterparty,
          proposer: corp,
          agreementId: agreement._id!,
          commodity: agreement.commodity,
          revision,
          action: "countered",
        });
      }
      return NextResponse.json({ success: true, status: "pending", revision });
    }

    if (body.action === "cancel") {
      if (agreement.status === "cancelled") {
        return NextResponse.json({ error: "Agreement is already cancelled" }, { status: 400 });
      }
      if (agreement.status === "cancelling") {
        return NextResponse.json(
          {
            error: `Notice has already been served. This agreement ends on turn ${agreement.cancelEffectiveTurn ?? 0}.`,
          },
          { status: 400 }
        );
      }
      // C6 — a PENDING agreement was never accepted, so nothing is owed and it
      // is simply withdrawn. A LIVE one takes notice: it keeps delivering and
      // keeps settling (premium AND shortfall damages) for
      // CONTRACT_CANCEL_NOTICE_TURNS turns. Without that, cancellation was a
      // free option — the supplier can see its own production before settlement
      // runs, so it could cancel on exactly the turns it was going to be short
      // and the shortfall penalty only ever hit players who forgot to click.
      const gameState = await db
        .collection<GameState>("gameState")
        .findOne({ _id: "current" }, { projection: { currentTurn: 1 } });
      const currentTurn = gameState?.currentTurn ?? 0;
      const immediate = agreement.status === "pending";
      const nextStatus: SupplyAgreement["status"] = immediate ? "cancelled" : "cancelling";
      const cancelEffectiveTurn = currentTurn + CONTRACT_CANCEL_NOTICE_TURNS;
      await db.collection<SupplyAgreement>("supplyAgreements").updateOne(
        { _id: agreement._id, status: agreement.status },
        {
          $set: {
            status: nextStatus,
            ...(immediate ? {} : { cancelEffectiveTurn }),
            updatedAt: new Date(),
          },
        }
      );
      recordAudit({
        source: "api",
        action: "commodity.trade",
        category: "market",
        subject: { type: "supplyAgreement", id: agreement._id, name: agreement.commodity },
        counterparty: {
          type: "corporation",
          id: isSupplier ? agreement.buyerCorpId : agreement.supplierCorpId,
        },
        refs: { corporationId: corp._id },
        delta: [{ field: "status", before: agreement.status, after: nextStatus }],
        outcome: "ok",
      });
      return NextResponse.json({
        success: true,
        status: nextStatus,
        ...(immediate ? {} : { cancelEffectiveTurn, noticeTurns: CONTRACT_CANCEL_NOTICE_TURNS }),
        message: immediate
          ? "Proposal withdrawn."
          : `Notice served. This agreement keeps running and settling for ${CONTRACT_CANCEL_NOTICE_TURNS} more turns, then ends on turn ${cancelEffectiveTurn}.`,
      });
    }

    return NextResponse.json({ error: "Unknown action (accept|counter|cancel)" }, { status: 400 });
  } catch (error) {
    return handleRouteError(error);
  }
}
