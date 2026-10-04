/** Queued redemptions freeze cash, units and receipts before either balance changes. */
import { createHash } from "node:crypto";
import { ObjectId, type Db, type Document, type Filter } from "mongodb";
import type { GameConfig, IndexFund, IndexFundRedemptionQueueEntry } from "@/lib/db/types";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { buildPersonalBalanceInc } from "@/lib/currency/characterFunds";
import { buildTxDocs, loadTxThresholds, type TxInput } from "@/lib/financialTxLog/emit";
import { loadTurnLengthMinutes } from "@/lib/financialTxLog/expiresAt";
import { finalizeLedgerEntry } from "@/lib/ledger/emit";
import { resolveLedgerTurn } from "@/lib/ledger/ledgerTurn";
import { deriveLedgerEntries } from "@/lib/ledger/deriveFromTx";
import { MONEY_MOVE_COLLECTION } from "@/lib/banking/moneyMove";
import { resumeSettlement, settleTransition } from "@/lib/banking/settlementJournal";
import type { BankingTransition } from "@/lib/banking/rules/boundary";
import { prepareAuditRecord } from "@/lib/audit/recordAudit";
import { redemptionEntryStatusAfterPayout } from "./fundRedemptionQueue";

const QUEUE = "indexFundRedemptionQueue";
type PayoutJournalRecord = {
  _id: string;
  status: string;
  legs: { applied: boolean; refusal?: string }[];
};
export type ClaimedRedemption = IndexFundRedemptionQueueEntry & {
  settlementClaimId?: string;
  processingTurn?: number;
  payoutPlan?: BankingTransition & { legacyUnitsBurned?: number };
};
export async function loadQueuedPayoutAuditContext(db: Db) {
  const [thresholds, turnLength, config, ledgerTurn] = await Promise.all([
    loadTxThresholds(db),
    loadTurnLengthMinutes(db),
    db.collection<GameConfig>("gameConfig").findOne({ _id: "default" }),
    resolveLedgerTurn(db),
  ]);
  return {
    thresholds,
    turnLength,
    shadow: config?.ledgerShadow === true,
    auditEnabled: config?.auditLog !== false,
    /** The turn whose closing snapshot holds cash settled under this context (#3022). */
    ledgerTurn,
  };
}
type AuditContext = Awaited<ReturnType<typeof loadQueuedPayoutAuditContext>>;
function receiptId(key: string, kind: string) {
  return new ObjectId(createHash("sha256").update(`${key}:${kind}`).digest("hex").slice(0, 24));
}
async function finish(db: Db, plan: BankingTransition) {
  const result = await settleTransition(db, plan);
  return result.status === "replayed" && result.error ? resumeSettlement(db, plan.key) : result;
}

/** Only a recorded credit refusal permits compensation; an unknown acknowledgement never does. */
async function refundRefusedPayout(db: Db, entry: ClaimedRedemption): Promise<boolean> {
  const plan = entry.payoutPlan!;
  const record = await db
    .collection<PayoutJournalRecord>(MONEY_MOVE_COLLECTION)
    .findOne({ _id: plan.key });
  if (!record?.legs?.[0]?.applied || !record?.legs?.[1]?.refusal) return false;
  const amount = plan.legs[0].amount;
  const units = entry.payoutPlan?.legacyUnitsBurned ?? 0;
  const refund: BankingTransition = {
    key: `${plan.key}:refund`,
    kind: "fund_redemption_refund",
    turn: plan.turn,
    currency: plan.currency,
    legs: [
      {
        kind: "credit",
        amount,
        collection: "indexFunds",
        filter: { _id: entry.fundId },
        path: "cashAnchor",
        note: "Return the refused payout's original debit",
      },
      { kind: "mint", amount, note: "Contra for reversal of the original undelivered debit" },
    ],
    projections: [
      ...(units > 0
        ? [
            {
              collection: "indexFunds",
              filter: { _id: entry.fundId },
              update: { $inc: { unitSupply: units } },
              note: "Restore legacy units burned with the refused debit",
            },
          ]
        : []),
      {
        collection: MONEY_MOVE_COLLECTION,
        filter: { _id: plan.key, "legs.0.applied": true, "legs.1.refusal": { $exists: true } },
        update: {
          $set: {
            status: "rejected",
            error: "Refused payout compensated",
            compensationKey: `${plan.key}:refund`,
          },
        },
        note: "Close the original refusal only after cash and legacy units are restored",
      },
      {
        collection: QUEUE,
        filter: { _id: entry._id, settlementClaimId: entry.settlementClaimId },
        update: {
          $set: {
            status: entry.paidAmountAnchor > 0 ? "partial" : "queued",
            updatedAt: new Date(),
          },
          $unset: {
            processingStartedAt: "",
            processingTurn: "",
          },
        },
        note: "Release this compensated claim without changing the unpaid obligation",
      },
    ],
    event: { kind: "prop.traded", command: "fund_redemption_refund" },
  };
  const result = await finish(db, refund);
  if (result.error || !["applied", "replayed"].includes(result.status)) return false;
  return true;
}

async function rejectedWithoutCash(db: Db, key: string) {
  const record = await db
    .collection<PayoutJournalRecord>(MONEY_MOVE_COLLECTION)
    .findOne({ _id: key }, { projection: { status: 1, legs: 1 } });
  return (
    record?.status === "rejected" && record.legs.every((leg: { applied: boolean }) => !leg.applied)
  );
}

/** Old marker-less processing rows remain untouched; their cash outcome cannot be inferred. */
const recoveryFilter: Filter<ClaimedRedemption> = {
  settlementClaimId: { $exists: true },
  $or: [{ status: "processing" }, { pendingSettlementProjection: { $exists: true } }],
};
export async function recoverQueuedPayouts(db: Db, fundId: ObjectId, turn: number) {
  const entries = await db
    .collection<ClaimedRedemption>(QUEUE)
    .find({ fundId, ...recoveryFilter })
    .toArray();
  return recoverPayoutEntries(db, entries, turn);
}
/** The ordinary cron recovers every frozen payout before pricing any fund. */
export async function recoverAllQueuedPayouts(db: Db, turn: number) {
  const entries = await db.collection<ClaimedRedemption>(QUEUE).find(recoveryFilter).toArray();
  return recoverPayoutEntries(db, entries, turn);
}
async function recoverPayoutEntries(db: Db, entries: ClaimedRedemption[], turn: number) {
  let changed = false,
    recovered = 0;
  for (const entry of entries) {
    if (entry.payoutPlan) {
      const result = await finish(db, entry.payoutPlan);
      if (!result.error && ["applied", "replayed"].includes(result.status)) {
        changed = true;
        if (result.newlyAppliedProjections.includes(entry.payoutPlan.projections.length - 1))
          recovered++;
      } else if (await refundRefusedPayout(db, entry)) changed = true;
      else if (
        result.status === "rejected" &&
        (await rejectedWithoutCash(db, entry.payoutPlan.key))
      ) {
        await db.collection(QUEUE).updateOne(
          { _id: entry._id, settlementClaimId: entry.settlementClaimId },
          {
            $set: { status: entry.paidAmountAnchor > 0 ? "partial" : "queued" },
            $unset: {
              settlementClaimId: "",
              payoutPlan: "",
              processingStartedAt: "",
              processingTurn: "",
            },
          }
        );
        changed = true;
      } else throw new Error(result.error ?? "Queued payout requires reconciliation");
      continue;
    }
    // No financial write can start until this exact claim freezes its plan.
    // Clearing the token fences a suspended worker from publishing a late plan.
    if (entry.processingTurn !== undefined && entry.processingTurn < turn) {
      const released = await db.collection(QUEUE).updateOne(
        {
          _id: entry._id,
          status: "processing",
          settlementClaimId: entry.settlementClaimId,
          payoutPlan: { $exists: false },
          processingTurn: entry.processingTurn,
        },
        {
          $set: { status: entry.paidAmountAnchor > 0 ? "partial" : "queued" },
          $unset: { settlementClaimId: "", processingStartedAt: "", processingTurn: "" },
        }
      );
      changed ||= released.matchedCount > 0;
    }
  }
  return { changed, recovered };
}

export async function settleQueuedPayout(
  db: Db,
  input: {
    fund: IndexFund;
    entry: ClaimedRedemption;
    claimId: string;
    paidAmount: number;
    paidNative: number;
    units: number;
    remainingUnits: number;
    nav: number;
    turn: number;
    forexEnabled: boolean;
    nppCurrency: CurrencyCode;
    audit: AuditContext;
    holder: Document | undefined;
  }
): Promise<boolean> {
  const { fund, entry, claimId, paidAmount, paidNative, units, remainingUnits, nav, turn, audit } =
    input;
  const holderId = entry.characterId ?? entry.imperialCharacterId ?? entry.nppId;
  if (!holderId) return false;
  const collection = entry.characterId
    ? "characters"
    : entry.imperialCharacterId
      ? "imperialCharacters"
      : "npps";
  const holder = input.holder;
  if (!holder) return false;
  const npp = collection === "npps";
  const credit = npp ? paidAmount : paidNative;
  const path = npp
    ? "nppInvestmentCashAnchor"
    : Object.keys(buildPersonalBalanceInc(credit, fund.anchorCurrencyCode, input.forexEnabled))[0];
  const now = new Date(),
    key = `fund-redemption:${entry._id}:${claimId}`;
  const txId = receiptId(key, "fund");
  const tx: TxInput = {
    type: "index_fund_redeem",
    turn,
    createdAt: now,
    subjectType: npp ? "npp" : "character",
    subjectId: holderId,
    subjectName: npp ? `NPP ${holderId}` : String(holder.name ?? "Fund holder"),
    amount: credit,
    anchorAmount: paidAmount,
    currencyCode: npp ? input.nppCurrency : fund.anchorCurrencyCode,
    counterpartyType: "system",
    counterpartyName: fund.name,
    meta: {
      fundId: String(fund._id),
      fundName: fund.name,
      fundSlug: fund.slug,
      fundTicker: fund.tickerSymbol,
      fundCurrency: fund.anchorCurrencyCode,
      units,
      navAnchor: nav,
      source: "cron_queue",
      queuedRemainder: remainingUnits,
      settlementKey: key,
      ...(entry.imperialCharacterId ? { imperial: true } : {}),
    },
  };
  const [financial] = buildTxDocs([tx], audit.thresholds, audit.turnLength, new Map());
  financial._id = txId;
  const burnUnits = entry.unitsBurnedAtRequest !== true;
  const plan: BankingTransition & { legacyUnitsBurned: number } = {
    key,
    kind: "fund_queued_redemption",
    turn,
    currency: fund.anchorCurrencyCode,
    legacyUnitsBurned: burnUnits ? units : 0,
    legs: [
      {
        kind: "debit",
        amount: paidAmount,
        collection: "indexFunds",
        path: "cashAnchor",
        filter: { _id: fund._id, ...(burnUnits ? { unitSupply: fund.unitSupply } : {}) },
        ...(burnUnits ? { set: { unitSupply: fund.unitSupply - units } } : {}),
        note: "Queued payout and legacy unit burn",
      },
      {
        kind: "credit",
        amount: credit,
        collection,
        path,
        filter: { _id: holderId },
        note: "Original quoted holder payout",
      },
      // The existing FX conversion is frozen, not repriced on recovery.
      ...(credit !== paidAmount
        ? [
            {
              kind: "burn" as const,
              amount: paidAmount,
              note: "Anchor side of the frozen fund-to-wallet conversion",
            },
            {
              kind: "mint" as const,
              amount: credit,
              note: "Native side of the same frozen conversion",
            },
          ]
        : []),
    ],
    projections: [
      {
        collection: "indexFundTransactions",
        insert: {
          _id: txId,
          fundId: fund._id,
          kind: "redemption",
          holderKind: entry.holderKind,
          ...(entry.characterId ? { characterId: entry.characterId } : {}),
          ...(entry.imperialCharacterId ? { imperialCharacterId: entry.imperialCharacterId } : {}),
          ...(entry.nppId ? { nppId: entry.nppId } : {}),
          units,
          navAnchor: nav,
          amountAnchor: paidAmount,
          note: "Paid from queued redemption",
          createdAt: now,
        },
        note: "Original fund payout receipt",
      },
      {
        collection: "financialTxLog",
        insert: { ...financial },
        note: "Original native and anchor cash witness",
      },
      ...(audit.shadow
        ? deriveLedgerEntries([financial]).map((row, index) => ({
            collection: "ledgerEntries",
            insert: {
              ...finalizeLedgerEntry({ ...row, turn: audit.ledgerTurn ?? row.turn }),
              _id: receiptId(key, `ledger:${index}`),
            },
            note: "Original payout ledger witness",
          }))
        : []),
      ...(audit.auditEnabled
        ? [
            {
              collection: "actionAuditLog",
              insert: {
                ...prepareAuditRecord(
                  {
                    source: "system",
                    action: "fund.sell",
                    category: "money",
                    subject: {
                      type: npp ? "npp" : "character",
                      id: holderId,
                      name: tx.subjectName,
                    },
                    amount: credit,
                    anchorAmount: paidAmount,
                    currencyCode: tx.currencyCode,
                    meta: tx.meta,
                    refs: { financialTxLogId: txId },
                    outcome: "ok",
                  },
                  { turn, ts: now, turnLengthMinutes: audit.turnLength }
                ),
                _id: receiptId(key, "audit"),
              },
              note: "Original queued payout action audit",
            },
          ]
        : []),
      {
        collection: QUEUE,
        filter: { _id: entry._id, status: "processing", settlementClaimId: claimId },
        update: {
          $set: {
            status: redemptionEntryStatusAfterPayout(remainingUnits),
            units: remainingUnits,
            paidAmountAnchor: (entry.paidAmountAnchor ?? 0) + paidAmount,
            requestedAmountAnchor: remainingUnits * nav,
            updatedAt: now,
          },
          $unset: { processingStartedAt: "" },
        },
        note: "Finalize the original queue obligation after every cash and receipt leg",
      },
    ],
    event: { kind: "prop.traded", command: "fund_queued_redemption" },
  };
  if (
    !Number.isFinite(credit) ||
    credit <= 0 ||
    !Number.isFinite(paidAmount) ||
    paidAmount <= 0 ||
    (burnUnits && (!Number.isFinite(fund.unitSupply) || fund.unitSupply < units))
  )
    return false;
  const frozen = await db.collection<ClaimedRedemption>(QUEUE).findOneAndUpdate(
    {
      _id: entry._id,
      status: "processing",
      settlementClaimId: claimId,
      payoutPlan: { $exists: false },
    },
    { $set: { payoutPlan: plan } },
    { returnDocument: "after" }
  );
  if (!frozen?.payoutPlan) return false;
  const result = await finish(db, frozen.payoutPlan);
  if (result.error || !["applied", "replayed"].includes(result.status)) {
    if (result.status === "rejected" && (await rejectedWithoutCash(db, frozen.payoutPlan.key))) {
      await db.collection(QUEUE).updateOne(
        { _id: entry._id, settlementClaimId: claimId },
        {
          $set: { status: entry.status },
          $unset: {
            settlementClaimId: "",
            payoutPlan: "",
            processingStartedAt: "",
            processingTurn: "",
          },
        }
      );
      return false;
    }
    if (await refundRefusedPayout(db, frozen)) return false;
    throw new Error(result.error ?? "Queued payout requires recovery");
  }
  return true;
}
