import { describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
import type { TreasuryTransaction } from "@/lib/db/types";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import {
  bundlePartyTreasuryTransactions,
  listPartyTreasuryTransactions,
} from "./treasuryTransactionLookup";

function makeRow(
  overrides: Partial<TreasuryTransaction> &
    Pick<TreasuryTransaction, "category" | "amount" | "turn">
): TreasuryTransaction {
  const { category, amount, turn, createdAt, ...rest } = overrides;
  return {
    _id: new ObjectId(),
    holderType: "state_party",
    holderId: "US_PA_1",
    countryId: "US",
    partyId: "1",
    category,
    direction: "debit",
    amount,
    memo: "GOTV operations",
    turn,
    createdAt: createdAt ?? new Date("2026-05-01T12:00:00Z"),
    ...rest,
  };
}

describe("bundlePartyTreasuryTransactions", () => {
  it("bundles GOTV and suppression rows by turn while leaving other rows intact", () => {
    const rows: TreasuryTransaction[] = [
      makeRow({
        category: "gotv",
        amount: 5000,
        turn: 500,
        holderType: "party",
        holderId: "1",
        createdAt: new Date("2026-05-01T12:03:00Z"),
      }),
      makeRow({
        category: "gotv",
        amount: 9000,
        turn: 500,
        holderId: "US_MI_1",
        createdAt: new Date("2026-05-01T12:02:00Z"),
      }),
      makeRow({
        category: "suppression",
        amount: 7000,
        turn: 500,
        holderId: "US_PA_1",
        memo: "Suppression operations",
        createdAt: new Date("2026-05-01T12:01:00Z"),
      }),
      makeRow({
        category: "fund_generation",
        amount: 12000,
        turn: 500,
        direction: "credit",
        holderType: "party",
        holderId: "1",
        memo: "National tax (10%) on member fund generation",
        createdAt: new Date("2026-05-01T12:04:00Z"),
      }),
    ];

    const bundled = bundlePartyTreasuryTransactions(rows, "1");

    expect(bundled).toHaveLength(3);

    expect(bundled[0]).toMatchObject({
      category: "fund_generation",
      amount: 12000,
      holderType: "party",
      holderId: "1",
    });

    expect(bundled[1]).toMatchObject({
      category: "gotv",
      amount: 14000,
      holderType: "party",
      holderId: "1",
      memo: "GOTV operations",
    });

    expect(bundled[2]).toMatchObject({
      category: "suppression",
      amount: 7000,
      holderType: "party",
      holderId: "1",
      memo: "Suppression operations",
    });
  });
});

describe("listPartyTreasuryTransactions", () => {
  it("bundles the full filtered result set before paging so a busy turnout turn still appears as one row", async () => {
    const db: MockDb = createMockDb();
    db.collection("treasuryTransactions");
    const rawRows: TreasuryTransaction[] = Array.from({ length: 2501 }, (_, index) =>
      makeRow({
        category: "gotv",
        amount: 1,
        turn: 500,
        holderId: `US_${index}_1`,
        createdAt: new Date(`2026-05-01T12:${String(index % 60).padStart(2, "0")}:00Z`),
      })
    );

    db.collectionMocks.treasuryTransactions.find.mockReturnValue({
      sort: () => ({
        toArray: async () => rawRows,
      }),
    } as never);

    const rows = await listPartyTreasuryTransactions(db as never, "US", "1", {
      limit: 50,
      category: "gotv",
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      category: "gotv",
      amount: 2501,
      holderType: "party",
      holderId: "1",
    });
  });
});
