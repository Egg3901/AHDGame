import { ObjectId, type Db } from "mongodb";
import type { Corporation } from "@/lib/db/types";
import { quotePrimaryUnderwritingFee, type PrimaryUnderwritingOffer } from "./rules/underwriting";
import { MONEY_MOVE_COLLECTION } from "./moneyMove";
import { resumeSettlement, settleTransition, type SettlementResult } from "./settlementJournal";
import { oid, type BankingTransition, type TransitionProjection } from "./rules/boundary";

export interface PrimaryUnderwritingFillInput {
  bank: Pick<Corporation, "_id" | "name" | "bankCharter">;
  issuer: Pick<Corporation, "_id" | "name">;
  offer: PrimaryUnderwritingOffer;
  instrumentId: ObjectId;
  grossPlacedLocal: number;
  turn: number;
  now: Date;
  poolCollection: "equityMarketPools" | "bondMarketPools";
  /** Stable publication applied only after the pool debit and both credits land. */
  instrumentProjection: TransitionProjection;
}

export function primaryUnderwritingSettlementKey(
  instrumentType: PrimaryUnderwritingOffer["instrumentType"],
  instrumentId: ObjectId,
  turn: number
): string {
  return `primary-underwriting:${instrumentType}:${instrumentId.toHexString()}:${turn}`;
}

/**
 * Fund one actual fill as a single journaled cash move. The parent corporation
 * lease outlives a replaceable charter and remains held until the final ACK.
 */
export async function settlePrimaryUnderwritingFill(
  db: Db,
  input: PrimaryUnderwritingFillInput
): Promise<SettlementResult> {
  const { bank, issuer, offer, instrumentId, turn, now } = input;
  const key = primaryUnderwritingSettlementKey(offer.instrumentType, instrumentId, turn);
  const priorClaim = await db
    .collection(MONEY_MOVE_COLLECTION)
    .findOne({ _id: key }, { projection: { _id: 1 } });
  if (priorClaim) return resumeSettlement(db, key);

  const quote = quotePrimaryUnderwritingFee({
    grossPlacedLocal: input.grossPlacedLocal,
    feeRate: offer.feeRate,
  });
  if (
    quote.grossPlacedLocal <= 0 ||
    !bank._id.equals(offer.bankCorporationId) ||
    !issuer._id.equals(offer.issuerCorporationId) ||
    issuer._id.equals(bank._id) ||
    !bank.bankCharter ||
    bank.bankCharter.status !== "active" ||
    !["investment", "universal"].includes(bank.bankCharter.type) ||
    bank.bankCharter.currency !== offer.currencyCode ||
    bank.bankCharter.charteredTurn !== offer.charteredTurn
  ) {
    return {
      status: "rejected",
      key: primaryUnderwritingSettlementKey(offer.instrumentType, instrumentId, turn),
      appliedLegs: [],
      appliedProjections: [],
      newlyAppliedProjections: [],
      error: "Underwriter mandate no longer matches its frozen active charter epoch",
    };
  }

  const lease = {
    key,
    issuerCorporationId: issuer._id,
    instrumentType: offer.instrumentType,
    instrumentId,
    charteredTurn: offer.charteredTurn,
    currencyCode: offer.currencyCode,
    grossLocal: quote.grossPlacedLocal,
    feeLocal: quote.feeLocal,
    issuerNetLocal: quote.issuerNetLocal,
    turn,
  } as const;
  const corporations = db.collection<Corporation>("corporations");
  const acquired = await corporations.updateOne(
    {
      _id: bank._id,
      "bankCharter.status": "active",
      "bankCharter.resolutionClaimedTurn": { $exists: false },
      bankCharterTransfer: { $exists: false },
      "bankCharter.type": { $in: ["investment", "universal"] },
      "bankCharter.currency": offer.currencyCode,
      "bankCharter.charteredTurn": offer.charteredTurn,
      bankUnderwritingFunding: { $exists: false },
    },
    { $set: { bankUnderwritingFunding: lease, updatedAt: now } }
  );
  if (acquired.matchedCount !== 1) {
    const currentLease = await corporations.findOne(
      { _id: bank._id, "bankUnderwritingFunding.key": key },
      { projection: { _id: 1 } }
    );
    if (currentLease) {
      // A previous attempt may have stopped after leasing but before the
      // journal claim. The frozen key remains safe to continue under.
    } else {
      return {
        status: "rejected",
        key,
        appliedLegs: [],
        appliedProjections: [],
        newlyAppliedProjections: [],
        error: "Underwriter charter is busy or has changed",
      };
    }
  }

  const pool = { _id: offer.currencyCode };
  const receipt = {
    key,
    issuerCorporationId: issuer._id,
    issuerName: issuer.name,
    instrumentType: offer.instrumentType,
    instrumentId,
    currencyCode: offer.currencyCode,
    grossPlacedLocal: quote.grossPlacedLocal,
    feeLocal: quote.feeLocal,
    issuerNetLocal: quote.issuerNetLocal,
    turn,
    charteredTurn: offer.charteredTurn,
  };
  const transition: BankingTransition = {
    key,
    kind: "bank.primary_underwriting",
    turn,
    currency: offer.currencyCode,
    legs: [
      {
        kind: "debit",
        amount: quote.grossPlacedLocal,
        collection: input.poolCollection,
        filter: pool,
        path: "cashLocal",
        set: { updatedAt: now },
        note: "Currency pool funds actually placed primary units",
      },
      {
        kind: "credit",
        amount: quote.issuerNetLocal,
        collection: "corporations",
        filter: { _id: oid(issuer._id.toHexString()) },
        path: "liquidCapital",
        note: "Issuer receives net primary proceeds",
      },
      {
        kind: "credit",
        amount: quote.feeLocal,
        collection: "corporations",
        filter: { _id: oid(bank._id.toHexString()), "bankUnderwritingFunding.key": key },
        path: "liquidCapital",
        note: "Underwriter receives fee on funded placement",
      },
    ],
    projections: [
      {
        collection: input.poolCollection,
        filter: pool,
        update: {
          $inc: { "lifetime.issuanceOut": quote.grossPlacedLocal },
          $set: { updatedAt: now },
        },
        note: "Reconcile primary issuance pool ledger",
      },
      input.instrumentProjection,
      {
        collection: "corporations",
        filter: { _id: oid(bank._id.toHexString()), "bankUnderwritingFunding.key": key },
        update: {
          $inc: { [`bankUnderwritingIncomeByCurrency.${offer.currencyCode}`]: quote.feeLocal },
          $push: { bankUnderwritingReceipts: { $each: [receipt], $slice: -100 } },
          $set: { updatedAt: now },
        },
        note: "Record actual funded underwriting fee receipt",
      },
      {
        collection: "corporations",
        filter: { _id: oid(bank._id.toHexString()), "bankUnderwritingFunding.key": key },
        update: { $unset: { bankUnderwritingFunding: "" }, $set: { updatedAt: now } },
        note: "Release original charter epoch lease after all placement ACKs",
      },
    ],
    event: {
      kind: "prop.traded",
      command: "bank.primary.underwrite",
      subjectType: "corporation",
      subjectId: issuer._id.toHexString(),
      amount: quote.feeLocal,
      meta: {
        instrumentType: offer.instrumentType,
        instrumentId: instrumentId.toHexString(),
        grossPlacedLocal: quote.grossPlacedLocal,
        issuerNetLocal: quote.issuerNetLocal,
        bankId: bank._id.toHexString(),
        charteredTurn: offer.charteredTurn,
      },
    },
  };

  let settled: SettlementResult;
  try {
    settled = await settleTransition(db, transition);
  } catch (error) {
    // The durable lease is intentionally retained; recovery resumes the exact
    // journal claim rather than selecting a replacement charter.
    throw error;
  }
  if (
    (settled.status === "partial" || settled.status === "rejected") &&
    settled.appliedLegs.length === 0
  ) {
    await corporations.updateOne(
      { _id: bank._id, "bankUnderwritingFunding.key": key },
      { $unset: { bankUnderwritingFunding: "" }, $set: { updatedAt: now } }
    );
  }
  return settled;
}
