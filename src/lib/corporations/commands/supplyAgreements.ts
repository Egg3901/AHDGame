import { ObjectId } from "mongodb";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { handleRouteError } from "@/lib/api/errors";
import { resolveCorporation, requireCeo } from "@/lib/api/corporations/resolveQuery";
import type { Corporation, CorporateSector } from "@/lib/db/types";
import type { GameState } from "@/lib/db/types/gameState";
import {
  isAgreementPremiumLegal,
  SUPPLY_AGREEMENT_PRICE_BAND,
  CONTRACT_OVERCOMMIT_TOLERANCE,
  CONTRACT_CANCEL_NOTICE_TURNS,
  type SupplyAgreement,
} from "@/lib/db/types/supplyAgreement";
import {
  COMMODITY_TYPES,
  COMMODITY_BASE_PRICES,
  commodityMixWeight,
  embargoSupplyFactorFor,
  plantsSupplyScaledUnits,
  type CommodityType,
} from "@/lib/constants/commodities";
import { getEffectiveStrategyRates } from "@/lib/constants/sectorStrategies";
import { getMarketSystemModeForDb, marketAtLeast } from "@/lib/market/featureFlag";
import { recordAudit } from "@/lib/audit/recordAudit";

/**
 * Private supply agreement lifecycle (bilateral, both-consent). The supplier's
 * CEO proposes; the buyer's CEO accepts; either side may cancel. Price is a
 * premium/discount vs market, bounded to ±35%. Gated by supplyAgreementsEnabled.
 */

/** POST /api/corporations/[id]/supply-agreements — propose (supplier CEO). */
export async function proposeSupplyAgreement(request: Request, supplierCorpId: string) {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;
    const db = await getDb();

    const resolved = await resolveCorporation(db, supplierCorpId);
    if (!resolved.ok) return resolved.response;
    const supplier = resolved.corporation;
    const ceoCheck = requireCeo(supplier, auth.user.userId);
    if (ceoCheck) return ceoCheck;

    const body = (await request.json().catch(() => ({}))) as {
      buyerCorpId?: string;
      commodity?: string;
      volumeCap?: number;
      pricePremium?: number;
      exclusive?: boolean;
    };

    if (!body.buyerCorpId || !ObjectId.isValid(body.buyerCorpId)) {
      return NextResponse.json({ error: "Valid buyerCorpId required" }, { status: 400 });
    }
    if (body.buyerCorpId === supplierCorpId) {
      return NextResponse.json(
        { error: "A corporation cannot contract with itself" },
        { status: 400 }
      );
    }
    if (!body.commodity || !(COMMODITY_TYPES as readonly string[]).includes(body.commodity)) {
      return NextResponse.json({ error: "Valid commodity required" }, { status: 400 });
    }
    const volumeCap = Number(body.volumeCap);
    if (!(volumeCap > 0)) {
      return NextResponse.json({ error: "volumeCap must be positive" }, { status: 400 });
    }
    const pricePremium = Number(body.pricePremium ?? 0);
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

    // ── Contracts meet physics (plants tier) ─────────────────────────────────
    // A promise the supplier's plants cannot physically keep is rejected here
    // rather than silently under-delivering every turn. Capacity-implied units
    // for this commodity = Σ over the supplier's sectors of
    // capacity × the commodity's share of that sector's output mix — the same
    // mix split clearing and the world supply ledger use.
    // Only under plants: in earlier modes capacity is not the production base,
    // so there is nothing meaningful to validate against.
    //
    // The capacity figure is SCALED through `plantsSupplyScaledUnits`, the same
    // shared helper the clearing offer and the world supply ledger apply, and
    // therefore the same quantity the shortfall penalty in
    // `settleSupplyAgreements` measures against. Validating RAW capacity was a
    // trap: a sector on a low production policy has an output multiplier well
    // under 1, so it could legally sign for 1.2 × raw capacity while never
    // physically producing more than about 0.85 × of it, and then pay
    // CONTRACT_SHORTFALL_PENALTY on a gap it could never close, every turn,
    // forever. The natcorp scale and the embargo write-off are in the same
    // helper for the same reason.
    //
    // The ramp governor and throughput are deliberately NOT modelled here. Both
    // are transient or ≤ 1 by construction, and CONTRACT_OVERCOMMIT_TOLERANCE is
    // the intentional head-room a supplier is allowed to promise into. What
    // matters is that the head-room now sits on top of the same base the penalty
    // reads, instead of on top of a base the supplier can never reach.
    let volumeCapValidated = false;
    if (marketAtLeast(await getMarketSystemModeForDb(db), "plants")) {
      const sectors = await db
        .collection<CorporateSector>("corporateSectors")
        .find(
          { corporationId: supplier._id },
          {
            projection: {
              sectorType: 1,
              capitalStock: 1,
              strategyId: 1,
              transitionFromStrategyId: 1,
              transitionStartTurn: 1,
              mothballed: 1,
              productionPolicyLevel: 1,
              embargoSuspended: 1,
              embargoExportExposure: 1,
            },
          }
        )
        .toArray();
      const turnNow =
        (
          await db
            .collection<GameState>("gameState")
            .findOne({ _id: "current" }, { projection: { currentTurn: 1 } })
        )?.currentTurn ?? 0;
      let capacityUnits = 0;
      for (const s of sectors) {
        // Mothballed plants are cold: they back no promise.
        if (s.mothballed === true) continue;
        const capacity = typeof s.capitalStock === "number" ? s.capitalStock : 0;
        if (!(capacity > 0)) continue;
        const rates = getEffectiveStrategyRates(
          s.sectorType,
          s.strategyId ?? "standard",
          s.transitionFromStrategyId,
          s.transitionStartTurn,
          turnNow
        );
        const scaled =
          plantsSupplyScaledUnits({
            producedUnits: capacity,
            isNatcorp: !!supplier.countryOwnerId,
            productionPolicyLevel: s.productionPolicyLevel,
            embargoSupplyFactor: embargoSupplyFactorFor(s),
          }) ?? 0;
        capacityUnits +=
          scaled *
          commodityMixWeight(
            rates.supply ?? {},
            COMMODITY_BASE_PRICES,
            body.commodity as CommodityType
          );
      }
      const maxCap = capacityUnits * CONTRACT_OVERCOMMIT_TOLERANCE;
      if (!(maxCap > 0)) {
        return NextResponse.json(
          { error: `Your corporation has no plant capacity producing ${body.commodity}` },
          { status: 400 }
        );
      }
      if (volumeCap > maxCap) {
        return NextResponse.json(
          {
            error: `volumeCap exceeds what your plants can make. Usable output for ${
              body.commodity
            } at your current production policy is about ${Math.round(capacityUnits)} units per day, so the most you can contract is ${Math.round(maxCap)}.`,
          },
          { status: 400 }
        );
      }
      volumeCapValidated = true;
    }

    const buyer = await db
      .collection<Corporation>("corporations")
      .findOne({ _id: new ObjectId(body.buyerCorpId) }, { projection: { _id: 1 } });
    if (!buyer) {
      return NextResponse.json({ error: "Buyer corporation not found" }, { status: 404 });
    }

    const now = new Date();
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
      commodity: body.commodity as CommodityType,
      volumeCap,
      pricePremium,
      exclusive: body.exclusive === true,
      status: "pending",
      proposedByCorpId: supplier._id,
      createdAt: now,
      updatedAt: now,
    };
    const res = await db.collection<SupplyAgreement>("supplyAgreements").insertOne(doc);

    recordAudit({
      source: "api",
      action: "commodity.trade",
      category: "market",
      subject: { type: "supplyAgreement", id: res.insertedId, name: doc.commodity },
      counterparty: { type: "corporation", id: buyer._id },
      refs: { corporationId: supplier._id },
      delta: [
        { field: "status", before: null, after: "pending" },
        { field: "commodity", before: null, after: doc.commodity },
        { field: "volumeCap", before: null, after: volumeCap },
        { field: "pricePremium", before: null, after: pricePremium },
      ],
      outcome: "ok",
    });

    return NextResponse.json({ success: true, agreementId: res.insertedId.toString() });
  } catch (error) {
    return handleRouteError(error);
  }
}

/**
 * PATCH /api/corporations/[id]/supply-agreements/[agreementId] — accept or
 * cancel. Accept requires the BUYER's CEO; cancel is allowed to either party.
 */
export async function updateSupplyAgreement(request: Request, corpId: string, agreementId: string) {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;
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

    const body = (await request.json().catch(() => ({}))) as { action?: string };
    const isSupplier = agreement.supplierCorpId.equals(corp._id);
    const isBuyer = agreement.buyerCorpId.equals(corp._id);
    if (!isSupplier && !isBuyer) {
      return NextResponse.json({ error: "Not a party to this agreement" }, { status: 403 });
    }

    if (body.action === "accept") {
      if (!isBuyer) {
        return NextResponse.json({ error: "Only the buyer can accept" }, { status: 403 });
      }
      if (agreement.status !== "pending") {
        return NextResponse.json({ error: "Agreement is not pending" }, { status: 400 });
      }
      await db
        .collection<SupplyAgreement>("supplyAgreements")
        .updateOne({ _id: agreement._id }, { $set: { status: "active", updatedAt: new Date() } });
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

    return NextResponse.json({ error: "Unknown action (accept|cancel)" }, { status: 400 });
  } catch (error) {
    return handleRouteError(error);
  }
}
