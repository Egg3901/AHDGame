/**
 * Advertising agreement persistence shell (issue #2235).
 *
 * Standalone-Mongo design: every mutation is a single-document write, no
 * sessions, no transactions. Propose is one insertOne; accept/counter/cancel
 * are conditional updateOne calls that match the expected revision/status,
 * so a replayed request either succeeds idempotently or fails closed with a
 * conflict instead of forking the negotiation. Expiry and cancellation
 * finalization are turn-driven updateMany passes with status preconditions.
 */
import { ObjectId, type Db } from "mongodb";
import {
  AD_AGREEMENT_BUDGET_BPS,
  AD_AGREEMENT_CANCEL_NOTICE_TURNS,
  AD_AGREEMENT_DURATION_MAX_TURNS,
  AD_AGREEMENT_DURATION_MIN_TURNS,
  AD_AGREEMENT_INDEX_BUYER_STATUS,
  AD_AGREEMENT_INDEX_PARTIES,
  AD_AGREEMENT_MIN_SHARE_BPS,
  AD_SETTLEMENT_INDEX_CORP_TURN,
  ADVERTISING_AGREEMENTS_COLLECTION,
  ADVERTISING_SETTLEMENTS_COLLECTION,
  type AdvertisingAgreement,
  type AdvertisingAgreementOffer,
  type AdvertisingSettlement,
} from "./types";

export type ProposeAdvertisingAgreementResult =
  | { ok: true; agreement: AdvertisingAgreement }
  | {
      ok: false;
      reason: "feature_disabled" | "self_contract" | "invalid_share" | "invalid_duration";
    };

export type UpdateAdvertisingAgreementResult =
  | { ok: true; agreement: AdvertisingAgreement; idempotent?: boolean }
  | {
      ok: false;
      reason:
        | "not_found"
        | "not_party"
        | "not_counterparty"
        | "not_pending"
        | "stale_offer"
        | "invalid_share"
        | "invalid_duration"
        | "allocation_exceeds_budget"
        | "already_closed";
    };

function isValidShareBps(share: unknown): share is number {
  return (
    typeof share === "number" &&
    Number.isInteger(share) &&
    share >= AD_AGREEMENT_MIN_SHARE_BPS &&
    share <= AD_AGREEMENT_BUDGET_BPS
  );
}

function isValidDuration(duration: unknown): duration is number {
  return (
    typeof duration === "number" &&
    Number.isInteger(duration) &&
    duration >= AD_AGREEMENT_DURATION_MIN_TURNS &&
    duration <= AD_AGREEMENT_DURATION_MAX_TURNS
  );
}

function latestOffer(agreement: AdvertisingAgreement): AdvertisingAgreementOffer | null {
  if (agreement.currentOffer) return agreement.currentOffer;
  const history = agreement.offers;
  const last = history?.[history.length - 1];
  return last ?? null;
}

function makeOffer(args: {
  revision: number;
  proposedByCorpId: string;
  allocationShareBps: number;
  durationTurns?: number;
  proposedAtTurn?: number;
  proposedAt: Date;
}): AdvertisingAgreementOffer {
  return {
    revision: args.revision,
    proposedByCorpId: args.proposedByCorpId,
    allocationShareBps: args.allocationShareBps,
    ...(args.durationTurns !== undefined ? { durationTurns: args.durationTurns } : {}),
    ...(args.proposedAtTurn !== undefined ? { proposedAtTurn: args.proposedAtTurn } : {}),
    proposedAt: args.proposedAt,
  };
}

/**
 * Plain single-collection createIndex calls: no sessions, no transactions,
 * safe on standalone Mongo.
 */
export async function ensureAdvertisingAgreementIndexes(db: Db): Promise<string[]> {
  const agreements = db.collection(ADVERTISING_AGREEMENTS_COLLECTION);
  const settlements = db.collection(ADVERTISING_SETTLEMENTS_COLLECTION);
  await agreements.createIndex(
    { buyerCorpId: 1, supplierCorpId: 1, status: 1 },
    { name: AD_AGREEMENT_INDEX_PARTIES }
  );
  await agreements.createIndex(
    { buyerCorpId: 1, status: 1, expiresAtTurn: 1 },
    { name: AD_AGREEMENT_INDEX_BUYER_STATUS }
  );
  await settlements.createIndex(
    { corporationId: 1, turn: -1 },
    { name: AD_SETTLEMENT_INDEX_CORP_TURN, unique: true }
  );
  return [
    AD_AGREEMENT_INDEX_PARTIES,
    AD_AGREEMENT_INDEX_BUYER_STATUS,
    AD_SETTLEMENT_INDEX_CORP_TURN,
  ];
}

export interface ProposeAdvertisingAgreementArgs {
  enabled: boolean;
  buyerCorpId: string;
  supplierCorpId: string;
  proposedByCorpId: string;
  allocationShareBps: number;
  durationTurns?: number;
  turn: number;
  now?: Date;
}

/**
 * Opens a negotiation with a single insertOne. Each call opens a distinct
 * negotiation (no idempotency key): a retried POST the caller cannot
 * de-duplicate is closed by cancelling, never by forking state.
 */
export async function proposeAdvertisingAgreementPersistent(
  db: Db,
  args: ProposeAdvertisingAgreementArgs
): Promise<ProposeAdvertisingAgreementResult> {
  if (!args.enabled) return { ok: false, reason: "feature_disabled" };
  if (args.buyerCorpId === args.supplierCorpId) return { ok: false, reason: "self_contract" };
  if (!isValidShareBps(args.allocationShareBps)) return { ok: false, reason: "invalid_share" };
  if (args.durationTurns !== undefined && !isValidDuration(args.durationTurns)) {
    return { ok: false, reason: "invalid_duration" };
  }
  const now = args.now ?? new Date();
  // String _id (products pattern): keeps filters working with plain hex
  // strings on standalone Mongo, with no ObjectId juggling at call sites.
  const id = new ObjectId().toHexString();
  const openingOffer = makeOffer({
    revision: 1,
    proposedByCorpId: args.proposedByCorpId,
    allocationShareBps: args.allocationShareBps,
    ...(args.durationTurns !== undefined ? { durationTurns: args.durationTurns } : {}),
    proposedAtTurn: args.turn,
    proposedAt: now,
  });
  const doc: AdvertisingAgreement = {
    _id: id,
    buyerCorpId: args.buyerCorpId,
    supplierCorpId: args.supplierCorpId,
    allocationShareBps: args.allocationShareBps,
    ...(args.durationTurns !== undefined ? { durationTurns: args.durationTurns } : {}),
    status: "pending",
    proposedByCorpId: args.proposedByCorpId,
    currentOffer: openingOffer,
    offers: [openingOffer],
    createdAt: now,
    updatedAt: now,
  };
  const collection = db.collection<AdvertisingAgreement>(ADVERTISING_AGREEMENTS_COLLECTION);
  await collection.insertOne(doc as never);
  return { ok: true, agreement: doc };
}

export interface UpdateAdvertisingAgreementArgs {
  agreementId: string;
  corpId: string;
  action: "accept" | "counter" | "cancel";
  allocationShareBps?: number;
  durationTurns?: number;
  turn: number;
  now?: Date;
  /**
   * Buyer's already-committed active shares (bps), loaded by the caller.
   * Accept is rejected when it would oversubscribe the marketing budget.
   * Concurrent accepts can still race; settlement normalizes the remainder.
   */
  buyerCommittedShareBps?: number;
}

/**
 * Accept, counter, or cancel. Accept/counter are restricted to the
 * counterparty of the current offer; either party may cancel. All writes
 * match the expected revision/status so replays are idempotent-or-conflict,
 * never forks.
 */
export async function updateAdvertisingAgreementPersistent(
  db: Db,
  args: UpdateAdvertisingAgreementArgs
): Promise<UpdateAdvertisingAgreementResult> {
  const collection = db.collection<AdvertisingAgreement>(ADVERTISING_AGREEMENTS_COLLECTION);
  const agreement = await collection.findOne({ _id: args.agreementId } as never);
  if (!agreement) return { ok: false, reason: "not_found" };

  const isBuyer = agreement.buyerCorpId === args.corpId;
  const isSupplier = agreement.supplierCorpId === args.corpId;
  if (!isBuyer && !isSupplier) return { ok: false, reason: "not_party" };

  const now = args.now ?? new Date();
  const offer = latestOffer(agreement);
  if (!offer) return { ok: false, reason: "stale_offer" };

  if (args.action === "cancel") {
    if (agreement.status === "cancelled" || agreement.status === "expired") {
      return { ok: true, agreement, idempotent: true };
    }
    if (agreement.status === "cancelling") {
      return { ok: true, agreement, idempotent: true };
    }
    if (agreement.status === "pending") {
      const cancelled = await collection.updateOne(
        { _id: args.agreementId, status: "pending" } as never,
        { $set: { status: "cancelled", updatedAt: now } } as never
      );
      if (cancelled.matchedCount === 0) {
        const current = await collection.findOne({ _id: args.agreementId } as never);
        return current
          ? { ok: true, agreement: current, idempotent: true }
          : { ok: false, reason: "not_found" };
      }
      const current = await collection.findOne({ _id: args.agreementId } as never);
      return current ? { ok: true, agreement: current } : { ok: false, reason: "not_found" };
    }
    if (agreement.status === "active") {
      const effectiveTurn = args.turn + AD_AGREEMENT_CANCEL_NOTICE_TURNS;
      const cancelling = await collection.updateOne(
        { _id: args.agreementId, status: "active" } as never,
        {
          $set: {
            status: "cancelling",
            cancelEffectiveTurn: effectiveTurn,
            updatedAt: now,
          },
        } as never
      );
      if (cancelling.matchedCount === 0) {
        const current = await collection.findOne({ _id: args.agreementId } as never);
        return current
          ? { ok: true, agreement: current, idempotent: true }
          : { ok: false, reason: "not_found" };
      }
      const current = await collection.findOne({ _id: args.agreementId } as never);
      return current ? { ok: true, agreement: current } : { ok: false, reason: "not_found" };
    }
    return { ok: false, reason: "already_closed" };
  }

  if (agreement.status !== "pending") return { ok: false, reason: "not_pending" };
  if (offer.proposedByCorpId === args.corpId) {
    return { ok: false, reason: "not_counterparty" };
  }

  if (args.action === "accept") {
    const share = offer.allocationShareBps;
    if (!isValidShareBps(share)) return { ok: false, reason: "invalid_share" };
    const committed = args.buyerCommittedShareBps ?? 0;
    if (committed + share > AD_AGREEMENT_BUDGET_BPS) {
      return { ok: false, reason: "allocation_exceeds_budget" };
    }
    const durationTurns = offer.durationTurns;
    if (durationTurns !== undefined && !isValidDuration(durationTurns)) {
      return { ok: false, reason: "invalid_duration" };
    }
    const accepted = await collection.updateOne(
      {
        _id: args.agreementId,
        status: "pending",
        "currentOffer.revision": offer.revision,
      } as never,
      {
        $set: {
          allocationShareBps: share,
          status: "active",
          startsAtTurn: args.turn,
          ...(durationTurns !== undefined
            ? { durationTurns, expiresAtTurn: args.turn + durationTurns }
            : {}),
          updatedAt: now,
        },
      } as never
    );
    if (accepted.matchedCount === 0) return { ok: false, reason: "stale_offer" };
    const current = await collection.findOne({ _id: args.agreementId } as never);
    return current ? { ok: true, agreement: current } : { ok: false, reason: "not_found" };
  }

  // Counter: the counterparty replaces the offer with a new revision.
  if (args.allocationShareBps === undefined || !isValidShareBps(args.allocationShareBps)) {
    return { ok: false, reason: "invalid_share" };
  }
  if (args.durationTurns !== undefined && !isValidDuration(args.durationTurns)) {
    return { ok: false, reason: "invalid_duration" };
  }
  const nextOffer = makeOffer({
    revision: offer.revision + 1,
    proposedByCorpId: args.corpId,
    allocationShareBps: args.allocationShareBps,
    ...(args.durationTurns !== undefined ? { durationTurns: args.durationTurns } : {}),
    proposedAtTurn: args.turn,
    proposedAt: now,
  });
  const countered = await collection.updateOne(
    {
      _id: args.agreementId,
      status: "pending",
      "currentOffer.revision": offer.revision,
    } as never,
    {
      $set: {
        allocationShareBps: nextOffer.allocationShareBps,
        ...(nextOffer.durationTurns !== undefined
          ? { durationTurns: nextOffer.durationTurns }
          : {}),
        proposedByCorpId: args.corpId,
        currentOffer: nextOffer,
        updatedAt: now,
      },
      $push: { offers: nextOffer },
    } as never
  );
  if (countered.matchedCount === 0) return { ok: false, reason: "stale_offer" };
  const current = await collection.findOne({ _id: args.agreementId } as never);
  return current ? { ok: true, agreement: current } : { ok: false, reason: "not_found" };
}

/** Agreements settling on the given turn (active or cancelling, in window). */
export async function getSettlingAdvertisingAgreements(db: Db): Promise<AdvertisingAgreement[]> {
  const collection = db.collection<AdvertisingAgreement>(ADVERTISING_AGREEMENTS_COLLECTION);
  return collection.find({ status: { $in: ["active", "cancelling"] } } as never).toArray();
}

/** Every agreement touching one corporation, newest first. */
export async function getAdvertisingAgreementsForCorp(
  db: Db,
  corpId: string
): Promise<AdvertisingAgreement[]> {
  const collection = db.collection<AdvertisingAgreement>(ADVERTISING_AGREEMENTS_COLLECTION);
  return collection
    .find({ $or: [{ buyerCorpId: corpId }, { supplierCorpId: corpId }] } as never)
    .toArray();
}

/** Sum of active settling shares committed against one buyer's budget. */
export async function getBuyerCommittedShareBps(
  db: Db,
  buyerCorpId: string,
  turn: number
): Promise<number> {
  const collection = db.collection<AdvertisingAgreement>(ADVERTISING_AGREEMENTS_COLLECTION);
  const active = await collection
    .find({ buyerCorpId, status: { $in: ["active", "cancelling"] } } as never)
    .toArray();
  return active
    .filter(
      (a) =>
        (a.expiresAtTurn === undefined || turn < a.expiresAtTurn) &&
        (a.status !== "cancelling" ||
          a.cancelEffectiveTurn === undefined ||
          turn < a.cancelEffectiveTurn)
    )
    .reduce((sum, a) => sum + a.allocationShareBps, 0);
}

/**
 * Turn-driven lifecycle finalization: expire fixed terms and close served
 * notices. Status preconditions make every transition idempotent; a replayed
 * turn matches nothing and writes nothing.
 */
export async function finalizeAdvertisingAgreementLifecycle(
  db: Db,
  turn: number
): Promise<{ expired: number; cancelled: number }> {
  const collection = db.collection<AdvertisingAgreement>(ADVERTISING_AGREEMENTS_COLLECTION);
  const now = new Date();
  const expired = await collection.updateMany(
    { status: "active", expiresAtTurn: { $lte: turn } } as never,
    { $set: { status: "expired", updatedAt: now } } as never
  );
  const cancelled = await collection.updateMany(
    { status: "cancelling", cancelEffectiveTurn: { $lte: turn } } as never,
    { $set: { status: "cancelled", updatedAt: now } } as never
  );
  return { expired: expired.modifiedCount ?? 0, cancelled: cancelled.modifiedCount ?? 0 };
}

/** Idempotent per-corporation per-turn settlement write (upsert by corp+turn). */
export async function upsertAdvertisingSettlement(
  db: Db,
  settlement: Omit<AdvertisingSettlement, "_id" | "updatedAt">
): Promise<void> {
  const collection = db.collection<AdvertisingSettlement>(ADVERTISING_SETTLEMENTS_COLLECTION);
  await collection.updateOne(
    { corporationId: settlement.corporationId, turn: settlement.turn } as never,
    {
      $set: { ...settlement, updatedAt: new Date() },
    } as never,
    { upsert: true }
  );
}

/** Latest settlement for one corporation, if any. */
export async function getLatestAdvertisingSettlement(
  db: Db,
  corporationId: string
): Promise<AdvertisingSettlement | null> {
  const collection = db.collection<AdvertisingSettlement>(ADVERTISING_SETTLEMENTS_COLLECTION);
  const rows = await collection
    .find({ corporationId } as never, { sort: { turn: -1 }, limit: 1 } as never)
    .toArray();
  return rows[0] ?? null;
}

/** Operating models owned by any of the given corporations (one bulk read). */
export async function listOperatingModelsForCorps(
  db: Db,
  corporationIds: readonly string[]
): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (corporationIds.length === 0) return out;
  const collection = db.collection<{
    corporationId: string;
    operatingModel: string;
  }>("corporationOperatingModels");
  const rows = await collection
    .find(
      { corporationId: { $in: [...corporationIds] } } as never,
      {
        projection: { corporationId: 1, operatingModel: 1 },
      } as never
    )
    .toArray();
  for (const row of rows) {
    const list = out.get(row.corporationId) ?? [];
    if (!list.includes(row.operatingModel)) list.push(row.operatingModel);
    out.set(row.corporationId, list);
  }
  return out;
}
