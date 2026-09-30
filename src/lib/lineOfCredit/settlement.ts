/** LOC cash, debt and the original income event share one durable character receipt. */
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { ObjectId, type Db, type Document } from "mongodb";
import type { Character } from "@/lib/db/types";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { getCountryIdForCurrency } from "@/lib/constants/currencies";
import { getBankId } from "@/lib/centralBank/helpers";
import { MONEY_MOVE_COLLECTION, SETTLED_KEYS_CAP } from "@/lib/banking/moneyMove";
import type { SettlementResult } from "@/lib/banking/settlementJournal";
import type { LocLedgerEntry } from "@/lib/db/types/locLedger";
import type { TxInput } from "@/lib/financialTxLog/emit";
import { buildTxDocs, loadAnchorRateMap, loadTxThresholds } from "@/lib/financialTxLog/emit";
import { loadTurnLengthMinutes } from "@/lib/financialTxLog/expiresAt";
import { deriveLedgerEntries } from "@/lib/ledger/deriveFromTx";
import { finalizeLedgerEntry } from "@/lib/ledger/emit";
import { checkBalancedTransfer, type ValueLeg } from "@/lib/banking/rules/invariants";
import { prepareServiceEffect } from "./serviceSettlement";
import {
  acquireLocBookAdmission,
  releaseLocBookAdmission,
  validateLocDrawAdmission,
} from "./bookAdmission";

export interface LocEffect {
  locAfter?: Character["lineOfCredit"];
  walletInc: Record<string, number>;
  reserves: Array<{
    bankId: string;
    increments: Record<string, number>;
    createIfMissing?: boolean;
  }>;
  ledger: Omit<LocLedgerEntry, "_id" | "createdAt">[];
  transactions: Omit<TxInput, "createdAt">[];
  /** Currency-qualified original flows, including mint/burn and FX conversion. */
  flows: Array<{ currency: string; kind: string; amount: number; note: string }>;
  result: Record<string, unknown>;
}
export interface LocPlan {
  characterId: ObjectId;
  expectedLoc?: Character["lineOfCredit"];
  expectedRevision: number | null;
  /** Original FX quote; capacity is revalidated under the bank publication guard. */
  drawAdmission?: { bankId: string; addInternal: number; exchangeRate: number };
  request: Record<string, unknown>;
  effect: LocEffect;
  createdAt: Date;
  extraRecords?: Array<{ collection: "tradeHistory"; document: Document }>;
  service?: import("./serviceSettlement").ServiceIntent;
  prepared?: boolean;
  records?: Array<{ collection: string; document: Document }>;
}
interface LocRecord extends Document {
  _id: string;
  kind: "line_of_credit";
  turn: number;
  status: string;
  locSettlement: LocPlan;
  locAdmissionRejected?: string;
  locAdmissionDecision?: { error: string | null };
}
export const locReceiptId = (key: string, suffix: string) =>
  new ObjectId(createHash("sha256").update(`${key}:${suffix}`).digest("hex").slice(0, 24));

export async function loadLocSettlement(db: Db, key: string) {
  return db
    .collection<LocRecord>(MONEY_MOVE_COLLECTION)
    .findOne({ _id: key, kind: "line_of_credit" });
}

async function recordsFor(db: Db, key: string, plan: LocPlan) {
  for (const currency of new Set(plan.effect.flows.map((flow) => flow.currency))) {
    const flows = plan.effect.flows.filter((flow) => flow.currency === currency);
    if (
      flows.some(
        (flow) =>
          !["debit", "credit", "mint", "burn"].includes(flow.kind) ||
          !Number.isFinite(flow.amount) ||
          flow.amount < 0
      ) ||
      checkBalancedTransfer(flows as ValueLeg[], key).length
    )
      throw new Error(`Unbalanced original LOC cash flows in ${currency}`);
  }

  const entries = plan.effect.transactions.map((entry) => ({
    ...entry,
    createdAt: plan.createdAt,
  }));
  const [thresholds, cadence, rates, config] = await Promise.all([
    loadTxThresholds(db),
    loadTurnLengthMinutes(db),
    loadAnchorRateMap(db, entries),
    db
      .collection("gameConfig")
      .findOne({ _id: "default" as never }, { projection: { ledgerShadow: 1 } }),
  ]);
  const tx = buildTxDocs(entries, thresholds, cadence, rates).map((entry, i) => ({
    ...entry,
    _id: locReceiptId(key, `tx:${i}`),
  }));
  const ledger =
    config?.ledgerShadow === true
      ? deriveLedgerEntries(tx, "lineOfCredit/settlement").map((entry, i) => ({
          ...finalizeLedgerEntry(entry),
          _id: locReceiptId(key, `shadow:${i}`),
        }))
      : [];
  return [
    ...(plan.extraRecords ?? []),
    ...plan.effect.ledger.map((entry, i) => ({
      collection: "locLedger",
      document: { ...entry, _id: locReceiptId(key, `loc:${i}`), createdAt: plan.createdAt },
    })),
    ...tx.map((document) => ({ collection: "financialTxLog", document })),
    ...ledger.map((document) => ({ collection: "ledgerEntries", document })),
  ];
}

/** Claim the original quote. A retry with a changed request is never a new command. */
export async function settleLocPlan(db: Db, key: string, turn: number, plan: LocPlan) {
  const journal = db.collection<LocRecord>(MONEY_MOVE_COLLECTION);
  let original = await loadLocSettlement(db, key);
  if (!original) {
    if (
      Object.entries(plan.effect.walletInc).some(
        ([path, delta]) =>
          !/^currencyBalances\.(personal|savings)\.[A-Z]{3}$/.test(path) || !Number.isFinite(delta)
      )
    )
      throw new Error("Invalid LOC cash projection");
    if (!plan.service) plan.records = await recordsFor(db, key, plan);
    try {
      await journal.insertOne({
        _id: key,
        kind: "line_of_credit",
        turn,
        status: "partial",
        locSettlement: plan,
        legs: plan.effect.flows.map((flow) => ({ ...flow, applied: false })),
        createdAt: plan.createdAt,
      });
    } catch (error) {
      if (!(typeof error === "object" && error && "code" in error && error.code === 11000))
        throw error;
    }
    original = await loadLocSettlement(db, key);
  }
  if (!original || !isDeepStrictEqual(original.locSettlement.request, plan.request))
    throw new Error("LOC command identity already belongs to a different request");
  const settled = await resumeLocSettlement(db, key);
  return { ...settled, result: (await loadLocSettlement(db, key))!.locSettlement.effect.result };
}

/** Resume only stored debt/cash and aftercare; never reprice the accepted operation. */
export async function resumeLocSettlement(db: Db, key: string): Promise<SettlementResult> {
  const journal = db.collection<LocRecord>(MONEY_MOVE_COLLECTION);
  const record = await loadLocSettlement(db, key);
  const result: SettlementResult = {
    key,
    status: "rejected",
    appliedLegs: [],
    appliedProjections: [],
    newlyAppliedProjections: [],
  };
  if (!record) return { ...result, error: "LOC settlement not found" };
  if (record.status === "applied") return { ...result, status: "replayed" };
  if (record.status === "rejected")
    return { ...result, error: String(record.error ?? "LOC quote changed") };
  if (record.locSettlement.service && !record.locSettlement.prepared) {
    const effect = await prepareServiceEffect(db, key, record.turn, record.locSettlement);
    const next = { ...record.locSettlement, effect, prepared: true };
    next.records = await recordsFor(db, key, next);
    await journal.updateOne(
      { _id: key, "locSettlement.prepared": { $ne: true } },
      {
        $set: {
          locSettlement: next,
          legs: effect.flows.map((flow) => ({ ...flow, applied: false })),
        },
      }
    );
    return resumeLocSettlement(db, key);
  }
  const plan = record.locSettlement,
    receipt = `${key}:character`;
  const chars = db.collection<
    Character & { lineOfCreditRevision?: number; settledKeys?: string[] }
  >("characters");
  await acquireLocBookAdmission(db, key, plan);
  const reject = async (error: string) => {
    await journal.updateOne({ _id: key }, { $set: { locAdmissionRejected: error } });
    await releaseLocBookAdmission(db, key, plan);
    await journal.updateOne({ _id: key }, { $set: { status: "rejected", error } });
    return { ...result, error };
  };
  if (record.locAdmissionRejected) return reject(record.locAdmissionRejected);
  let delivered = !!(await chars.findOne(
    { _id: plan.characterId, settledKeys: receipt },
    { projection: { _id: 1 } }
  ));
  if (!delivered) {
    if (plan.drawAdmission) {
      let decision = (await loadLocSettlement(db, key))?.locAdmissionDecision;
      if (!decision) {
        const error = await validateLocDrawAdmission(db, plan);
        await journal.updateOne(
          { _id: key, locAdmissionDecision: { $exists: false } },
          { $set: { locAdmissionDecision: { error } } }
        );
        decision = (await loadLocSettlement(db, key))?.locAdmissionDecision;
      }
      if (!decision) throw new Error("Credit admission decision remains pending");
      if (decision.error) return reject(decision.error);
    }
    const guard: Record<string, unknown> = { _id: plan.characterId, settledKeys: { $ne: receipt } };
    if (plan.expectedLoc !== undefined) {
      guard.lineOfCredit = plan.expectedLoc;
      guard.lineOfCreditRevision = plan.expectedRevision ?? { $exists: false };
    }
    for (const [path, delta] of Object.entries(plan.effect.walletInc))
      if (delta < 0) guard[path] = { $gte: -delta };
    const write = await chars.updateOne(guard, {
      $inc: {
        ...plan.effect.walletInc,
        ...(plan.effect.locAfter ? { lineOfCreditRevision: 1 } : {}),
      },
      $set: {
        ...(plan.effect.locAfter ? { lineOfCredit: plan.effect.locAfter } : {}),
        updatedAt: plan.createdAt,
      },
      $push: { settledKeys: { $each: [receipt], $slice: -SETTLED_KEYS_CAP } },
    });
    delivered =
      write.matchedCount === 1 ||
      !!(await chars.findOne(
        { _id: plan.characterId, settledKeys: receipt },
        { projection: { _id: 1 } }
      ));
    if (!delivered) {
      const error = "Your line of credit or wallet changed before credit settlement";
      return reject(error);
    }
  }
  for (const [i, credit] of plan.effect.reserves.entries()) {
    const stamp = `${key}:reserve:${i}`;
    const banks = db.collection<{ _id: string; settledKeys?: string[] }>("centralBanks");
    if (credit.createIfMissing)
      await banks.updateOne(
        { _id: credit.bankId },
        { $setOnInsert: { _id: credit.bankId } },
        { upsert: true }
      );
    const write = await banks.updateOne(
      { _id: credit.bankId, settledKeys: { $ne: stamp } },
      {
        $inc: credit.increments,
        $push: { settledKeys: { $each: [stamp], $slice: -SETTLED_KEYS_CAP } },
      }
    );
    if (
      write.matchedCount !== 1 &&
      !(await banks.findOne({ _id: credit.bankId, settledKeys: stamp }))
    )
      throw new Error(
        "LOC interest reserve destination is unavailable; settlement remains pending"
      );
  }
  for (const row of plan.records ?? []) {
    const target = db.collection(row.collection);
    await target.updateOne(
      { _id: row.document._id },
      { $setOnInsert: row.document },
      { upsert: true }
    );
    if (!isDeepStrictEqual(await target.findOne({ _id: row.document._id }), row.document))
      throw new Error("LOC receipt conflicts with the accepted settlement");
  }
  if (plan.request.operation === "garnish") {
    const { executeMarketMakerTrade } = await import("@/lib/currency/marketMaker");
    const home = plan.effect.result.home as CurrencyCode;
    for (const [currency, amount] of Object.entries(
      plan.effect.result.conversions as Record<string, number>
    )) {
      if (currency === home || amount <= 0) continue;
      await executeMarketMakerTrade(db, {
        characterId: plan.characterId,
        countryId: plan.effect.result.countryId as import("@/lib/constants/countries").CountryId,
        fromCurrency: currency as CurrencyCode,
        toCurrency: home,
        amount,
        turn: record.turn,
        source: plan.request.source === "bond_coupon" ? "auto_coupon" : "auto_dividend",
        sourceRef: key,
        commandId: `${key}:${currency}:${home}`,
      });
    }
  }
  await releaseLocBookAdmission(db, key, plan);
  await journal.updateOne(
    { _id: key },
    {
      $set: {
        status: "applied",
        completedAt: new Date(),
        projectionsCompletedAt: new Date(),
        legs: plan.effect.flows.map((flow) => ({ ...flow, applied: true })),
      },
      $unset: { error: "" },
    }
  );
  return { ...result, status: "applied", appliedLegs: plan.effect.flows.map((_, i) => i) };
}

export function locInterestCredits(amounts: Partial<Record<CurrencyCode, number>>) {
  return Object.entries(amounts)
    .filter(([, amount]) => (amount ?? 0) > 0)
    .map(([currency, amount]) => ({
      bankId: getBankId(getCountryIdForCurrency(currency as CurrencyCode)),
      increments: { reserveBalance: amount! },
    }));
}

/** Prioritize durable bank owners, then the indexed queue, within one fixed budget. */
export async function recoverPendingLoc(db: Db, turn: number) {
  const journal = db.collection<LocRecord>(MONEY_MOVE_COLLECTION);
  const owners = await db
    .collection<{ _id: string; pendingLocBookMutationId?: string }>("centralBanks")
    .find(
      { pendingLocBookMutationId: { $exists: true } },
      { projection: { pendingLocBookMutationId: 1 } }
    )
    .limit(50)
    .toArray();
  const owned = owners.length
    ? await journal
        .find(
          {
            _id: { $in: owners.map((bank) => bank.pendingLocBookMutationId!) },
            status: "partial",
            kind: "line_of_credit",
          },
          { projection: { _id: 1 } }
        )
        .limit(50)
        .toArray()
    : [];
  const records = await journal
    .find(
      { status: "partial", kind: "line_of_credit", turn: { $lt: turn } },
      { projection: { _id: 1 } }
    )
    .sort({ createdAt: 1 })
    .limit(50)
    .toArray();
  const keys = [...new Set([...owned, ...records].map((record) => record._id))].slice(0, 50);
  const failed: string[] = [];
  for (const key of keys) {
    try {
      await resumeLocSettlement(db, key);
    } catch (error) {
      failed.push(key);
      await journal.updateOne(
        { _id: key, status: "partial" },
        {
          $set: {
            error: error instanceof Error ? error.message : "LOC recovery remains pending",
            recoveryAttemptTurn: turn,
          },
        }
      );
    }
  }
  return { attempted: keys.length, failed };
}
