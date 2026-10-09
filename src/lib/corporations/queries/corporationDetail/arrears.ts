/**
 * CEO-only arrears disclosure uses existing operating and tax settlement receipts.
 * loadArrearsView performs one indexed read for the displayed turn and never
 * exposes these private cash balances to other viewers.
 */
import type { Db } from "mongodb";
import type { Corporation } from "@/lib/db/types";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { resolveCorpLiquidCurrencyCode } from "@/lib/currency/corporationCapital";
import { summarizeArrears, type ArrearsReceipt } from "./rules/arrears";

export async function loadArrearsView(args: {
  db: Db;
  corporation: Corporation;
  viewerUserId?: string | null;
  turn: number;
  rates: ReadonlyMap<CurrencyCode, number>;
}) {
  const { db, corporation, viewerUserId, turn, rates } = args;
  if (
    !viewerUserId ||
    corporation.ceoVacant === true ||
    corporation.userId?.toString() !== viewerUserId
  )
    return undefined;
  const id = corporation._id.toString();
  const receipts = await db
    .collection<ArrearsReceipt & { _id: string }>("bankMoneyMoves")
    .find(
      {
        _id: {
          $in: [
            `corp-operating-arrears-settle:${id}:${turn}`,
            `corp-tax-arrears-settle:${id}:${turn}`,
          ],
        },
        status: "applied",
      },
      { projection: { status: 1, currency: 1, "event.amount": 1 } }
    )
    .toArray();
  return summarizeArrears({
    turn,
    currency: resolveCorpLiquidCurrencyCode(corporation) ?? "anchor",
    rates,
    operating: corporation.operatingCashArrearsByCurrency,
    taxAnchor: corporation.federalTaxArrearsAnchorByCountry,
    receipts,
  });
}
