import { ObjectId, type Db } from "mongodb";
import type { Corporation } from "@/lib/db/types";
import type { CurrencyCode } from "@/lib/constants/currencies";
import {
  capturePrimaryUnderwritingCurrencySnapshot,
  type PrimaryUnderwritingCurrencySnapshot,
  type PrimaryUnderwritingOffer,
} from "./underwritingTypes";
import { quotePrimaryUnderwritingFee } from "./rules/underwriting";
import { MONEY_MOVE_COLLECTION } from "./moneyMove";
import { resumeSettlement, settleTransition, type SettlementResult } from "./settlementJournal";
import { oid, type BankingTransition, type TransitionProjection } from "./rules/boundary";

function recipientCurrencySnapshotFilter(
  snapshot: PrimaryUnderwritingCurrencySnapshot
): Record<string, unknown> {
  const exactField = (present: boolean, value: string | null | undefined) =>
    present ? { $exists: true, $eq: value } : { $exists: false };
  return {
    liquidCurrencyCode: exactField(snapshot.liquidCurrencyCodePresent, snapshot.liquidCurrencyCode),
    countryId: exactField(snapshot.countryIdPresent, snapshot.countryId),
  };
}

function sameCurrencySnapshot(
  left: PrimaryUnderwritingCurrencySnapshot | null,
  right: PrimaryUnderwritingCurrencySnapshot
): boolean {
  return (
    left !== null &&
    left.currencyCode === right.currencyCode &&
    left.liquidCurrencyCodePresent === right.liquidCurrencyCodePresent &&
    (!left.liquidCurrencyCodePresent || left.liquidCurrencyCode === right.liquidCurrencyCode) &&
    left.countryIdPresent === right.countryIdPresent &&
    (!left.countryIdPresent || left.countryId === right.countryId)
  );
}

async function acquireIssuerUnderwritingReceiptLease(
  db: Db,
  issuerId: ObjectId,
  key: string,
  offer: PrimaryUnderwritingOffer,
  turn: number,
  now: Date
): Promise<boolean> {
  const corporations = db.collection<Corporation>("corporations");
  const acquired = await corporations.updateOne(
    {
      _id: issuerId,
      ...recipientCurrencySnapshotFilter(offer.issuerCurrencySnapshot),
      primaryUnderwritingIncomingFunding: { $exists: false },
    },
    {
      $set: {
        primaryUnderwritingIncomingFunding: {
          key,
          currencySnapshot: offer.issuerCurrencySnapshot,
          turn,
        },
        updatedAt: now,
      },
    }
  );
  if (acquired.matchedCount === 1) return true;
  const current = await corporations.findOne(
    { _id: issuerId, "primaryUnderwritingIncomingFunding.key": key },
    { projection: { _id: 1 } }
  );
  return current !== null;
}

export interface PrimaryUnderwritingFillInput {
  bank: Pick<Corporation, "_id" | "name" | "countryId" | "liquidCurrencyCode" | "bankCharter">;
  issuer: Pick<Corporation, "_id" | "name" | "countryId" | "liquidCurrencyCode">;
  issuerCurrencyCode: CurrencyCode;
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
 * Resume founding IPO plans staged on private issuer shells. The shell itself
 * is a valid private corporation; public shares and cash appear only through
 * the frozen journal projection. If the selected bank is gone before any
 * journal/lease exists, clear the unpaid plan and leave the issuer private.
 */
export async function resumeFoundingUnderwritingPlans(
  db: Db,
  now = new Date()
): Promise<{ completed: number; pending: number; aborted: number }> {
  const corporations = db.collection<Corporation>("corporations");
  const issuers = await corporations
    .find({ "foundingIpoUnderwritingPending.offer.instrumentId": { $exists: true } })
    .sort({ foundedAtTurn: 1 })
    .limit(50)
    .project<
      Pick<
        Corporation,
        | "_id"
        | "name"
        | "countryId"
        | "liquidCurrencyCode"
        | "foundedAtTurn"
        | "foundingIpoUnderwritingPending"
      >
    >({
      _id: 1,
      name: 1,
      countryId: 1,
      liquidCurrencyCode: 1,
      foundedAtTurn: 1,
      foundingIpoUnderwritingPending: 1,
    })
    .toArray();
  const result = { completed: 0, pending: 0, aborted: 0 };
  const bankIds = [
    ...new Map(
      issuers
        .map((issuer) => issuer.foundingIpoUnderwritingPending?.offer.bankCorporationId)
        .filter((id): id is ObjectId => id instanceof ObjectId)
        .map((id) => [id.toHexString(), id])
    ).values(),
  ];
  const banks =
    bankIds.length === 0
      ? []
      : await corporations
          .find({ _id: { $in: bankIds } })
          .project<
            Pick<Corporation, "_id" | "name" | "countryId" | "liquidCurrencyCode" | "bankCharter">
          >({
            _id: 1,
            name: 1,
            countryId: 1,
            liquidCurrencyCode: 1,
            bankCharter: 1,
          })
          .toArray();
  const bankById = new Map(banks.map((bank) => [bank._id.toHexString(), bank]));
  for (const issuer of issuers) {
    const pending = issuer.foundingIpoUnderwritingPending;
    if (!pending) continue;
    const { offer, instrumentProjection } = pending;
    const key = primaryUnderwritingSettlementKey("equity", offer.instrumentId, pending.turn);
    const existingJournal = await db
      .collection<{ _id: string }>(MONEY_MOVE_COLLECTION)
      .findOne({ _id: key }, { projection: { _id: 1 } });
    if (existingJournal) {
      const resumed = await resumeSettlement(db, key);
      if (resumed.status === "applied" || resumed.status === "replayed") result.completed++;
      else result.pending++;
      continue;
    }

    const bank = bankById.get(offer.bankCorporationId.toHexString());
    if (!bank) {
      await corporations.updateOne(
        {
          _id: issuer._id,
          "foundingIpoUnderwritingPending.offer.instrumentId": offer.instrumentId,
        },
        { $unset: { foundingIpoUnderwritingPending: "" }, $set: { updatedAt: now } }
      );
      result.aborted++;
      continue;
    }
    const settled = await settlePrimaryUnderwritingFill(db, {
      bank,
      issuer: {
        _id: issuer._id,
        name: issuer.name,
        countryId: issuer.countryId,
        liquidCurrencyCode: issuer.liquidCurrencyCode,
      },
      issuerCurrencyCode: offer.currencyCode,
      offer,
      instrumentId: offer.instrumentId,
      grossPlacedLocal: pending.grossPlacedLocal,
      turn: pending.turn,
      now,
      poolCollection: "equityMarketPools",
      instrumentProjection,
    });
    if (settled.status === "applied" || settled.status === "replayed") {
      result.completed++;
    } else if (settled.status === "rejected" && settled.appliedLegs.length === 0) {
      // No cash moved, so the original IPO can be abandoned without deleting
      // or altering the already funded private issuer shell.
      await corporations.updateOne(
        {
          _id: issuer._id,
          "foundingIpoUnderwritingPending.offer.instrumentId": offer.instrumentId,
        },
        { $unset: { foundingIpoUnderwritingPending: "" }, $set: { updatedAt: now } }
      );
      result.aborted++;
    } else {
      result.pending++;
    }
  }
  return result;
}

/** Resume durable funded-buildup leases even when the feature flag was disabled. */
export async function resumePrimaryUnderwritingLeases(
  db: Db,
  turn: number
): Promise<Array<{ key: string; error?: string }>> {
  const corporations = db.collection<Corporation>("corporations");
  const banks = await corporations
    .find({ "bankUnderwritingFunding.turn": { $lt: turn } })
    .sort({ "bankUnderwritingFunding.turn": 1 })
    .limit(200)
    .project<
      Pick<
        Corporation,
        | "_id"
        | "name"
        | "countryId"
        | "liquidCurrencyCode"
        | "bankCharter"
        | "bankUnderwritingFunding"
      >
    >({
      _id: 1,
      name: 1,
      countryId: 1,
      liquidCurrencyCode: 1,
      bankCharter: 1,
      bankUnderwritingFunding: 1,
    })
    .toArray();
  if (banks.length === 0) return [];
  const issuerIds = [
    ...new Map(
      banks
        .map((bank) => bank.bankUnderwritingFunding?.issuerCorporationId)
        .filter((id): id is ObjectId => id instanceof ObjectId)
        .map((id) => [id.toHexString(), id])
    ).values(),
  ];
  const issuers = await corporations
    .find({ _id: { $in: issuerIds } })
    .project<Pick<Corporation, "_id" | "name" | "countryId" | "liquidCurrencyCode">>({
      _id: 1,
      name: 1,
      countryId: 1,
      liquidCurrencyCode: 1,
    })
    .toArray();
  const issuerById = new Map(issuers.map((issuer) => [issuer._id.toHexString(), issuer]));
  const resumed: Array<{ key: string; error?: string }> = [];
  for (const bank of banks) {
    const lease = bank.bankUnderwritingFunding;
    if (!lease) continue;
    const issuer = issuerById.get(lease.issuerCorporationId.toHexString());
    if (!issuer || !bank.bankCharter || !lease.instrumentId) {
      resumed.push({ key: lease.key, error: "Underwriting lease lost a required party or term" });
      continue;
    }
    try {
      const result = await settlePrimaryUnderwritingFill(db, {
        bank: {
          _id: bank._id,
          name: bank.name,
          countryId: bank.countryId,
          liquidCurrencyCode: bank.liquidCurrencyCode,
          bankCharter: bank.bankCharter,
        },
        issuer,
        issuerCurrencyCode: lease.currencyCode,
        offer: lease.offer,
        instrumentId: lease.instrumentId,
        grossPlacedLocal: lease.grossLocal,
        turn: lease.turn,
        now: new Date(),
        poolCollection: lease.poolCollection,
        instrumentProjection: lease.instrumentProjection,
      });
      if (result.status !== "applied" && result.status !== "replayed") {
        resumed.push({ key: lease.key, error: result.error ?? `settlement ${result.status}` });
      } else {
        resumed.push({ key: lease.key });
      }
    } catch (error) {
      resumed.push({
        key: lease.key,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return resumed;
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
    .collection<{ _id: string }>(MONEY_MOVE_COLLECTION)
    .findOne({ _id: key }, { projection: { _id: 1 } });
  if (priorClaim) return resumeSettlement(db, key);

  const quote = quotePrimaryUnderwritingFee({
    grossPlacedLocal: input.grossPlacedLocal,
    feeRate: offer.feeRate,
  });
  const issuerSnapshot = capturePrimaryUnderwritingCurrencySnapshot(issuer);
  const bankSnapshot = capturePrimaryUnderwritingCurrencySnapshot(bank);
  if (
    quote.grossPlacedLocal <= 0 ||
    !bank._id.equals(offer.bankCorporationId) ||
    !issuer._id.equals(offer.issuerCorporationId) ||
    input.issuerCurrencyCode !== offer.currencyCode ||
    offer.issuerCurrencySnapshot.currencyCode !== offer.currencyCode ||
    offer.bankCurrencySnapshot.currencyCode !== offer.currencyCode ||
    !issuerSnapshot ||
    !bankSnapshot ||
    !sameCurrencySnapshot(issuerSnapshot, offer.issuerCurrencySnapshot) ||
    !sameCurrencySnapshot(bankSnapshot, offer.bankCurrencySnapshot) ||
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
    issuerName: issuer.name,
    instrumentType: offer.instrumentType,
    instrumentId,
    charteredTurn: offer.charteredTurn,
    offer,
    currencyCode: offer.currencyCode,
    grossLocal: quote.grossPlacedLocal,
    feeLocal: quote.feeLocal,
    issuerNetLocal: quote.issuerNetLocal,
    turn,
    poolCollection: input.poolCollection,
    instrumentProjection: input.instrumentProjection,
  } as const;
  const corporations = db.collection<Corporation>("corporations");
  const acquired = await corporations.updateOne(
    {
      _id: bank._id,
      ...recipientCurrencySnapshotFilter(offer.bankCurrencySnapshot),
      "bankCharter.status": "active",
      "bankCharter.resolutionClaimedTurn": { $exists: false },
      bankCharterTransfer: { $exists: false },
      "bankCharter.type": { $in: ["investment", "universal"] },
      "bankCharter.currency": offer.currencyCode,
      "bankCharter.charteredTurn": offer.charteredTurn,
      bankConstructionFunding: { $exists: false },
      bankPrimaryFunding: { $exists: false },
      bankUnderwritingFunding: { $exists: false },
    },
    { $set: { bankUnderwritingFunding: lease, updatedAt: now } }
  );
  let frozenLease: typeof lease = lease;
  if (acquired.matchedCount !== 1) {
    const current = await corporations.findOne(
      { _id: bank._id, "bankUnderwritingFunding.key": key },
      { projection: { bankUnderwritingFunding: 1 } }
    );
    const currentLease = current?.bankUnderwritingFunding;
    if (
      currentLease?.key === key &&
      currentLease.instrumentId?.equals(instrumentId) &&
      currentLease.instrumentProjection &&
      currentLease.offer
    ) {
      // The durable lease is the recovery plan for a crash between lease and
      // journal claim. Ignore any newly computed quote or publication payload.
      frozenLease = currentLease as typeof lease;
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

  const issuerLeaseAcquired = await acquireIssuerUnderwritingReceiptLease(
    db,
    issuer._id,
    key,
    frozenLease.offer,
    frozenLease.turn,
    now
  );
  if (!issuerLeaseAcquired) {
    await corporations.updateOne(
      { _id: bank._id, "bankUnderwritingFunding.key": key },
      { $unset: { bankUnderwritingFunding: "" }, $set: { updatedAt: now } }
    );
    return {
      status: "rejected",
      key,
      appliedLegs: [],
      appliedProjections: [],
      newlyAppliedProjections: [],
      error: "Issuer native currency is busy or has changed",
    };
  }

  const frozenQuote = {
    grossPlacedLocal: frozenLease.grossLocal,
    feeLocal: frozenLease.feeLocal,
    issuerNetLocal: frozenLease.issuerNetLocal,
  };
  const pool = { _id: frozenLease.currencyCode };
  const receipt = {
    key,
    issuerCorporationId: frozenLease.issuerCorporationId,
    issuerName: frozenLease.issuerName,
    instrumentType: frozenLease.instrumentType,
    instrumentId: frozenLease.instrumentId,
    currencyCode: frozenLease.currencyCode,
    grossPlacedLocal: frozenQuote.grossPlacedLocal,
    feeLocal: frozenQuote.feeLocal,
    issuerNetLocal: frozenQuote.issuerNetLocal,
    turn: frozenLease.turn,
    charteredTurn: frozenLease.charteredTurn,
  };
  const transition: BankingTransition = {
    key,
    kind: "bank.primary_underwriting",
    turn: frozenLease.turn,
    currency: frozenLease.currencyCode,
    legs: [
      {
        kind: "debit",
        amount: frozenQuote.grossPlacedLocal,
        collection: frozenLease.poolCollection,
        filter: pool,
        path: "cashLocal",
        set: { updatedAt: now },
        note: "Currency pool funds actually placed primary units",
      },
      {
        kind: "credit",
        amount: frozenQuote.issuerNetLocal,
        collection: "corporations",
        filter: {
          _id: oid(frozenLease.issuerCorporationId.toHexString()),
          "primaryUnderwritingIncomingFunding.key": key,
          ...recipientCurrencySnapshotFilter(frozenLease.offer.issuerCurrencySnapshot),
        },
        path: "liquidCapital",
        note: "Issuer receives net primary proceeds",
      },
      {
        kind: "credit",
        amount: frozenQuote.feeLocal,
        collection: "corporations",
        filter: {
          _id: oid(bank._id.toHexString()),
          "bankUnderwritingFunding.key": key,
          ...recipientCurrencySnapshotFilter(frozenLease.offer.bankCurrencySnapshot),
        },
        path: "bankCharter.cashReserves",
        note: "Underwriter receives the funded fee in its charter currency reserve",
      },
    ],
    projections: [
      {
        collection: frozenLease.poolCollection,
        filter: pool,
        update: {
          $inc: { "lifetime.issuanceOut": frozenQuote.grossPlacedLocal },
          $set: { updatedAt: now },
        },
        note: "Reconcile primary issuance pool ledger",
      },
      frozenLease.instrumentProjection,
      {
        collection: "corporations",
        filter: { _id: oid(bank._id.toHexString()), "bankUnderwritingFunding.key": key },
        pipelineUpdate: [
          {
            $set: {
              [`bankUnderwritingIncomeByCurrency.${frozenLease.currencyCode}`]: {
                $add: [
                  {
                    $ifNull: [`$bankUnderwritingIncomeByCurrency.${frozenLease.currencyCode}`, 0],
                  },
                  frozenQuote.feeLocal,
                ],
              },
              bankUnderwritingReceipts: {
                $slice: [
                  {
                    $concatArrays: [{ $ifNull: ["$bankUnderwritingReceipts", []] }, [receipt]],
                  },
                  -100,
                ],
              },
              "bankCharter.lastBankingIncome": {
                $cond: [
                  { $eq: ["$bankCharter.lastBankingIncomeTurn", frozenLease.turn] },
                  {
                    $add: [
                      { $ifNull: ["$bankCharter.lastBankingIncome", 0] },
                      frozenQuote.feeLocal,
                    ],
                  },
                  frozenQuote.feeLocal,
                ],
              },
              "bankCharter.lastBankingUnderwritingFees": {
                $cond: [
                  { $eq: ["$bankCharter.lastBankingUnderwritingFeesTurn", frozenLease.turn] },
                  {
                    $add: [
                      { $ifNull: ["$bankCharter.lastBankingUnderwritingFees", 0] },
                      frozenQuote.feeLocal,
                    ],
                  },
                  frozenQuote.feeLocal,
                ],
              },
              "bankCharter.lastBankingIncomeTurn": frozenLease.turn,
              "bankCharter.lastBankingUnderwritingFeesTurn": frozenLease.turn,
              updatedAt: now,
            },
          },
        ],
        note: "Record actual funded underwriting fee receipt",
      },
      {
        collection: "corporations",
        filter: {
          _id: oid(frozenLease.issuerCorporationId.toHexString()),
          "primaryUnderwritingIncomingFunding.key": key,
        },
        update: { $unset: { primaryUnderwritingIncomingFunding: "" }, $set: { updatedAt: now } },
        note: "Release issuer native-currency hold after placement ACK",
      },
      {
        collection: "corporations",
        filter: { _id: oid(bank._id.toHexString()), "bankUnderwritingFunding.key": key },
        update: { $unset: { bankUnderwritingFunding: "" }, $set: { updatedAt: now } },
        note: "Release original charter epoch lease after all placement ACKs",
      },
    ],
    event: {
      kind: "underwriting.funded",
      command: "bank.primary.underwrite",
      subjectType: "corporation",
      subjectId: frozenLease.issuerCorporationId.toHexString(),
      amount: frozenQuote.feeLocal,
      meta: {
        instrumentType: frozenLease.instrumentType,
        instrumentId: frozenLease.instrumentId!.toHexString(),
        grossPlacedLocal: frozenQuote.grossPlacedLocal,
        issuerNetLocal: frozenQuote.issuerNetLocal,
        bankId: bank._id.toHexString(),
        charteredTurn: frozenLease.charteredTurn,
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
      { _id: issuer._id, "primaryUnderwritingIncomingFunding.key": key },
      { $unset: { primaryUnderwritingIncomingFunding: "" }, $set: { updatedAt: now } }
    );
    await corporations.updateOne(
      { _id: bank._id, "bankUnderwritingFunding.key": key },
      { $unset: { bankUnderwritingFunding: "" }, $set: { updatedAt: now } }
    );
  }
  return settled;
}
