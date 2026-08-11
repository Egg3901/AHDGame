import { describe, it, expect, vi, beforeEach } from "vitest";
import { snapshotPortfolioValues, snapshotCorporationPortfolioValues } from "./portfolioSnapshot";
import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import { BOND_UNIT_FACE_VALUE } from "@/lib/db/types/bond";

vi.mock("@/lib/mongodb", () => ({
  getDb: vi.fn(),
}));

vi.mock("@/lib/currency/featureFlag", () => ({
  isForexEnabled: vi.fn().mockResolvedValue(false),
}));

vi.mock("@/lib/currency/corporationCapital", async () => {
  const actual = await vi.importActual<typeof import("@/lib/currency/corporationCapital")>(
    "@/lib/currency/corporationCapital"
  );
  return {
    ...actual,
    loadFxRatesByCurrency: vi.fn().mockResolvedValue(new Map()),
  };
});

import { getDb } from "@/lib/mongodb";
import { isForexEnabled } from "@/lib/currency/featureFlag";

describe("portfolioSnapshot", () => {
  let mockDb: Db;
  let mockCollection: ReturnType<typeof vi.fn>;
  let mockInsertMany: ReturnType<typeof vi.fn>;

  const createMockChain = (result: any[]) => ({
    find: vi.fn().mockReturnThis(),
    project: vi.fn().mockReturnThis(),
    toArray: vi.fn().mockResolvedValue(result),
  });

  beforeEach(() => {
    mockInsertMany = vi.fn();
    mockCollection = vi.fn();

    mockDb = {
      collection: mockCollection,
    } as unknown as Db;

    vi.mocked(getDb).mockResolvedValue(mockDb);
    vi.clearAllMocks();
    vi.mocked(isForexEnabled).mockResolvedValue(false);
  });

  describe("snapshotPortfolioValues", () => {
    it("returns 0 when no corporations have shareholders", async () => {
      mockCollection.mockReturnValueOnce(createMockChain([])); // characters
      mockCollection.mockReturnValueOnce(createMockChain([])); // imperialCharacters
      mockCollection.mockReturnValueOnce({
        find: vi.fn().mockReturnThis(),
        project: vi.fn().mockReturnThis(),
        toArray: vi.fn().mockResolvedValue([]),
      });
      mockCollection.mockReturnValueOnce({
        find: vi.fn().mockReturnThis(),
        project: vi.fn().mockReturnThis(),
        toArray: vi.fn().mockResolvedValue([]),
      });

      const result = await snapshotPortfolioValues(100);

      expect(result).toBe(0);
      expect(mockInsertMany).not.toHaveBeenCalled();
    });

    it("snapshots share holdings correctly", async () => {
      const char1Id = new ObjectId("507f1f77bcf86cd799439011");
      const char2Id = new ObjectId("507f1f77bcf86cd799439012");
      const corporations = [
        {
          _id: new ObjectId(),
          shareholders: [
            { characterId: char1Id, shares: 100 },
            { characterId: char2Id, shares: 50 },
          ],
          sharePrice: 25,
        },
      ];

      mockCollection.mockReturnValueOnce(createMockChain([])); // characters
      mockCollection.mockReturnValueOnce(createMockChain([])); // imperialCharacters
      mockCollection.mockReturnValueOnce(createMockChain(corporations));
      mockCollection.mockReturnValueOnce(createMockChain([])); // bonds
      mockCollection.mockReturnValue({ insertMany: mockInsertMany });

      const result = await snapshotPortfolioValues(100);

      expect(result).toBe(2); // 2 characters
      expect(mockInsertMany).toHaveBeenCalled();
      const insertedDocs = mockInsertMany.mock.calls[0][0];
      expect(insertedDocs).toHaveLength(2);
      expect(insertedDocs.some((d: any) => d.totalValue === 2500)).toBe(true);
      expect(insertedDocs.some((d: any) => d.totalValue === 1250)).toBe(true);
    });

    it("snapshots bond holdings correctly", async () => {
      const charId = new ObjectId("507f1f77bcf86cd799439011");
      const bonds = [
        {
          _id: new ObjectId(),
          holders: [{ characterId: charId, units: 10 }],
          marketPrice: 1.05,
          matured: false,
        },
      ];

      mockCollection.mockReturnValueOnce(createMockChain([])); // characters
      mockCollection.mockReturnValueOnce(createMockChain([])); // imperialCharacters
      mockCollection.mockReturnValueOnce(createMockChain([])); // corps
      mockCollection.mockReturnValueOnce(createMockChain(bonds));
      mockCollection.mockReturnValue({ insertMany: mockInsertMany });

      await snapshotPortfolioValues(100);

      const insertedDocs = mockInsertMany.mock.calls[0][0];
      const expectedValue = 10 * BOND_UNIT_FACE_VALUE * 1.05;
      expect(insertedDocs[0].totalValue).toBe(expectedValue);
    });

    it("aggregates multiple holdings for same character", async () => {
      const charId = new ObjectId("507f1f77bcf86cd799439011");

      const corporations = [
        {
          _id: new ObjectId(),
          shareholders: [{ characterId: charId, shares: 100 }],
          sharePrice: 10,
        },
        {
          _id: new ObjectId(),
          shareholders: [{ characterId: charId, shares: 50 }],
          sharePrice: 20,
        },
      ];

      const bonds = [
        {
          _id: new ObjectId(),
          holders: [{ characterId: charId, units: 5 }],
          marketPrice: 1.0,
          matured: false,
        },
      ];

      mockCollection.mockReturnValueOnce(createMockChain([])); // characters
      mockCollection.mockReturnValueOnce(createMockChain([])); // imperialCharacters
      mockCollection.mockReturnValueOnce(createMockChain(corporations));
      mockCollection.mockReturnValueOnce(createMockChain(bonds));
      mockCollection.mockReturnValue({ insertMany: mockInsertMany });

      await snapshotPortfolioValues(100);

      const insertedDocs = mockInsertMany.mock.calls[0][0];
      // 100 * 10 + 50 * 20 + 5 * BOND_UNIT_FACE_VALUE * 1.0
      const expectedValue = 1000 + 1000 + 5 * BOND_UNIT_FACE_VALUE;
      expect(insertedDocs[0].totalValue).toBe(expectedValue);
    });

    it("snapshots loc debt separately and net value after debt", async () => {
      const charId = new ObjectId("507f1f77bcf86cd799439011");
      const { isForexEnabled } = await import("@/lib/currency/featureFlag");
      vi.mocked(isForexEnabled).mockResolvedValue(true);

      mockCollection.mockReturnValueOnce(createMockChain([{ currencyCode: "USD", rate: 1 }])); // exchangeRates
      mockCollection.mockReturnValueOnce(
        createMockChain([
          {
            _id: charId,
            currencyBalances: {
              personal: { USD: 2_000 },
              savings: { USD: 500 },
            },
            countryId: "US",
            lineOfCredit: {
              balances: { USD: 400 },
              arrears: { USD: 100 },
            },
          },
        ])
      ); // characters
      mockCollection.mockReturnValueOnce(createMockChain([])); // imperialCharacters
      mockCollection.mockReturnValueOnce(createMockChain([])); // corporations
      mockCollection.mockReturnValueOnce(createMockChain([])); // bonds
      mockCollection.mockReturnValue({ insertMany: mockInsertMany });

      await snapshotPortfolioValues(100);

      const [doc] = mockInsertMany.mock.calls[0][0];
      expect(doc.cashValue).toBe(2500);
      expect(doc.locDebtValue).toBe(500);
      expect(doc.totalValue).toBe(2500);
      expect(doc.netValue).toBe(2000);
    });

    it("skips matured bonds", async () => {
      const _bonds = [
        {
          _id: new ObjectId(),
          holders: [{ characterId: new ObjectId(), units: 10 }],
          marketPrice: 1.0,
          matured: true,
        },
      ];

      mockCollection.mockReturnValueOnce(createMockChain([])); // characters
      mockCollection.mockReturnValueOnce(createMockChain([])); // imperialCharacters
      // First query returns empty (no corps with shareholders)
      mockCollection.mockReturnValueOnce(createMockChain([]));
      // Second query filters out matured bonds, returns empty
      mockCollection.mockReturnValueOnce(createMockChain([]));
      mockCollection.mockReturnValue({ insertMany: mockInsertMany });

      const result = await snapshotPortfolioValues(100);
      expect(result).toBe(0);
    });

    it("skips bonds with no holders", async () => {
      const bonds = [
        {
          _id: new ObjectId(),
          holders: [],
          marketPrice: 1.0,
          matured: false,
        },
      ];

      mockCollection.mockReturnValueOnce(createMockChain([])); // characters
      mockCollection.mockReturnValueOnce(createMockChain([])); // imperialCharacters
      mockCollection.mockReturnValueOnce(createMockChain([]));
      mockCollection.mockReturnValueOnce(createMockChain(bonds));
      mockCollection.mockReturnValue({ insertMany: mockInsertMany });

      const result = await snapshotPortfolioValues(100);
      expect(result).toBe(0);
    });

    it("rounds portfolio values to 2 decimal places", async () => {
      const corporations = [
        {
          _id: new ObjectId(),
          shareholders: [{ characterId: new ObjectId(), shares: 33 }],
          sharePrice: 33.33,
        },
      ];

      mockCollection.mockReturnValueOnce(createMockChain([])); // characters
      mockCollection.mockReturnValueOnce(createMockChain([])); // imperialCharacters
      mockCollection.mockReturnValueOnce(createMockChain(corporations));
      mockCollection.mockReturnValueOnce(createMockChain([]));
      mockCollection.mockReturnValue({ insertMany: mockInsertMany });

      await snapshotPortfolioValues(100);

      const insertedDocs = mockInsertMany.mock.calls[0][0];
      expect(insertedDocs[0].totalValue).toBe(1099.89); // 33 * 33.33
    });

    it("handles multiple characters with mixed holdings", async () => {
      const char1Id = new ObjectId("507f1f77bcf86cd799439011");
      const char2Id = new ObjectId("507f1f77bcf86cd799439012");

      const corporations = [
        {
          _id: new ObjectId(),
          shareholders: [
            { characterId: char1Id, shares: 100 },
            { characterId: char2Id, shares: 50 },
          ],
          sharePrice: 10,
        },
      ];

      const bonds = [
        {
          _id: new ObjectId(),
          holders: [
            { characterId: char1Id, units: 5 },
            { characterId: char2Id, units: 10 },
          ],
          marketPrice: 1.0,
          matured: false,
        },
      ];

      mockCollection.mockReturnValueOnce(createMockChain([])); // characters
      mockCollection.mockReturnValueOnce(createMockChain([])); // imperialCharacters
      mockCollection.mockReturnValueOnce(createMockChain(corporations));
      mockCollection.mockReturnValueOnce(createMockChain(bonds));
      mockCollection.mockReturnValue({ insertMany: mockInsertMany });

      await snapshotPortfolioValues(100);

      const insertedDocs = mockInsertMany.mock.calls[0][0];
      const char1Doc = insertedDocs.find(
        (d: any) => d.characterId.toString() === char1Id.toString()
      );
      const char2Doc = insertedDocs.find(
        (d: any) => d.characterId.toString() === char2Id.toString()
      );

      expect(char1Doc.totalValue).toBe(1000 + 5 * BOND_UNIT_FACE_VALUE);
      expect(char2Doc.totalValue).toBe(500 + 10 * BOND_UNIT_FACE_VALUE);
    });

    it("handles zero share price gracefully", async () => {
      const corporations = [
        {
          _id: new ObjectId(),
          shareholders: [{ characterId: new ObjectId(), shares: 100 }],
          sharePrice: 0,
        },
      ];

      mockCollection.mockReturnValueOnce(createMockChain([])); // characters
      mockCollection.mockReturnValueOnce(createMockChain([])); // imperialCharacters
      mockCollection.mockReturnValueOnce(createMockChain(corporations));
      mockCollection.mockReturnValueOnce(createMockChain([]));
      mockCollection.mockReturnValue({ insertMany: mockInsertMany });

      await snapshotPortfolioValues(100);

      const insertedDocs = mockInsertMany.mock.calls[0][0];
      expect(insertedDocs[0].totalValue).toBe(0);
    });

    it("handles zero bond market price gracefully", async () => {
      const bonds = [
        {
          _id: new ObjectId(),
          holders: [{ characterId: new ObjectId(), units: 10 }],
          marketPrice: 0,
          matured: false,
        },
      ];

      mockCollection.mockReturnValueOnce(createMockChain([])); // characters
      mockCollection.mockReturnValueOnce(createMockChain([])); // imperialCharacters
      mockCollection.mockReturnValueOnce(createMockChain([]));
      mockCollection.mockReturnValueOnce(createMockChain(bonds));
      mockCollection.mockReturnValue({ insertMany: mockInsertMany });

      await snapshotPortfolioValues(100);

      const insertedDocs = mockInsertMany.mock.calls[0][0];
      expect(insertedDocs[0].totalValue).toBe(0);
    });
  });

  describe("snapshotCorporationPortfolioValues", () => {
    it("records liquidCapital as cashValue for cash-only corps", async () => {
      const corpId = new ObjectId();
      const allCorps = [{ _id: corpId, liquidCapital: 750_000 }];

      mockCollection.mockReturnValueOnce(createMockChain(allCorps)); // all corps
      mockCollection.mockReturnValueOnce(createMockChain([])); // corps with shareholders
      mockCollection.mockReturnValueOnce(createMockChain([])); // bonds
      mockCollection.mockReturnValue({ insertMany: mockInsertMany });

      const result = await snapshotCorporationPortfolioValues(100);

      expect(result).toBe(1);
      const [doc] = mockInsertMany.mock.calls[0][0];
      expect(doc.cashValue).toBe(750_000);
      expect(doc.stockValue).toBe(0);
      expect(doc.bondValue).toBe(0);
      expect(doc.liabilityValue).toBe(0);
      expect(doc.netValue).toBe(750_000);
      expect(doc.totalValue).toBe(750_000);
    });

    it("sums cash + stocks + bonds into totalValue", async () => {
      const holderCorpId = new ObjectId();
      const heldCorpId = new ObjectId();

      const allCorps = [
        { _id: holderCorpId, liquidCapital: 100_000 },
        { _id: heldCorpId, liquidCapital: 0 },
      ];
      const heldCorps = [
        {
          _id: heldCorpId,
          shareholders: [{ corporationId: holderCorpId, shares: 10 }],
          sharePrice: 50,
        },
      ];
      const bonds = [
        {
          _id: new ObjectId(),
          holders: [{ corporationId: holderCorpId, units: 2 }],
          marketPrice: 1.0,
          matured: false,
        },
      ];

      mockCollection.mockReturnValueOnce(createMockChain(allCorps));
      mockCollection.mockReturnValueOnce(createMockChain(heldCorps));
      mockCollection.mockReturnValueOnce(createMockChain(bonds));
      mockCollection.mockReturnValue({ insertMany: mockInsertMany });

      await snapshotCorporationPortfolioValues(100);

      const inserted = mockInsertMany.mock.calls[0][0];
      const holderDoc = inserted.find(
        (d: any) => d.corporationId.toString() === holderCorpId.toString()
      );
      expect(holderDoc.cashValue).toBe(100_000);
      expect(holderDoc.stockValue).toBe(500); // 10 * 50
      expect(holderDoc.bondValue).toBe(2 * BOND_UNIT_FACE_VALUE);
      expect(holderDoc.liabilityValue).toBe(0);
      expect(holderDoc.netValue).toBe(100_000 + 500 + 2 * BOND_UNIT_FACE_VALUE);
      expect(holderDoc.totalValue).toBe(100_000 + 500 + 2 * BOND_UNIT_FACE_VALUE);
    });

    it("subtracts issued bond and IMF debt into corporation netValue", async () => {
      const corpId = new ObjectId();

      const allCorps = [
        {
          _id: corpId,
          liquidCapital: 150_000,
          imfBailoutActive: true,
          imfFacilityPrincipalOutstanding: 50_000,
        },
      ];
      const bonds = [
        {
          _id: new ObjectId(),
          corporationId: corpId,
          totalIssued: 200_000,
          holders: [],
          marketPrice: 1,
          matured: false,
        },
      ];

      mockCollection.mockReturnValueOnce(createMockChain(allCorps));
      mockCollection.mockReturnValueOnce(createMockChain([]));
      mockCollection.mockReturnValueOnce(createMockChain(bonds));
      mockCollection.mockReturnValue({ insertMany: mockInsertMany });

      await snapshotCorporationPortfolioValues(100);

      const [doc] = mockInsertMany.mock.calls[0][0];
      expect(doc.totalValue).toBe(150_000);
      expect(doc.liabilityValue).toBe(250_000);
      expect(doc.netValue).toBe(-100_000);
    });

    it("includes IMF facility receivables as bond-like assets for the lender", async () => {
      const lenderId = new ObjectId();
      const borrowerId = new ObjectId();

      const allCorps = [
        { _id: lenderId, liquidCapital: 10_000 },
        {
          _id: borrowerId,
          liquidCapital: 0,
          imfBailoutActive: true,
          imfBailoutImfCorporationId: lenderId,
          imfFacilityPrincipalOutstanding: 75_000,
        },
      ];

      mockCollection.mockReturnValueOnce(createMockChain(allCorps));
      mockCollection.mockReturnValueOnce(createMockChain([]));
      mockCollection.mockReturnValueOnce(createMockChain([]));
      mockCollection.mockReturnValue({ insertMany: mockInsertMany });

      await snapshotCorporationPortfolioValues(100);

      const inserted = mockInsertMany.mock.calls[0][0];
      const lenderDoc = inserted.find(
        (d: any) => d.corporationId.toString() === lenderId.toString()
      );
      expect(lenderDoc.cashValue).toBe(10_000);
      expect(lenderDoc.bondValue).toBe(75_000);
      expect(lenderDoc.totalValue).toBe(85_000);
      expect(lenderDoc.netValue).toBe(85_000);
    });
  });
});
