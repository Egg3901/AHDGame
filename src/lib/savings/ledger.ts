import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import type { SavingsLedgerEntry, SavingsLedgerType } from "@/lib/db/types/savingsLedger";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { getCountryIdForCurrency } from "@/lib/constants/currencies";

export async function insertSavingsLedgerEntry(
  db: Db,
  params: {
    characterId: ObjectId;
    currencyCode: CurrencyCode;
    type: SavingsLedgerType;
    amount: number;
    balanceAfter: number;
    turn?: number;
  }
): Promise<void> {
  const doc: Omit<SavingsLedgerEntry, "_id"> = {
    characterId: params.characterId,
    countryId: getCountryIdForCurrency(params.currencyCode),
    currencyCode: params.currencyCode,
    type: params.type,
    amount: params.amount,
    balanceAfter: params.balanceAfter,
    turn: params.turn,
    createdAt: new Date(),
  };
  await db.collection("savingsLedger").insertOne(doc);
}

export async function fetchSavingsLedgerForCharacter(
  db: Db,
  characterId: ObjectId,
  currencyCode: CurrencyCode | undefined,
  limit: number
): Promise<
  Pick<
    SavingsLedgerEntry,
    "type" | "amount" | "balanceAfter" | "turn" | "createdAt" | "currencyCode"
  >[]
> {
  const filter: Record<string, unknown> = { characterId };
  if (currencyCode) {
    filter.currencyCode = currencyCode;
  }
  const rows = await db
    .collection<SavingsLedgerEntry>("savingsLedger")
    .find(filter)
    .sort({ createdAt: -1 })
    .limit(limit)
    .project({
      _id: 0,
      type: 1,
      amount: 1,
      balanceAfter: 1,
      turn: 1,
      createdAt: 1,
      currencyCode: 1,
    })
    .toArray();
  return rows as Pick<
    SavingsLedgerEntry,
    "type" | "amount" | "balanceAfter" | "turn" | "createdAt" | "currencyCode"
  >[];
}
