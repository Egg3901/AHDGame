/**
 * Bank depositors. getBankDepositorBook lists current named savings balances
 * at one bank in its charter currency; household deposits stay an aggregate.
 * Access is checked before reading any depositor records.
 */
import { ObjectId, type Db } from "mongodb";
import type { Character, NPP } from "@/lib/db/types";
import type { SavingsAccount } from "@/lib/db/types/savingsAccount";
import type { CurrencyCode } from "@/lib/constants/currencies";
import type { BankingPolicySnapshot } from "./rules/policy";
import { savingsReadsAuthoritative } from "./rules/policy";

export interface BankDepositor {
  id: string;
  type: "character" | "npp";
  name: string | null;
  sequentialId: number | null;
  balance: number;
}

export interface BankDepositorBook {
  source: "accounts" | "legacy";
  rows: BankDepositor[];
  total: number;
}

export async function getBankDepositorBook(
  db: Db,
  bankId: ObjectId,
  currency: CurrencyCode,
  policy: BankingPolicySnapshot,
  access: { isCeo: boolean; isAdmin: boolean; isChair: boolean }
): Promise<BankDepositorBook | null> {
  if (!access.isCeo && !access.isAdmin && !access.isChair) return null;
  const holder = bankId.toString();
  const authoritative = savingsReadsAuthoritative(policy, currency);
  let rows: BankDepositor[];
  if (authoritative) {
    const accounts = await db
      .collection<SavingsAccount>("savingsAccounts")
      .find(
        { holder, currency, status: { $in: ["open", "frozen"] }, balance: { $gt: 0 } },
        { projection: { ownerId: 1, ownerType: 1, balance: 1 } }
      )
      .toArray();
    const characterIds = accounts.filter((a) => a.ownerType === "character").map((a) => a.ownerId);
    const nppIds = accounts.filter((a) => a.ownerType === "npp").map((a) => a.ownerId);
    const [characters, npps] = await Promise.all([
      characterIds.length
        ? db
            .collection<Character>("characters")
            .find({ _id: { $in: characterIds } }, { projection: { name: 1, sequentialId: 1 } })
            .toArray()
        : [],
      nppIds.length
        ? db
            .collection<NPP>("npps")
            .find({ _id: { $in: nppIds } }, { projection: { name: 1, sequentialId: 1 } })
            .toArray()
        : [],
    ]);
    const names = new Map([...characters, ...npps].map((owner) => [owner._id.toString(), owner]));
    rows = accounts.map((account) => {
      const owner = names.get(account.ownerId.toString());
      return {
        id: account.ownerId.toString(),
        type: account.ownerType,
        name: owner?.name ?? null,
        sequentialId: owner?.sequentialId ?? null,
        balance: account.balance,
      };
    });
  } else {
    const characters = await db
      .collection<Character>("characters")
      .find(
        {
          [`currencyBalances.savingsHolder.${currency}`]: holder,
          [`currencyBalances.savings.${currency}`]: { $gt: 0 },
        },
        { projection: { name: 1, sequentialId: 1, [`currencyBalances.savings.${currency}`]: 1 } }
      )
      .toArray();
    rows = characters.map((character) => ({
      id: character._id.toString(),
      type: "character",
      name: character.name ?? null,
      sequentialId: character.sequentialId ?? null,
      balance: character.currencyBalances?.savings?.[currency] ?? 0,
    }));
  }
  rows = rows.filter((row) => Number.isFinite(row.balance) && row.balance > 0);
  rows.sort((a, b) => b.balance - a.balance || a.id.localeCompare(b.id));
  return {
    source: authoritative ? "accounts" : "legacy",
    rows,
    total: rows.reduce((sum, row) => sum + row.balance, 0),
  };
}
