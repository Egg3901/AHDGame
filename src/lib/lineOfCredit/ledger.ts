import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import type { LocLedgerEntry, LocLedgerType } from "@/lib/db/types/locLedger";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { getCountryIdForCurrency } from "@/lib/constants/currencies";

export async function insertLocLedgerEntry(
  db: Db,
  params: {
    characterId: ObjectId;
    currencyCode: CurrencyCode;
    type: LocLedgerType;
    amount: number;
    interestPortion?: number;
    principalPortion?: number;
    balanceAfter: number;
    arrearsAfter: number;
    turn?: number;
    meta?: LocLedgerEntry["meta"];
  }
): Promise<void> {
  const doc: Omit<LocLedgerEntry, "_id"> = {
    characterId: params.characterId,
    countryId: getCountryIdForCurrency(params.currencyCode),
    currencyCode: params.currencyCode,
    type: params.type,
    amount: params.amount,
    ...(params.interestPortion !== undefined ? { interestPortion: params.interestPortion } : {}),
    ...(params.principalPortion !== undefined ? { principalPortion: params.principalPortion } : {}),
    balanceAfter: params.balanceAfter,
    arrearsAfter: params.arrearsAfter,
    turn: params.turn,
    meta: params.meta,
    createdAt: new Date(),
  };
  await db.collection("locLedger").insertOne(doc);
}

export async function fetchLocLedgerForCharacter(
  db: Db,
  characterId: ObjectId,
  limit: number,
  currencyCode?: CurrencyCode
): Promise<
  Pick<
    LocLedgerEntry,
    | "type"
    | "amount"
    | "interestPortion"
    | "principalPortion"
    | "balanceAfter"
    | "arrearsAfter"
    | "turn"
    | "createdAt"
    | "currencyCode"
    | "meta"
  >[]
> {
  const filter: Record<string, unknown> = { characterId };
  if (currencyCode) filter.currencyCode = currencyCode;
  const rows = await db
    .collection<LocLedgerEntry>("locLedger")
    .find(filter)
    .sort({ createdAt: -1 })
    .limit(limit)
    .project({
      _id: 0,
      type: 1,
      amount: 1,
      interestPortion: 1,
      principalPortion: 1,
      balanceAfter: 1,
      arrearsAfter: 1,
      turn: 1,
      createdAt: 1,
      currencyCode: 1,
      meta: 1,
    })
    .toArray();
  return rows as Pick<
    LocLedgerEntry,
    | "type"
    | "amount"
    | "interestPortion"
    | "principalPortion"
    | "balanceAfter"
    | "arrearsAfter"
    | "turn"
    | "createdAt"
    | "currencyCode"
    | "meta"
  >[];
}
