/** A prop trade exchanges bank cash and a marked noncash position under one journal receipt. */
import { oid, type BankingTransition } from "./boundary";
import type { PropPosition } from "@/lib/db/types/bank";

export function propSettlementTransition(input: {
  bankId: string;
  key: string;
  operation: string;
  turn: number;
  currency: string;
  cashDelta: number;
  nextBook: PropPosition[];
  nextMark: number;
  nextRevision: number;
  now: Date;
}): BankingTransition {
  const amount = Math.abs(input.cashDelta);
  const credit = input.cashDelta > 0;
  const filter = { _id: oid(input.bankId) };
  return {
    key: input.key,
    kind: `bank.prop.${input.operation}`,
    turn: input.turn,
    currency: input.currency,
    legs:
      amount > 0
        ? [
            {
              kind: credit ? "mint" : "debit",
              amount,
              ...(!credit
                ? { collection: "corporations", filter, path: "bankCharter.cashReserves" }
                : {}),
              note: credit ? "Prop-book sale reclassification" : "Bank cash committed to prop book",
            },
            {
              kind: credit ? "credit" : "burn",
              amount,
              ...(credit
                ? { collection: "corporations", filter, path: "bankCharter.cashReserves" }
                : {}),
              note: credit
                ? "Prop proceeds returned to bank cash"
                : "Prop-book purchase reclassification",
            },
          ]
        : [],
    projections: [
      {
        collection: "corporations",
        filter,
        update: {
          ...(amount > 0 ? { $inc: { "bankCharter.cashReserves": input.cashDelta } } : {}),
          $set: {
            "bankCharter.propBook": input.nextBook,
            "bankCharter.propBookMarkValue": input.nextMark,
            bankPropBookRevision: input.nextRevision,
            updatedAt: input.now,
          },
        },
        note: "Publish the settled prop position and revision",
      },
    ],
    event: {
      kind: "prop.traded",
      command: `bank.prop.${input.operation}`,
      amount: input.cashDelta,
    },
  };
}
