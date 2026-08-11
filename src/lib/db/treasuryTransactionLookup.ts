import type { Db } from "mongodb";
import type { TreasuryTransaction, TreasuryTransactionCategory } from "@/lib/db/types";
import type { CountryId } from "@/lib/constants/countries";

export interface ListTransactionsOptions {
  /** Pagination cursor — `createdAt` of the oldest row already shown. */
  before?: Date;
  /** Page size. Capped at 200. Defaults to 50. */
  limit?: number;
  /** Filter to a specific category. */
  category?: TreasuryTransactionCategory;
  /** Include only credits / only debits if set. */
  direction?: "credit" | "debit";
}

const BUNDLED_PARTY_TREASURY_CATEGORIES = new Set<TreasuryTransactionCategory>([
  "gotv",
  "suppression",
]);

const BUNDLED_PARTY_TREASURY_MEMO: Record<
  Extract<TreasuryTransactionCategory, "gotv" | "suppression">,
  string
> = {
  gotv: "GOTV operations",
  suppression: "Suppression operations",
};

export function bundlePartyTreasuryTransactions(
  rows: TreasuryTransaction[],
  partyId: string
): TreasuryTransaction[] {
  const bundled = new Map<string, TreasuryTransaction>();
  const passthrough: TreasuryTransaction[] = [];

  for (const row of rows) {
    if (!BUNDLED_PARTY_TREASURY_CATEGORIES.has(row.category)) {
      passthrough.push(row);
      continue;
    }

    const key = `${row.turn}:${row.category}:${row.direction}`;
    const existing = bundled.get(key);
    if (!existing) {
      bundled.set(key, {
        ...row,
        holderType: "party",
        holderId: partyId,
        amount: row.amount,
        memo: BUNDLED_PARTY_TREASURY_MEMO[
          row.category as Extract<TreasuryTransactionCategory, "gotv" | "suppression">
        ],
        counterparty: undefined,
        initiatedBy: undefined,
      });
      continue;
    }

    existing.amount += row.amount;
    if (row.createdAt > existing.createdAt) {
      existing._id = row._id;
      existing.createdAt = row.createdAt;
    }
  }

  return [...passthrough, ...bundled.values()].sort((a, b) =>
    a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0
  );
}

/**
 * List transactions for a (countryId, partyId) including any caucus or
 * state-party rows that roll up to the same partyId. Returned in reverse
 * chronological order; the caller paginates by passing the `createdAt` of
 * the last visible row as `before`.
 */
export async function listPartyTreasuryTransactions(
  db: Db,
  countryId: CountryId,
  partyId: string,
  options: ListTransactionsOptions = {}
): Promise<TreasuryTransaction[]> {
  const filter: Record<string, unknown> = { countryId, partyId };
  if (options.before) filter.createdAt = { $lt: options.before };
  if (options.category) filter.category = options.category;
  if (options.direction) filter.direction = options.direction;
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
  const rawRows = await db
    .collection<TreasuryTransaction>("treasuryTransactions")
    .find(filter)
    .sort({ createdAt: -1 })
    .toArray();

  return bundlePartyTreasuryTransactions(rawRows, partyId).slice(0, limit);
}

/** Same as `listPartyTreasuryTransactions` but filtered to a specific holder. */
export async function listHolderTreasuryTransactions(
  db: Db,
  args: {
    holderType: TreasuryTransaction["holderType"];
    holderId: string;
    countryId?: CountryId;
    options?: ListTransactionsOptions;
  }
): Promise<TreasuryTransaction[]> {
  const opts = args.options ?? {};
  const filter: Record<string, unknown> = {
    holderType: args.holderType,
    holderId: args.holderId,
  };
  if (args.countryId) filter.countryId = args.countryId;
  if (opts.before) filter.createdAt = { $lt: opts.before };
  if (opts.category) filter.category = opts.category;
  if (opts.direction) filter.direction = opts.direction;
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  return db
    .collection<TreasuryTransaction>("treasuryTransactions")
    .find(filter)
    .sort({ createdAt: -1 })
    .limit(limit)
    .toArray();
}
