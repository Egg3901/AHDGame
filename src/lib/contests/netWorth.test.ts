import { describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";

vi.mock("@/lib/currency/corporationCapital", () => ({
  loadValuationFxRates: vi.fn().mockResolvedValue(new Map([["GBP", 0.5]])),
  fxRateForCorpFromMap: () => 1,
  shareTradeAnchorValue: (shares: number, corp: { sharePrice?: number }) =>
    shares * (corp.sharePrice ?? 0),
  corpCapitalToAnchor: (amount: number, _code: unknown, rate: number) => amount / rate,
}));
vi.mock("@/lib/world/forex", () => ({
  fetchExchangeRateMap: vi.fn().mockResolvedValue(new Map()),
  getRateDoc: () => undefined,
  toInternalAmount: (amount: number) => amount,
}));

import { loadCharacterNetWorths, loadExternalInflows } from "./netWorth";

function db(collections: Record<string, unknown[]>): Db {
  return {
    collection: (name: string) => ({
      find: () => ({ toArray: async () => collections[name] ?? [] }),
    }),
  } as unknown as Db;
}

const alice = new ObjectId();
const fund = new ObjectId();

describe("loadCharacterNetWorths", () => {
  it("sums cash, savings, shares, bonds and fund units for the asked characters", async () => {
    const worths = await loadCharacterNetWorths(
      db({
        characters: [
          {
            _id: alice,
            countryId: "US",
            currencyBalances: { personal: { USD: 1_000 }, savings: { USD: 500 } },
          },
        ],
        corporations: [
          { sharePrice: 10, shareholders: [{ characterId: alice, shares: 100 }] },
          { sharePrice: 99, shareholders: [{ characterId: new ObjectId(), shares: 100 }] },
        ],
        bonds: [{ marketPrice: 1, holders: [{ characterId: alice, units: 1 }] }],
        indexFundPositions: [{ fundId: fund, characterId: alice, units: 4 }],
        indexFunds: [{ _id: fund, quotedNav: 25 }],
      }),
      [alice]
    );
    const bondValue = (await import("@/lib/db/types/bond")).BOND_UNIT_FACE_VALUE;
    expect(worths.get(alice.toString())).toBe(1_000 + 500 + 1_000 + bondValue + 100);
  });
});

describe("loadExternalInflows", () => {
  it("adds wires and loan principal, takes repayments back off, in ₳", async () => {
    const at = new Date();
    const inflows = await loadExternalInflows(
      db({
        financialTxLog: [
          {
            type: "wire_transfer_in",
            subjectId: alice,
            amount: 50,
            meta: { wireAnchorAmount: 40 },
          },
          { type: "bank_loan_origination", subjectId: alice, amount: 100, anchorAmount: 100 },
          { type: "bank_loan_repayment", subjectId: alice, amount: -20, currencyCode: "GBP" },
        ],
      }),
      [alice],
      new Date(0),
      at
    );
    expect(inflows.get(alice.toString())).toBe(40 + 100 - 40);
  });
});
