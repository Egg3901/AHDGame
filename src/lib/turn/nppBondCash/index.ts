/**
 * NPP bond returns credit investment cash, keeping coupon and principal witnesses
 * separate. Atomic stamps identify landed writes, including partial failures.
 */
import * as Sentry from "@sentry/nextjs";
import { ObjectId, type Db, type AnyBulkWriteOperation, type Document } from "mongodb";
import { COUNTRY_CURRENCY_MAP, type CurrencyCode } from "@/lib/constants/currencies";
import type { CountryId } from "@/lib/constants/countries";
import { accountId, mintSinkAccount } from "@/lib/ledger/accounts";
import { isLedgerShadowEnabled } from "@/lib/ledger/featureFlag";
import { isAnchorBalanced } from "@/lib/ledger/epsilon";
import type { LedgerEntry, LedgerEntryInput } from "@/lib/ledger/types";
import { roundedNppBondReturns } from "./rules";

export interface NppBondReturns {
  total: number;
  coupon: number;
  maturity: number;
}

export interface NppBondCashWitness {
  nppId: ObjectId;
  key: string;
  entries: Array<{ id: ObjectId; entry: LedgerEntryInput }>;
}

/** Publish only atomically stamped credits. Repeating publication adds no entry. */
export async function flushNppBondCashWitnesses(db: Db, pending: NppBondCashWitness[]) {
  if (pending.length === 0) return;
  try {
    const rows = await db
      .collection<{ _id: ObjectId; nppBondCashWitnessKey?: string }>("npps")
      .find(
        {
          _id: { $in: pending.map((p) => p.nppId) },
          nppBondCashWitnessKey: { $in: pending.map((p) => p.key) },
        },
        { projection: { nppBondCashWitnessKey: 1 } }
      )
      .toArray();
    const landed = new Map(rows.map((r) => [r._id.toHexString(), r.nppBondCashWitnessKey]));
    const entries = pending
      .filter((p) => landed.get(p.nppId.toHexString()) === p.key)
      .flatMap((p) => p.entries);
    if (entries.length === 0) return;
    await db.collection<LedgerEntry>("ledgerEntries").bulkWrite(
      entries.map(({ id, entry }) => ({
        updateOne: {
          filter: { _id: id },
          update: { $setOnInsert: { ...entry, _id: id, balanced: isAnchorBalanced(entry.legs) } },
          upsert: true,
        },
      })),
      { ordered: false }
    );
  } catch (error) {
    Sentry.captureException(error, { extra: { phase: "flushNppBondCashWitnesses" } });
  }
}

/** Keep the existing cash operation; stamp its observer in the same Mongo update. */
export async function payNppBondReturns(
  db: Db,
  payments: ReadonlyMap<string, NppBondReturns>,
  turn: number,
  now: Date
) {
  if (payments.size === 0) return;
  const shadow = await isLedgerShadowEnabled();
  const recipients = shadow
    ? await db
        .collection<{ _id: ObjectId; countryId?: CountryId }>("npps")
        .find(
          { _id: { $in: [...payments.keys()].map((id) => new ObjectId(id)) } },
          { projection: { countryId: 1 } }
        )
        .toArray()
    : [];
  const countryById = new Map(recipients.map((r) => [r._id.toHexString(), r.countryId]));
  const operations: AnyBulkWriteOperation<Document>[] = [];
  const pending: NppBondCashWitness[] = [];
  for (const [id, amounts] of payments) {
    const nppId = new ObjectId(id);
    const rounded = roundedNppBondReturns(amounts.total, amounts.coupon);
    const set: Document = { updatedAt: now };
    if (shadow && countryById.has(id) && rounded.total > 0) {
      const currency: CurrencyCode = COUNTRY_CURRENCY_MAP[countryById.get(id) ?? "US"] ?? "USD";
      const key = new ObjectId().toHexString();
      set.nppBondCashWitnessKey = key;
      const entries: NppBondCashWitness["entries"] = [];
      for (const [kind, amount] of [
        ["coupon", rounded.couponAnchor],
        ["maturity", rounded.maturityAnchor],
      ] as const) {
        if (!(amount > 0)) continue;
        const reason = kind === "coupon" ? "bond_coupon_settlement" : "bond_settlement";
        entries.push({
          id: new ObjectId(),
          entry: {
            turn,
            createdAt: now,
            txType: kind === "coupon" ? "bond_coupon" : "bond_maturity",
            emitSite: `bondTurn/npp:${kind}`,
            sourceRef: { collection: "npps", id: nppId },
            // NPP cash is already anchor-valued; its suffix identifies its home account.
            legs: [
              {
                account: accountId("npp", id, currency),
                amount,
                currencyCode: currency,
                anchorAmount: amount,
                role: "primary",
              },
              {
                account: mintSinkAccount(amount, reason, currency),
                amount: -amount,
                currencyCode: currency,
                anchorAmount: -amount,
                role: "contra",
              },
            ],
          },
        });
      }
      pending.push({ nppId, key, entries });
    }
    operations.push({
      updateOne: {
        filter: { _id: nppId },
        update: { $inc: { nppInvestmentCashAnchor: rounded.total }, $set: set },
      },
    });
  }
  try {
    await db.collection("npps").bulkWrite(operations);
  } finally {
    await flushNppBondCashWitnesses(db, pending);
  }
  return pending;
}
