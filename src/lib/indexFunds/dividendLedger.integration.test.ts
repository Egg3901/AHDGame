/** Dividend cash ownership must be witnessed for funds and every real holder. */
import { describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { getDb } from "@/lib/mongodb";
import { resetLedgerShadowFlagCache } from "@/lib/ledger/featureFlag";
import { reconcileLedger } from "@/lib/ledger/reconcile";
import type { LedgerEntry } from "@/lib/ledger/types";
import { processIndexFundDividend, processIndexFundDividendsBatch } from "./dividendPassThrough";
vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));

describe("fund dividend stock-flow witnesses", () => {
  it.each([
    { mode: "single", missingNpp: false, gross: 100 },
    { mode: "batch", missingNpp: false, gross: 100 },
    { mode: "single", missingNpp: true, gross: 100 },
    { mode: "batch", missingNpp: true, gross: 100 },
    { mode: "single", missingNpp: false, gross: 100.031 },
    { mode: "batch", missingNpp: false, gross: 100.031 },
  ])(
    "reconciles $mode, missing NPP $missingNpp, gross $gross",
    async ({ mode, missingNpp, gross }) => {
      const memory = createInMemoryDb();
      const db = memory as unknown as Db;
      vi.mocked(getDb).mockResolvedValue(db);
      resetLedgerShadowFlagCache();
      const fundId = new ObjectId(),
        corporationId = new ObjectId(),
        characterId = new ObjectId(),
        nppId = new ObjectId();
      memory.seed("gameConfig", [{ _id: "default", ledgerShadow: true }]);
      memory.seed("gameState", [{ _id: "current", currentTurn: 10, forexEnabled: true }]);
      memory.seed("exchangeRates", [{ _id: "JP", currencyCode: "JPY", rate: 10 }]);
      memory.seed("indexFunds", [
        {
          _id: fundId,
          name: "Synthetic Fund",
          slug: "synthetic",
          tickerSymbol: "SYN",
          anchorCurrencyCode: "JPY",
          unitSupply: 100,
          cashAnchor: 1000,
          quotedNav: 10,
        },
      ]);
      memory.seed("corporations", [{ _id: corporationId, name: "Synthetic Issuer" }]);
      memory.seed("characters", [
        {
          _id: characterId,
          name: "Synthetic Holder",
          currencyBalances: { personal: { JPY: 1000 } },
        },
      ]);
      memory.seed(
        "npps",
        missingNpp ? [] : [{ _id: nppId, countryId: "UK", nppInvestmentCashAnchor: 100 }]
      );
      memory.seed("indexFundPositions", [
        { _id: new ObjectId(), fundId, holderKind: "character", characterId, units: 50 },
        { _id: new ObjectId(), fundId, holderKind: "npp", nppId, units: 50 },
      ]);
      const opening = {
        [`fund:${fundId}:JPY`]: 1000,
        [`character:${characterId}:JPY`]: 100,
        ...(missingNpp ? {} : { [`npp:${nppId}:GBP`]: 100 }),
      };
      if (mode === "single")
        await processIndexFundDividend(db, fundId, gross, corporationId, 10, { turn: 10 });
      else
        await processIndexFundDividendsBatch(
          db,
          [{ fundId, corporationId, amountAnchor: gross, shares: 10 }],
          { turn: 10 }
        );
      const fund = await db.collection("indexFunds").findOne({ _id: fundId });
      const holder = await db.collection("characters").findOne({ _id: characterId });
      const npp = await db.collection("npps").findOne({ _id: nppId });
      const closing = {
        [`fund:${fundId}:JPY`]: Number(fund!.cashAnchor),
        [`character:${characterId}:JPY`]: Number(holder!.currencyBalances.personal.JPY) / 10,
        ...(missingNpp ? {} : { [`npp:${nppId}:GBP`]: Number(npp!.nppInvestmentCashAnchor) }),
      };
      const holderDividend = Math.floor((gross / 8) * 100) / 100;
      const retained =
        gross * 0.75 +
        Math.round((gross * 0.25 - holderDividend * (missingNpp ? 1 : 2)) * 100) / 100;
      expect(
        Math.abs(
          Object.values(closing).reduce((s, v) => s + v, 0) -
            Object.values(opening).reduce((s, v) => s + v, 0) -
            gross
        )
      ).toBeLessThanOrEqual(0.005);
      expect(closing[`fund:${fundId}:JPY`]).toBeCloseTo(1000 + retained, 10);
      if (missingNpp)
        expect(
          memory.collection("financialTxLog").docs.filter((row) => row.subjectType === "npp")
        ).toHaveLength(0);
      const report = reconcileLedger({
        turn: 10,
        openingBalances: opening,
        closingBalances: closing,
        entries: memory.collection("ledgerEntries").docs as unknown as LedgerEntry[],
      });
      expect(report.stockVsFlow.divergentCount, JSON.stringify(report.stockVsFlow)).toBe(0);
      expect(report.trialBalance.status).toBe("green");
      expect(report.unattributed).toEqual([]);
    }
  );
});
