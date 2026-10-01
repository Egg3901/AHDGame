/** Witness the exact founding expense only after its stamped cash write lands. */
import * as Sentry from "@sentry/nextjs";
import { type ObjectId, type AnyBulkWriteOperation, type Document, type Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import {
  appendNppReinvestCapexRows,
  buildNppFoundedSectorInserts,
  depleteUnownedPoolsForDraws,
  type NppUnownedDrawList,
} from "./capacityWriteback";
import type { BuildCapexTxInput } from "@/lib/corporations/capexTxLog";
import type { UnownedSector } from "@/lib/db/types/unownedSector";
import type { Corporation } from "@/lib/db/types";
import { buildNppCorpUpdateOp } from "./nppCashWrite";
import type { NppCorpDecision } from "./corpDecisionTypes";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { accountId, mintSinkAccount } from "@/lib/ledger/accounts";
import { isAnchorBalanced } from "@/lib/ledger/epsilon";
import type { LedgerEntry, LedgerEntryInput } from "@/lib/ledger/types";

import {
  flushNppReinvestmentCashWitnesses,
  type NppReinvestmentCashWitness,
} from "./reinvestmentCashLedger";

export interface NppFoundingCashWitness {
  corporationId: ObjectId;
  key: ObjectId;
  entry: LedgerEntryInput;
}

/** The caller puts this key in the same update as the exact native cash debit. */
export function buildNppFoundingCashWitness(input: {
  corporationId: ObjectId;
  key: ObjectId;
  amountLocal: number;
  currencyCode: CurrencyCode;
  rate: number;
  turn: number;
  now: Date;
}): NppFoundingCashWitness | null {
  if (!Number.isFinite(input.amountLocal) || !(input.amountLocal > 0)) return null;
  const rate = Number.isFinite(input.rate) && input.rate > 0 ? input.rate : 1;
  const anchorAmount = -input.amountLocal / rate;
  return {
    corporationId: input.corporationId,
    key: input.key,
    entry: {
      turn: input.turn,
      createdAt: input.now,
      txType: "corp_sector_founding",
      emitSite: "nppCorporationBehavior/sector_founding",
      legs: [
        {
          account: accountId("corporation", input.corporationId.toString(), input.currencyCode),
          amount: -input.amountLocal,
          currencyCode: input.currencyCode,
          anchorAmount,
          role: "primary",
        },
        {
          account: mintSinkAccount(anchorAmount, "sector_founding_cash", input.currencyCode),
          amount: input.amountLocal,
          currencyCode: input.currencyCode,
          anchorAmount: -anchorAmount,
          role: "contra",
        },
      ],
    },
  };
}

/** Construct the business writes and attach an observer to their shared cash operation. */
export function buildNppDecisionCashWrites(args: {
  decision: NppCorpDecision;
  corporation: Pick<Corporation, "_id" | "name" | "sequentialId">;
  capexRows: BuildCapexTxInput[];
  unownedDraws: NppUnownedDrawList;
  unownedIndex: Map<string, UnownedSector>;
  eraUnitScale: number;
  currencyCode: CurrencyCode | null | undefined;
  rate: number;
  shadowEnabled: boolean;
  blocked: ReadonlySet<CountryId>;
  turn: number;
  now: Date;
}) {
  if (args.decision.reinvestments && args.currencyCode) {
    appendNppReinvestCapexRows(args.capexRows, {
      corp: args.corporation,
      corpCurrency: args.currencyCode,
      reinvestments: args.decision.reinvestments,
      turn: args.turn,
      now: args.now,
    });
  }
  if (args.decision.unownedDraws) {
    args.unownedDraws.push(...args.decision.unownedDraws);
    depleteUnownedPoolsForDraws(args.unownedIndex, args.decision.unownedDraws, args.eraUnitScale);
  }
  // Cash-only decisions are gated inside the builder, even when no field is set.
  // The founded sector's existing business id doubles as the atomic audit key.
  const founded = args.decision.newSectors
    ? buildNppFoundedSectorInserts({
        corporationId: args.corporation._id,
        newSectors: args.decision.newSectors,
        blocked: args.blocked,
        turn: args.turn,
        now: args.now,
      })
    : [];
  const update = buildNppCorpUpdateOp(args.decision);
  const witness =
    update &&
    args.shadowEnabled &&
    args.currencyCode &&
    args.decision.foundingCashLocal &&
    founded.length === 1
      ? buildNppFoundingCashWitness({
          corporationId: args.corporation._id,
          key: founded[0]._id,
          amountLocal: args.decision.foundingCashLocal,
          currencyCode: args.currencyCode,
          rate: args.rate,
          turn: args.turn,
          now: args.now,
        })
      : null;
  if (update && witness) {
    update.update.$set = {
      ...update.update.$set,
      nppFoundingCashWitnessKey: witness.key.toHexString(),
    };
  }
  return { founded, update, witness };
}

/** One projected cohort read and one idempotent batch, including partial failures. */
export async function flushNppFoundingCashWitnesses(
  db: Db,
  pending: readonly NppFoundingCashWitness[]
): Promise<void> {
  if (pending.length === 0) return;
  try {
    const committed = await db
      .collection<{ _id: ObjectId; nppFoundingCashWitnessKey?: string }>("corporations")
      .find(
        {
          _id: { $in: pending.map((row) => row.corporationId) },
          nppFoundingCashWitnessKey: { $in: pending.map((row) => row.key.toHexString()) },
        },
        { projection: { _id: 1, nppFoundingCashWitnessKey: 1 } }
      )
      .toArray();
    const keys = new Map(
      committed.map((row) => [row._id.toHexString(), row.nppFoundingCashWitnessKey])
    );
    const landed = pending.filter(
      (row) => keys.get(row.corporationId.toHexString()) === row.key.toHexString()
    );
    if (landed.length === 0) return;
    await db.collection<LedgerEntry>("ledgerEntries").bulkWrite(
      landed.map((row) => ({
        updateOne: {
          filter: { _id: row.key },
          update: {
            $setOnInsert: {
              ...row.entry,
              balanced: isAnchorBalanced(row.entry.legs),
              _id: row.key,
            },
          },
          upsert: true,
        },
      })),
      { ordered: false }
    );
  } catch (error) {
    Sentry.captureException(error, {
      extra: { phase: "flushNppFoundingCashWitnesses", count: pending.length },
    });
  }
}

/** The real corporation cash writer and observer share the same failure boundary. */
export async function applyCorporationCashWrites(
  db: Db,
  operations: AnyBulkWriteOperation<Document>[],
  pending: readonly NppFoundingCashWitness[],
  reinvestments: readonly NppReinvestmentCashWitness[] = []
) {
  try {
    return await db.collection("corporations").bulkWrite(operations);
  } finally {
    // Ordered failures may have landed earlier debits. Atomic stamps prove them.
    await flushNppFoundingCashWitnesses(db, pending);
    await flushNppReinvestmentCashWitnesses(db, reinvestments);
  }
}
