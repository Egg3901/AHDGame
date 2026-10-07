/**
 * Queued NPP redemption payouts settled together.
 *
 * Paying each queued NPP redemption through its own durable money move cost
 * about 30 round trips, so a pass could only afford a few hundred claims while
 * NPP rebalancing queued thousands per cycle and the queue grew without bound.
 * A batch pays the same claims, at the same pro-rata amounts and in the same
 * order, through one receipt: one fund debit, one credit per NPP, and every
 * member's own receipts.
 *
 * Each member is frozen first with its exact payout (`payoutBatch`), so the
 * journal receipt is the single authority: once it lands, the members close
 * from their frozen values, whether in this pass or in a later recovery.
 */
import { randomUUID } from "node:crypto";
import type { Db, Document, ObjectId } from "mongodb";
import type { IndexFund, IndexFundRedemptionStatus } from "@/lib/db/types";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { MONEY_MOVE_COLLECTION } from "@/lib/banking/moneyMove";
import { resumeSettlement, settleTransition } from "@/lib/banking/settlementJournal";
import type { BankingTransition, TransitionProjection } from "@/lib/banking/rules/boundary";
import { redemptionEntryStatusAfterPayout } from "./fundRedemptionQueue";
import {
  payoutReceiptDocs,
  payoutReceiptIds,
  type ClaimedRedemption,
  type QueuedPayoutAuditContext,
} from "./queuedPayoutSettlement";

const QUEUE = "indexFundRedemptionQueue";

/** Members per batch receipt. Bounds the journal record and its receipt writes. */
export const QUEUED_PAYOUT_BATCH_MAX = 250;

/** The exact payout a batch member was frozen with. */
export interface PayoutBatchMarker {
  key: string;
  paidAmount: number;
  units: number;
  remainingUnits: number;
  nav: number;
  priorPaid: number;
  priorStatus: IndexFundRedemptionStatus;
}

export interface PayoutBatchMember {
  entry: ClaimedRedemption;
  claimId: string;
  paidAmount: number;
  units: number;
  remainingUnits: number;
  nav: number;
  holder: Document;
  nppCurrency: CurrencyCode;
}

type MarkedEntry = Pick<ClaimedRedemption, "_id" | "nppId" | "processingTurn"> & {
  payoutBatch: PayoutBatchMarker;
};

type BatchJournalRecord = {
  _id: string;
  status: string;
  currency?: string;
  compensationKey?: string;
  legs: {
    kind: string;
    amount: number;
    collection?: string;
    filter?: Record<string, unknown>;
    applied?: boolean;
    refusal?: string;
  }[];
  projections?: { projection: TransitionProjection }[];
};

/**
 * A queued payout can join a batch when it is an NPP claim whose units left
 * the fund at request time: its credit is the anchor amount itself (no FX
 * legs) and its debit carries no unit-supply guard.
 */
export function isBatchablePayout(entry: ClaimedRedemption): boolean {
  return (
    entry.holderKind === "npp" &&
    entry.nppId !== undefined &&
    entry.characterId === undefined &&
    entry.imperialCharacterId === undefined &&
    entry.unitsBurnedAtRequest === true
  );
}

function landed(result: { status: string; error?: string }) {
  return result.status === "applied" || (result.status === "replayed" && !result.error);
}

/** One balanced receipt: the fund pays the sum, each NPP receives its own sum. */
function batchPlan(
  fund: IndexFund,
  members: PayoutBatchMember[],
  key: string,
  turn: number,
  audit: QueuedPayoutAuditContext
): BankingTransition {
  const now = new Date();
  const credits = new Map<string, { id: ObjectId; amount: number }>();
  const fundRows: Record<string, unknown>[] = [];
  const financialRows: Record<string, unknown>[] = [];
  const ledgerRows: Record<string, unknown>[] = [];
  const auditRows: Record<string, unknown>[] = [];
  let total = 0;
  for (const member of members) {
    const nppId = member.entry.nppId!;
    total += member.paidAmount;
    const credit = credits.get(String(nppId)) ?? { id: nppId, amount: 0 };
    credit.amount += member.paidAmount;
    credits.set(String(nppId), credit);
    const receipts = payoutReceiptDocs({
      fund,
      entry: member.entry,
      receiptKey: `${key}:${member.entry._id}`,
      settlementKey: key,
      holderId: nppId,
      holder: member.holder,
      credit: member.paidAmount,
      paidAmount: member.paidAmount,
      units: member.units,
      remainingUnits: member.remainingUnits,
      nav: member.nav,
      turn,
      audit,
      nppCurrency: member.nppCurrency,
      now,
    });
    fundRows.push(receipts.fund);
    financialRows.push(receipts.financial);
    ledgerRows.push(...receipts.ledger);
    if (receipts.audit) auditRows.push(receipts.audit);
  }
  const projections: TransitionProjection[] = [
    { collection: "indexFundTransactions", inserts: fundRows, note: "Fund payout receipts" },
    { collection: "financialTxLog", inserts: financialRows, note: "Cash witnesses" },
    ...(ledgerRows.length
      ? [{ collection: "ledgerEntries", inserts: ledgerRows, note: "Payout ledger witnesses" }]
      : []),
    ...(auditRows.length
      ? [{ collection: "actionAuditLog", inserts: auditRows, note: "Queued payout audits" }]
      : []),
  ];
  return {
    key,
    kind: "fund_queued_redemption_batch",
    turn,
    currency: fund.anchorCurrencyCode,
    legs: [
      {
        kind: "debit",
        amount: total,
        collection: "indexFunds",
        path: "cashAnchor",
        filter: { _id: fund._id },
        note: "Queued NPP payouts, paid together",
      },
      ...[...credits.values()].map((credit) => ({
        kind: "credit" as const,
        amount: credit.amount,
        collection: "npps",
        path: "nppInvestmentCashAnchor",
        filter: { _id: credit.id },
        note: "This NPP's queued payouts",
      })),
    ],
    projections,
    event: {
      kind: "prop.traded",
      command: "fund_queued_redemption_batch",
      amount: total,
      meta: { fundId: String(fund._id), members: members.length },
    },
  };
}

/** Close members the landed receipt paid. Idempotent: the marker is removed with the close. */
async function closeMembers(db: Db, key: string, members: MarkedEntry[]) {
  if (!members.length) return;
  const now = new Date();
  await db.collection(QUEUE).bulkWrite(
    members.map(({ _id, payoutBatch: m }) => ({
      updateOne: {
        filter: { _id, status: "processing", "payoutBatch.key": key },
        update: {
          $set: {
            status: redemptionEntryStatusAfterPayout(m.remainingUnits),
            units: m.remainingUnits,
            paidAmountAnchor: m.priorPaid + m.paidAmount,
            requestedAmountAnchor: m.remainingUnits * m.nav,
            updatedAt: now,
          },
          $unset: { processingStartedAt: "", payoutBatch: "" },
        },
      },
    })),
    { ordered: false }
  );
}

/** Return members whose cash never moved to the queue, unchanged. */
async function releaseMembers(db: Db, key: string, members: MarkedEntry[]) {
  if (!members.length) return;
  await db.collection(QUEUE).bulkWrite(
    members.map(({ _id, payoutBatch: m }) => ({
      updateOne: {
        filter: { _id, "payoutBatch.key": key },
        update: {
          $set: { status: m.priorStatus },
          $unset: {
            settlementClaimId: "",
            payoutBatch: "",
            processingStartedAt: "",
            processingTurn: "",
          },
        },
      },
    })),
    { ordered: false }
  );
}

async function rejectedWithoutCash(db: Db, key: string) {
  const record = await db
    .collection<BatchJournalRecord>(MONEY_MOVE_COLLECTION)
    .findOne({ _id: key }, { projection: { status: 1, legs: 1 } });
  return record?.status === "rejected" && record.legs.every((leg) => !leg.applied);
}

/**
 * Credits the batch can no longer deliver: the fund debit landed, and each
 * undelivered credit was refused, lost its NPP mid-pass ("no target"), or was
 * never attempted because an earlier one stopped delivery. Returns undefined
 * when any undelivered target still holds an in-flight receipt for this
 * move: that credit may have landed, so only reconciliation may decide.
 */
async function undeliverableCredits(db: Db, record: BatchJournalRecord) {
  const debit = record.legs.find((leg) => leg.kind === "debit");
  if (record.status !== "partial" || !debit?.applied || debit.collection !== "indexFunds")
    return undefined;
  const open = record.legs.filter((leg) => leg.kind === "credit" && !leg.applied);
  if (!open.length || open.some((leg) => leg.collection !== "npps")) return undefined;
  const inFlight = await db.collection("npps").countDocuments({
    _id: { $in: open.map((leg) => leg.filter?._id) },
    "pendingMoneyMoveReceipt.key": record._id,
  } as Document);
  return inFlight ? undefined : open;
}

/**
 * Settle a batch whose credits cannot all be delivered (an NPP disappeared
 * mid-pass). Return the undelivered amount to the fund, publish the receipts
 * of the members that were paid, and close the original receipt so its
 * undelivered legs are never retried; then close the paid members and release
 * the unpaid ones, which stay owed. Every step is keyed, so a crash anywhere
 * replays to the same end.
 */
async function compensateRefusals(
  db: Db,
  record: BatchJournalRecord,
  members: MarkedEntry[],
  turn: number
): Promise<number> {
  const refused = new Map<string, number>();
  for (const leg of record.legs) {
    if (leg.kind !== "credit" || leg.applied) continue;
    const id = String(leg.filter?._id);
    refused.set(id, (refused.get(id) ?? 0) + leg.amount);
  }
  const debit = record.legs.find((leg) => leg.kind === "debit")!;
  const paid = members.filter((m) => !refused.has(String(m.nppId)));
  const unpaid = members.filter((m) => refused.has(String(m.nppId)));
  const keep = new Set(paid.flatMap((m) => payoutReceiptIds(`${record._id}:${m._id}`)));
  const receipts = (record.projections ?? []).flatMap(({ projection }) => {
    const rows = (projection.inserts ?? []).filter((row) => keep.has(String(row._id)));
    return rows.length ? [{ ...projection, inserts: rows }] : [];
  });
  const amount = [...refused.values()].reduce((sum, value) => sum + value, 0);
  const refund: BankingTransition = {
    key: `${record._id}:refund`,
    kind: "fund_redemption_refund",
    turn,
    currency: record.currency ?? "USD",
    legs: [
      {
        kind: "credit",
        amount,
        collection: "indexFunds",
        filter: { _id: debit.filter?._id },
        path: "cashAnchor",
        note: "Return the refused NPP payouts to the fund",
      },
      { kind: "mint", amount, note: "Contra for the undelivered part of the original debit" },
    ],
    projections: [
      ...receipts,
      {
        collection: MONEY_MOVE_COLLECTION,
        filter: { _id: record._id },
        update: {
          $set: {
            status: "rejected",
            error: "Refused batch credits compensated",
            compensationKey: `${record._id}:refund`,
          },
        },
        note: "Close the batch once refused cash is back and paid receipts are published",
      },
    ],
    event: { kind: "prop.traded", command: "fund_redemption_refund" },
  };
  let settled = await settleTransition(db, refund);
  if (settled.status === "replayed" && settled.error)
    settled = await resumeSettlement(db, refund.key);
  if (!landed(settled))
    throw new Error(settled.error ?? `Queued payout batch ${record._id} refund is incomplete`);
  await closeMembers(db, record._id, paid);
  await releaseMembers(db, record._id, unpaid);
  return paid.length;
}

/** Finish a batch from its journal receipt and close or release its members. */
async function conclude(
  db: Db,
  key: string,
  members: MarkedEntry[],
  result: { status: string; error?: string },
  turn: number
): Promise<number> {
  if (landed(result)) {
    await closeMembers(db, key, members);
    return members.length;
  }
  if (result.status === "rejected" && (await rejectedWithoutCash(db, key))) {
    await releaseMembers(db, key, members);
    return 0;
  }
  const record = await db
    .collection<BatchJournalRecord>(MONEY_MOVE_COLLECTION)
    .findOne({ _id: key });
  // Already compensated: replay the refund and the member updates.
  if (record?.compensationKey) return compensateRefusals(db, record, members, turn);
  if (record && (await undeliverableCredits(db, record)))
    return compensateRefusals(db, record, members, turn);
  throw new Error(result.error ?? `Queued payout batch ${key} requires recovery`);
}

/**
 * Pay claimed, frozen-amount NPP payouts through one receipt. Returns how many
 * members were paid. Members whose claim was lost to recovery are left alone.
 */
export async function settleQueuedPayoutBatch(
  db: Db,
  input: {
    fund: IndexFund;
    members: PayoutBatchMember[];
    turn: number;
    audit: QueuedPayoutAuditContext;
  }
): Promise<number> {
  const valid = input.members.filter(
    (m) =>
      isBatchablePayout(m.entry) &&
      Number.isFinite(m.paidAmount) &&
      m.paidAmount > 0 &&
      Number.isFinite(m.nav) &&
      m.nav > 0
  );
  if (!valid.length) return 0;
  const key = `fund-redemption-batch:${input.fund._id}:${randomUUID()}`;
  const markers = valid.map((m) => ({
    member: m,
    marker: {
      key,
      paidAmount: m.paidAmount,
      units: m.units,
      remainingUnits: m.remainingUnits,
      nav: m.nav,
      priorPaid: m.entry.paidAmountAnchor ?? 0,
      priorStatus: m.entry.status,
    } satisfies PayoutBatchMarker,
  }));
  const queue = db.collection<ClaimedRedemption & { payoutBatch?: PayoutBatchMarker }>(QUEUE);
  const frozen = await queue.bulkWrite(
    markers.map(({ member, marker }) => ({
      updateOne: {
        filter: {
          _id: member.entry._id,
          status: "processing",
          settlementClaimId: member.claimId,
          payoutPlan: { $exists: false },
          payoutBatch: { $exists: false },
        },
        update: { $set: { payoutBatch: marker } },
      },
    })),
    { ordered: false }
  );
  let members = markers;
  if (frozen.modifiedCount !== markers.length) {
    const ids = new Set(
      (
        await queue
          .find(
            { _id: { $in: markers.map((m) => m.member.entry._id) }, "payoutBatch.key": key },
            { projection: { _id: 1 } }
          )
          .toArray()
      ).map((row) => String(row._id))
    );
    members = markers.filter((m) => ids.has(String(m.member.entry._id)));
  }
  if (!members.length) return 0;
  const plan = batchPlan(
    input.fund,
    members.map((m) => m.member),
    key,
    input.turn,
    input.audit
  );
  const result = await settleTransition(db, plan);
  return conclude(
    db,
    key,
    members.map((m) => ({
      _id: m.member.entry._id,
      nppId: m.member.entry.nppId,
      processingTurn: m.member.entry.processingTurn,
      payoutBatch: m.marker,
    })),
    result,
    input.turn
  );
}

/**
 * Recover batch members a crashed pass left processing. A receipt that exists
 * is finished and its members closed or released from it. A receipt that was
 * never written moved no cash, so members claimed in an earlier turn go back
 * to the queue; this turn's are left for the next turn, matching single
 * payouts, in case the claiming pass is still running.
 */
export async function recoverPayoutBatches(
  db: Db,
  entries: MarkedEntry[],
  turn: number
): Promise<{ changed: boolean; recovered: number }> {
  const byKey = new Map<string, MarkedEntry[]>();
  for (const entry of entries) {
    const list = byKey.get(entry.payoutBatch.key) ?? [];
    list.push(entry);
    byKey.set(entry.payoutBatch.key, list);
  }
  let changed = false;
  let recovered = 0;
  if (!byKey.size) return { changed, recovered };
  const written = new Set(
    (
      await db
        .collection<BatchJournalRecord>(MONEY_MOVE_COLLECTION)
        .find({ _id: { $in: [...byKey.keys()] } }, { projection: { _id: 1 } })
        .toArray()
    ).map((row) => row._id)
  );
  for (const [key, members] of byKey) {
    if (!written.has(key)) {
      const stale = members.filter(
        (m) => m.processingTurn !== undefined && m.processingTurn < turn
      );
      await releaseMembers(db, key, stale);
      changed ||= stale.length > 0;
      continue;
    }
    const result = await resumeSettlement(db, key);
    recovered += await conclude(db, key, members, result, turn);
    changed = true;
  }
  return { changed, recovered };
}
