/**
 * Political advertising orders. Funding claims preserve the target, source,
 * payer currency and escrow before the debit starts; each seller receipt and
 * refund uses that original order record and a stable movement key.
 */

import { isDeepStrictEqual } from "node:util";
import { ObjectId, type Db, type Document } from "mongodb";
import {
  applyMoneyMove,
  MONEY_MOVE_COLLECTION,
  resumeMoneyMove,
  type MoneyMove,
  type MoneyMoveResult,
} from "@/lib/banking/moneyMove";
import { AD_BONUS_CAP, adExposure, type TargetedAd } from "@/lib/campaignTargeting/rules";
import { politicalMediaFillRatio } from "./rules";

export const POLITICAL_MEDIA_ORDER_KIND = "political-media-order";
export const POLITICAL_MEDIA_ESCROW_CURRENCY = "AHD";
export const POLITICAL_MEDIA_ESCROW_RATE = 1;

export type PoliticalMediaOrderSource = "advertise" | "targeted_ad" | "campaign_maintenance";

export type PoliticalMediaOrderEffect =
  | { kind: "none" }
  | {
      kind: "favorability";
      targetCollection: "characters" | "npps" | "electionCandidates";
      targetDocumentId: string;
      targetDocumentIdIsObjectId: boolean;
      amount: number;
    }
  | {
      kind: "targeted_ad";
      targetCollection: "characters" | "npps" | "electionCandidates";
      targetDocumentId: string;
      targetDocumentIdIsObjectId: boolean;
      ad: {
        stateId: string;
        dimension: string;
        bucket: string;
        bonus: number;
        lastPurchaseTurn: number;
      };
    };

export interface PoliticalMediaPayer {
  collection: "characters" | "campaigns";
  documentId: ObjectId | string;
  path: string;
  currencyCode: string;
  localPerAnchor: number;
  amountLocal: number;
  /** Present for player actions whose existing action-point cost is retained. */
  currentActions?: number;
  actionCost?: number;
}

export interface PoliticalMediaOrderIdentity {
  orderId: string;
  source: PoliticalMediaOrderSource;
  createdTurn: number;
  countryId: string;
  targetStateId: string;
  requestedAnchor: number;
  payer: {
    collection: PoliticalMediaPayer["collection"];
    documentId: string;
    documentIdIsObjectId: boolean;
    path: string;
    currencyCode: string;
    localPerAnchor: number;
    amountLocal: number;
    actionCost: number;
    currentActions: number | null;
  };

  details: Record<string, unknown>;
}

interface PoliticalMediaTargetDocument extends Document {
  _id: ObjectId | string;
  targetedAds?: TargetedAd[];
  targetedAdsRevision?: number;
}

function parsePoliticalMediaOrderEffect(raw: unknown): PoliticalMediaOrderEffect | null {
  if (typeof raw !== "object" || raw === null || !("kind" in raw)) return null;
  if (raw.kind === "none") return { kind: "none" };
  if (
    !("targetCollection" in raw) ||
    (raw.targetCollection !== "characters" &&
      raw.targetCollection !== "npps" &&
      raw.targetCollection !== "electionCandidates") ||
    !("targetDocumentId" in raw) ||
    typeof raw.targetDocumentId !== "string" ||
    raw.targetDocumentId.length === 0 ||
    !("targetDocumentIdIsObjectId" in raw) ||
    typeof raw.targetDocumentIdIsObjectId !== "boolean"
  )
    return null;

  const target: Pick<
    Extract<PoliticalMediaOrderEffect, { kind: "favorability" }>,
    "targetCollection" | "targetDocumentId" | "targetDocumentIdIsObjectId"
  > = {
    targetCollection: raw.targetCollection,
    targetDocumentId: raw.targetDocumentId,
    targetDocumentIdIsObjectId: raw.targetDocumentIdIsObjectId,
  };
  if (raw.kind === "favorability") {
    return "amount" in raw && typeof raw.amount === "number" && Number.isFinite(raw.amount)
      ? { kind: "favorability", ...target, amount: raw.amount }
      : null;
  }
  if (raw.kind !== "targeted_ad" || !("ad" in raw)) return null;
  const ad = raw.ad;
  if (
    typeof ad !== "object" ||
    ad === null ||
    !("stateId" in ad) ||
    typeof ad.stateId !== "string" ||
    !("dimension" in ad) ||
    typeof ad.dimension !== "string" ||
    !("bucket" in ad) ||
    typeof ad.bucket !== "string" ||
    !("bonus" in ad) ||
    typeof ad.bonus !== "number" ||
    !Number.isFinite(ad.bonus) ||
    !("lastPurchaseTurn" in ad) ||
    typeof ad.lastPurchaseTurn !== "number" ||
    !Number.isSafeInteger(ad.lastPurchaseTurn)
  )
    return null;
  return {
    kind: "targeted_ad",
    ...target,
    ad: {
      stateId: ad.stateId,
      dimension: ad.dimension,
      bucket: ad.bucket,
      bonus: ad.bonus,
      lastPurchaseTurn: ad.lastPurchaseTurn,
    },
  };
}

export interface PoliticalMediaSellerReceiptPlan {
  allocationId: string;
  sectorId: string;
  corporationId: string;
  units: number;
  amountAnchor: number;
  sellerLocalAmount: number;
  sellerCurrencyCode: string;
  sellerLocalPerAnchor: number;
}

export interface PoliticalMediaSettlementPlan {
  plannedTurn: number;
  deliveredAnchor: number;
  unfilledAnchor: number;
  deliveredUnits: number;
  sellers: PoliticalMediaSellerReceiptPlan[];
}

interface PoliticalMediaOrderRecord {
  status: "funding" | "open" | "settling" | "settled" | "rejected";
  escrowBalanceAnchor: number;
  identity: PoliticalMediaOrderIdentity;
  settlementPlan?: PoliticalMediaSettlementPlan;
  effectApplied?: boolean;
}

interface PoliticalMediaMoveRecord {
  _id: string;
  kind: string;
  status: string;
  politicalMediaOrder?: PoliticalMediaOrderRecord;
  politicalMediaOrderIdentity?: unknown;
}

export interface PoliticalMediaOrderForClearing {
  orderId: string;
  identity: PoliticalMediaOrderIdentity;
  settlementPlan?: PoliticalMediaSettlementPlan;
  status: PoliticalMediaOrderRecord["status"];
  effectApplied?: boolean;
}

function persistedId(value: string, isObjectId: boolean): ObjectId | string {
  return isObjectId ? new ObjectId(value) : value;
}

function validateSettlementPlan(
  identity: PoliticalMediaOrderIdentity,
  plan: PoliticalMediaSettlementPlan
): void {
  const epsilon = 1e-7;
  const validNonnegative = (value: number) => Number.isFinite(value) && value >= 0;
  if (
    !Number.isSafeInteger(plan.plannedTurn) ||
    plan.plannedTurn < identity.createdTurn ||
    !validNonnegative(plan.deliveredAnchor) ||
    !validNonnegative(plan.unfilledAnchor) ||
    !validNonnegative(plan.deliveredUnits) ||
    Math.abs(plan.deliveredAnchor + plan.unfilledAnchor - identity.requestedAnchor) > epsilon
  )
    throw new Error(`Political media order ${identity.orderId} has an invalid settlement total.`);

  const allocationIds = new Set<string>();
  let sellerAnchor = 0;
  let sellerUnits = 0;
  for (const seller of plan.sellers) {
    if (
      !seller.allocationId ||
      !/^[A-Za-z0-9:_-]{1,160}$/.test(seller.allocationId) ||
      allocationIds.has(seller.allocationId) ||
      !seller.sectorId ||
      !seller.corporationId ||
      !Number.isFinite(seller.units) ||
      seller.units <= 0 ||
      !Number.isFinite(seller.amountAnchor) ||
      seller.amountAnchor <= 0 ||
      !Number.isFinite(seller.sellerLocalAmount) ||
      seller.sellerLocalAmount <= 0 ||
      !seller.sellerCurrencyCode.trim() ||
      !Number.isFinite(seller.sellerLocalPerAnchor) ||
      seller.sellerLocalPerAnchor <= 0 ||
      Math.abs(seller.sellerLocalAmount - seller.amountAnchor * seller.sellerLocalPerAnchor) >
        epsilon * Math.max(1, seller.sellerLocalAmount)
    )
      throw new Error(`Political media order ${identity.orderId} has an invalid seller receipt.`);
    allocationIds.add(seller.allocationId);
    sellerAnchor += seller.amountAnchor;
    sellerUnits += seller.units;
  }
  if (
    Math.abs(sellerAnchor - plan.deliveredAnchor) > epsilon ||
    Math.abs(sellerUnits - plan.deliveredUnits) > epsilon
  )
    throw new Error(
      `Political media order ${identity.orderId} seller receipts do not match delivery.`
    );
}

async function finishOrResumeMove(
  db: Db,
  key: string,
  result: MoneyMoveResult
): Promise<MoneyMoveResult> {
  if (result.status === "applied" || result.status === "rejected") return result;
  if (result.status === "partial") return resumeMoneyMove(db, key);
  const record = await db
    .collection<PoliticalMediaMoveRecord>(MONEY_MOVE_COLLECTION)
    .findOne({ _id: key }, { projection: { status: 1 } });
  if (!record) return { status: "rejected", applied: [], error: `no money move ${key}` };
  if (record.status === "applied") return { status: "applied", applied: [] };
  if (record.status === "rejected")
    return { status: "rejected", applied: [], error: `money move ${key} was rejected` };
  return resumeMoneyMove(db, key);
}

export function politicalMediaOrderKey(orderId: string): string {
  return `political-media-order:${orderId}`;
}

function validatedIdentity(args: {
  orderId: string;
  source: PoliticalMediaOrderSource;
  createdTurn: number;
  countryId: string;
  targetStateId: string;
  payer: PoliticalMediaPayer;
  details: Record<string, unknown>;
}): PoliticalMediaOrderIdentity {
  const { payer } = args;
  if (
    !/^[A-Za-z0-9:_-]{1,160}$/.test(args.orderId) ||
    !args.countryId ||
    !args.targetStateId ||
    !Number.isSafeInteger(args.createdTurn) ||
    args.createdTurn < 0 ||
    !Number.isFinite(payer.amountLocal) ||
    payer.amountLocal <= 0 ||
    !Number.isFinite(payer.localPerAnchor) ||
    payer.localPerAnchor <= 0 ||
    !payer.currencyCode.trim() ||
    !payer.path.trim() ||
    (payer.actionCost !== undefined &&
      (!Number.isSafeInteger(payer.actionCost) || payer.actionCost < 0)) ||
    (payer.currentActions !== undefined &&
      (!Number.isSafeInteger(payer.currentActions) || payer.currentActions < 0)) ||
    ((payer.actionCost ?? 0) > 0 && payer.currentActions === undefined)
  )
    throw new Error("Political media order has an invalid source, target or payer quote.");

  return {
    orderId: args.orderId,
    source: args.source,
    createdTurn: args.createdTurn,
    countryId: args.countryId,
    targetStateId: args.targetStateId,
    requestedAnchor: payer.amountLocal / payer.localPerAnchor,
    payer: {
      collection: payer.collection,
      documentId: String(payer.documentId),
      documentIdIsObjectId: payer.documentId instanceof ObjectId,
      path: payer.path,
      currencyCode: payer.currencyCode,
      localPerAnchor: payer.localPerAnchor,
      amountLocal: payer.amountLocal,
      actionCost: payer.actionCost ?? 0,
      currentActions: payer.currentActions ?? null,
    },
    details: args.details,
  };
}

/**
 * Claim a durable target-state order, then debit its payer and credit anchor
 * escrow through one replay-safe money-move record.
 */
export async function fundPoliticalMediaOrder(
  db: Db,
  args: {
    orderId: string;
    source: PoliticalMediaOrderSource;
    createdTurn: number;
    countryId: string;
    targetStateId: string;
    payer: PoliticalMediaPayer;
    details?: Record<string, unknown>;
  }
): Promise<MoneyMoveResult> {
  const identity = validatedIdentity({ ...args, details: args.details ?? {} });
  const key = politicalMediaOrderKey(identity.orderId);
  const actions = identity.payer.actionCost;
  const payerFilter: Record<string, unknown> = { _id: args.payer.documentId };
  payerFilter[identity.payer.path] = { $gte: identity.payer.amountLocal };
  if (actions > 0) payerFilter.actions = identity.payer.currentActions;
  const payerSet =
    actions > 0 ? { actions: (identity.payer.currentActions ?? 0) - actions } : undefined;
  const order: PoliticalMediaOrderRecord = {
    status: "funding",
    escrowBalanceAnchor: 0,
    identity,
  };
  const move: MoneyMove = {
    key,
    kind: POLITICAL_MEDIA_ORDER_KIND,
    turn: identity.createdTurn,
    quoteIdentity: identity,
    record: {
      politicalMediaOrder: order,
      politicalMediaOrderIdentity: identity,
    },
    legs: [
      {
        kind: "debit",
        amount: args.payer.amountLocal,
        valuation: {
          currencyCode: args.payer.currencyCode,
          localPerAnchor: args.payer.localPerAnchor,
        },
        collection: args.payer.collection,
        filter: payerFilter,
        path: args.payer.path,
        ...(payerSet ? { set: payerSet } : {}),
        note: `fund ${identity.source} political advertising order ${identity.orderId}`,
      },
      {
        kind: "credit",
        amount: identity.requestedAnchor,
        valuation: {
          currencyCode: POLITICAL_MEDIA_ESCROW_CURRENCY,
          localPerAnchor: POLITICAL_MEDIA_ESCROW_RATE,
        },
        collection: MONEY_MOVE_COLLECTION,
        filter: { _id: key },
        path: "politicalMediaOrder.escrowBalanceAnchor",
        set: { "politicalMediaOrder.status": "open" },
        note: `credit escrow for political advertising order ${identity.orderId}`,
      },
    ],
  };
  const result = await applyMoneyMove(db, move);
  if (result.status === "rejected" && result.applied.length === 0) {
    await db
      .collection<PoliticalMediaMoveRecord>(MONEY_MOVE_COLLECTION)
      .updateOne(
        { _id: key, kind: POLITICAL_MEDIA_ORDER_KIND, status: "rejected" },
        { $set: { "politicalMediaOrder.status": "rejected" } }
      );
  }
  return result;
}

/** Resume a claim-first funding intent after a process stopped mid-transfer. */
export function resumePoliticalMediaOrderFunding(db: Db, orderId: string) {
  return resumeMoneyMove(db, politicalMediaOrderKey(orderId));
}

/** Call only after the political media feature gate is enabled. */
export async function loadPoliticalMediaOrdersForClearing(
  db: Db,
  currentTurn: number
): Promise<PoliticalMediaOrderForClearing[]> {
  const rows = await db
    .collection<PoliticalMediaMoveRecord>(MONEY_MOVE_COLLECTION)
    .find(
      {
        kind: POLITICAL_MEDIA_ORDER_KIND,
        status: "applied",
        $or: [
          { "politicalMediaOrder.status": { $in: ["open", "settling"] } },
          {
            "politicalMediaOrder.settlementPlan.plannedTurn": currentTurn,
          },
        ],
      },
      { projection: { _id: 1, kind: 1, status: 1, politicalMediaOrder: 1 } }
    )
    .toArray();
  return rows.flatMap((row) => {
    const order = row.politicalMediaOrder;
    if (!order) return [];
    return [
      {
        orderId: order.identity.orderId,
        identity: order.identity,
        ...(order.settlementPlan ? { settlementPlan: order.settlementPlan } : {}),
        status: order.status,
        ...(order.effectApplied !== undefined ? { effectApplied: order.effectApplied } : {}),
      },
    ];
  });
}

/**
 * Persist the exact clearing allocation before sector P&L writes. Replays use
 * this first plan, including seller-local amounts and captured rates.
 */
export async function savePoliticalMediaSettlementPlan(
  db: Db,
  orderId: string,
  plan: PoliticalMediaSettlementPlan
): Promise<PoliticalMediaSettlementPlan> {
  const key = politicalMediaOrderKey(orderId);
  const orders = db.collection<PoliticalMediaMoveRecord>(MONEY_MOVE_COLLECTION);
  const stored = await orders.findOne({ _id: key, kind: POLITICAL_MEDIA_ORDER_KIND });
  if (!stored || stored.status !== "applied" || !stored.politicalMediaOrder)
    throw new Error(`Political media order ${orderId} is not fully funded.`);
  validateSettlementPlan(stored.politicalMediaOrder.identity, plan);
  if (stored.politicalMediaOrder.settlementPlan) return stored.politicalMediaOrder.settlementPlan;
  const result = await orders.updateOne(
    {
      _id: key,
      kind: POLITICAL_MEDIA_ORDER_KIND,
      status: "applied",
      "politicalMediaOrder.status": "open",
      "politicalMediaOrder.settlementPlan": { $exists: false },
    },
    {
      $set: {
        "politicalMediaOrder.status": "settling",
        "politicalMediaOrder.settlementPlan": plan,
      },
    }
  );
  if (result.modifiedCount) return plan;
  const replay = await orders.findOne({ _id: key, kind: POLITICAL_MEDIA_ORDER_KIND });
  const saved = replay?.politicalMediaOrder?.settlementPlan;
  if (!saved) throw new Error(`Political media order ${orderId} has no durable settlement plan.`);
  if (!isDeepStrictEqual(saved, plan)) return saved;
  return saved;
}

/** Payout a plan saved on the order, then return its unfilled escrow once. */
export async function settlePoliticalMediaOrder(
  db: Db,
  orderId: string,
  turn: number
): Promise<MoneyMoveResult[]> {
  const key = politicalMediaOrderKey(orderId);
  const orders = db.collection<PoliticalMediaMoveRecord>(MONEY_MOVE_COLLECTION);
  const order = await orders.findOne({ _id: key, kind: POLITICAL_MEDIA_ORDER_KIND });
  const saved = order?.politicalMediaOrder;
  if (!order || order.status !== "applied" || !saved?.settlementPlan)
    throw new Error(`Political media order ${orderId} has no funded settlement plan.`);
  if (saved.status === "settled") return [];
  const plan = saved.settlementPlan;
  const results: MoneyMoveResult[] = [];

  for (const seller of plan.sellers) {
    const receiptIdentity = {
      orderId,
      allocationId: seller.allocationId,
      targetStateId: saved.identity.targetStateId,
      sectorId: seller.sectorId,
      corporationId: seller.corporationId,
      units: seller.units,
      amountAnchor: seller.amountAnchor,
      sellerLocalAmount: seller.sellerLocalAmount,
      sellerCurrencyCode: seller.sellerCurrencyCode,
      sellerLocalPerAnchor: seller.sellerLocalPerAnchor,
    };
    const payoutKey = `political-media-seller:${orderId}:${seller.allocationId}`;
    const payoutAttempt = await applyMoneyMove(db, {
      key: payoutKey,
      kind: "political-media-seller-receipt",
      turn,
      quoteIdentity: receiptIdentity,
      record: { politicalMediaOrderIdentity: receiptIdentity },
      legs: [
        {
          kind: "debit",
          amount: seller.amountAnchor,
          valuation: {
            currencyCode: POLITICAL_MEDIA_ESCROW_CURRENCY,
            localPerAnchor: POLITICAL_MEDIA_ESCROW_RATE,
          },
          collection: MONEY_MOVE_COLLECTION,
          filter: { _id: key, kind: POLITICAL_MEDIA_ORDER_KIND, status: "applied" },
          path: "politicalMediaOrder.escrowBalanceAnchor",
          note: `pay seller ${seller.corporationId} for political advertising order ${orderId}`,
        },
        {
          kind: "credit",
          amount: seller.sellerLocalAmount,
          valuation: {
            currencyCode: seller.sellerCurrencyCode,
            localPerAnchor: seller.sellerLocalPerAnchor,
          },
          collection: "corporations",
          filter: {
            _id: persistedId(seller.corporationId, ObjectId.isValid(seller.corporationId)),
          },
          path: "liquidCapital",
          set: {
            [`politicalMediaReceipts.${orderId}.${seller.allocationId}`]: receiptIdentity,
          },
          note: `political advertising receipt for order ${orderId}`,
        },
      ],
    });
    const payout = await finishOrResumeMove(db, payoutKey, payoutAttempt);
    results.push(payout);
    if (payout.status !== "applied" && payout.status !== "replayed") return results;
  }

  const payer = saved.identity.payer;
  if (plan.unfilledAnchor > 0) {
    const refundLocal = plan.unfilledAnchor * payer.localPerAnchor;
    const refundKey = `political-media-refund:${orderId}`;
    const refundAttempt = await applyMoneyMove(db, {
      key: refundKey,
      kind: "political-media-refund",
      turn,
      quoteIdentity: {
        orderId,
        targetStateId: saved.identity.targetStateId,
        refundAnchor: plan.unfilledAnchor,
        refundLocal,
        payerCurrencyCode: payer.currencyCode,
        payerLocalPerAnchor: payer.localPerAnchor,
      },
      record: {
        politicalMediaOrderIdentity: {
          orderId,
          targetStateId: saved.identity.targetStateId,
          refundAnchor: plan.unfilledAnchor,
          refundLocal,
          payerCurrencyCode: payer.currencyCode,
          payerLocalPerAnchor: payer.localPerAnchor,
        },
      },
      legs: [
        {
          kind: "debit",
          amount: plan.unfilledAnchor,
          valuation: {
            currencyCode: POLITICAL_MEDIA_ESCROW_CURRENCY,
            localPerAnchor: POLITICAL_MEDIA_ESCROW_RATE,
          },
          collection: MONEY_MOVE_COLLECTION,
          filter: { _id: key, kind: POLITICAL_MEDIA_ORDER_KIND, status: "applied" },
          path: "politicalMediaOrder.escrowBalanceAnchor",
          note: `release unfilled escrow for political advertising order ${orderId}`,
        },
        {
          kind: "credit",
          amount: refundLocal,
          valuation: {
            currencyCode: payer.currencyCode,
            localPerAnchor: payer.localPerAnchor,
          },
          collection: payer.collection,
          filter: { _id: persistedId(payer.documentId, payer.documentIdIsObjectId) },
          path: payer.path,
          note: `refund unfilled political advertising order ${orderId}`,
        },
      ],
    });
    const refund = await finishOrResumeMove(db, refundKey, refundAttempt);
    results.push(refund);
    if (refund.status !== "applied" && refund.status !== "replayed") return results;
  }

  await orders.updateOne(
    { _id: key, kind: POLITICAL_MEDIA_ORDER_KIND, status: "applied" },
    { $set: { "politicalMediaOrder.status": "settled" } }
  );
  return results;
}

/** Apply a fully paid order's game effect once, after its seller receipts land. */
export async function applyPoliticalMediaOrderEffect(db: Db, orderId: string): Promise<boolean> {
  const key = politicalMediaOrderKey(orderId);
  const orders = db.collection<PoliticalMediaMoveRecord>(MONEY_MOVE_COLLECTION);
  const record = await orders.findOne({
    _id: key,
    kind: POLITICAL_MEDIA_ORDER_KIND,
    status: "applied",
  });
  const order = record?.politicalMediaOrder;
  if (!order || order.status !== "settled" || !order.settlementPlan) return false;
  if (order.effectApplied) return true;

  const rawEffect = order.identity.details.effect;
  const effect =
    rawEffect === undefined ? { kind: "none" as const } : parsePoliticalMediaOrderEffect(rawEffect);
  if (effect?.kind === "none") {
    await orders.updateOne(
      { _id: key, kind: POLITICAL_MEDIA_ORDER_KIND, "politicalMediaOrder.status": "settled" },
      { $set: { "politicalMediaOrder.effectApplied": true } }
    );
    return true;
  }
  if (!effect) return false;

  const targetId = persistedId(effect.targetDocumentId, effect.targetDocumentIdIsObjectId);
  const targets = db.collection<PoliticalMediaTargetDocument>(effect.targetCollection);
  const effectReceiptPath = `politicalMediaAppliedOrders.${orderId}`;
  const fillRatio = politicalMediaFillRatio(
    order.settlementPlan.deliveredAnchor,
    order.identity.requestedAnchor
  );
  if (effect.kind === "favorability") {
    if (!Number.isFinite(effect.amount) || !(effect.amount > 0)) return false;
    const amount = effect.amount * fillRatio;
    const update = await targets.updateOne(
      { _id: targetId, [effectReceiptPath]: { $exists: false } },
      [
        {
          $set: {
            favorability: {
              $min: [100, { $max: [0, { $add: [{ $ifNull: ["$favorability", 0] }, amount] }] }],
            },
            [effectReceiptPath]: true,
          },
        },
      ]
    );
    if (!update.matchedCount) {
      const alreadyApplied = await targets.findOne({ _id: targetId, [effectReceiptPath]: true });
      if (!alreadyApplied) return false;
    }
  } else if (effect.kind === "targeted_ad") {
    const ad = effect.ad;
    if (
      !ad ||
      !ad.stateId ||
      !ad.dimension ||
      !ad.bucket ||
      !Number.isFinite(ad.bonus) ||
      !(ad.bonus > 0) ||
      !Number.isSafeInteger(ad.lastPurchaseTurn)
    )
      return false;
    const deliveredIncrement = ad.bonus * fillRatio;
    if (!(deliveredIncrement > 0)) {
      const markedTarget = await targets.updateOne(
        { _id: targetId, [effectReceiptPath]: { $exists: false } },
        { $set: { [effectReceiptPath]: true } }
      );
      if (!markedTarget.matchedCount) {
        const alreadyApplied = await targets.findOne({ _id: targetId, [effectReceiptPath]: true });
        if (!alreadyApplied) return false;
      }
    } else {
      let applied = false;
      for (let attempt = 0; attempt < 5 && !applied; attempt++) {
        const alreadyApplied = await targets.findOne({ _id: targetId, [effectReceiptPath]: true });
        if (alreadyApplied) {
          applied = true;
          break;
        }
        const existing = await targets.findOne(
          { _id: targetId },
          { projection: { targetedAds: 1, targetedAdsRevision: 1 } }
        );
        if (!existing) return false;
        const ads = Array.isArray(existing.targetedAds) ? existing.targetedAds : [];
        const sameTarget = (previous: TargetedAd) =>
          previous.stateId === ad.stateId &&
          previous.dimension === ad.dimension &&
          previous.bucket === ad.bucket;
        const previousBonus = Math.max(
          0,
          ...ads.filter(sameTarget).map((previous) => adExposure(previous, ad.lastPurchaseTurn))
        );
        const nextBonus = Math.min(AD_BONUS_CAP, previousBonus + deliveredIncrement);
        const nextAds = ads.filter((previous) => !sameTarget(previous));
        if (nextBonus > 0) {
          nextAds.push({
            stateId: ad.stateId,
            dimension: ad.dimension,
            bucket: ad.bucket,
            bonus: nextBonus,
            lastPurchaseTurn: ad.lastPurchaseTurn,
          });
        }
        const revision =
          typeof existing.targetedAdsRevision === "number" ? existing.targetedAdsRevision : 0;
        const revisionFilter =
          existing.targetedAdsRevision === undefined
            ? { targetedAdsRevision: { $exists: false } }
            : { targetedAdsRevision: revision };
        const update = await targets.updateOne(
          { _id: targetId, [effectReceiptPath]: { $exists: false }, ...revisionFilter },
          {
            $set: {
              targetedAds: nextAds,
              targetedAdsRevision: revision + 1,
              [effectReceiptPath]: true,
            },
          }
        );
        applied = update.matchedCount > 0;
      }
      if (!applied) return false;
    }
  } else {
    return false;
  }

  const marked = await orders.updateOne(
    { _id: key, kind: POLITICAL_MEDIA_ORDER_KIND, "politicalMediaOrder.status": "settled" },
    { $set: { "politicalMediaOrder.effectApplied": true } }
  );
  return marked.matchedCount > 0 || Boolean(order.effectApplied);
}
