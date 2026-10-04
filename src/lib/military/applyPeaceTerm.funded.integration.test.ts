import { type Db } from "mongodb";
import { describe, expect, it } from "vitest";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { applyPeaceTerm } from "./applyPeaceTerm";

describe("funded Treasury peace indemnity", () => {
  it("moves cash once and keeps signed fiscal projections separate", async () => {
    const memory = createInMemoryDb();
    memory.seed("gameConfig", [
      { _id: "default", treasuryCashLedgerEnabled: true, ledgerShadow: false },
    ]);
    memory.seed("gameState", [{ _id: "current", currentTurn: 100, preset: "2019-default" }]);
    memory.seed("exchangeRates", [{ currencyCode: "USD", rate: 1 }]);
    memory.seed("federalBudget", [
      {
        _id: "TR",
        countryId: "TR",
        currencyCode: "USD",
        treasuryBalance: 1_000,
        treasuryCashLocal: 500,
      },
      {
        _id: "UK",
        countryId: "UK",
        currencyCode: "USD",
        treasuryBalance: 2_000,
        treasuryCashLocal: 100,
      },
    ]);
    const db = memory as unknown as Db;
    const context = {
      imposer: "UK",
      target: "TR",
      conflictId: "funded-indemnity-1",
      currentTurn: 100,
    } as const;
    await applyPeaceTerm(db, { kind: "indemnity", payer: "TR", amount: 250 }, context);
    await applyPeaceTerm(db, { kind: "indemnity", payer: "TR", amount: 250 }, context);

    expect(memory.collection("federalBudget").docs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          countryId: "TR",
          treasuryCashLocal: 250,
          treasuryBalance: 750,
        }),
        expect.objectContaining({
          countryId: "UK",
          treasuryCashLocal: 350,
          treasuryBalance: 2_250,
        }),
      ])
    );
    expect(
      await db
        .collection("bankMoneyMoves")
        .countDocuments({ kind: "peace_indemnity", status: "applied" })
    ).toBe(1);
  });
});
