import { ObjectId, type Db } from "mongodb";
import { describe, expect, it } from "vitest";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { remitToTreasury, creditTreasuryProceeds } from "./treasury";

function world() {
  const db = createInMemoryDb();
  db.seed("gameConfig", [{ _id: "default", treasuryCashLedgerEnabled: true }]);
  db.seed("gameState", [{ _id: "current", currentTurn: 12, preset: "2019-default" }]);
  db.seed("exchangeRates", [
    { currencyCode: "CNY", rate: 1 },
    { currencyCode: "USD", rate: 1 },
  ]);
  const corpId = new ObjectId("650000000000000000000017");
  db.seed("federalBudget", [
    {
      _id: "CN",
      countryId: "CN",
      currencyCode: "CNY",
      treasuryBalance: 10,
      treasuryCashLocal: 10,
    },
  ]);
  db.seed("corporations", [{ _id: corpId, liquidCapital: 100 }]);
  return { db, corpId };
}

describe("funded Treasury corporation transfers", () => {
  it("moves SOE remittance from actual corporate cash to Treasury once", async () => {
    const { db, corpId } = world();
    const input = {
      countryId: "CN" as const,
      corpId,
      amountLocal: 20,
      corpCurrency: "CNY" as const,
    };

    const first = await remitToTreasury(
      db as unknown as Db,
      input,
      new Date("2026-10-04T00:00:00Z")
    );
    const replay = await remitToTreasury(
      db as unknown as Db,
      input,
      new Date("2026-10-04T00:00:00Z")
    );

    expect(first).toBe(20);
    expect(replay).toBe(0);
    expect(db.collection("corporations").docs[0]?.liquidCapital).toBe(80);
    expect(db.collection("federalBudget").docs[0]).toMatchObject({
      treasuryCashLocal: 30,
      treasuryBalance: 30,
    });
    expect(db.collection("bankMoneyMoves").docs).toEqual([
      expect.objectContaining({
        _id: `treasury-soe-remittance:13:${corpId.toHexString()}`,
        status: "applied",
      }),
    ]);
  });

  it("does not mint Treasury cash for proceeds with no funded source", async () => {
    const { db } = world();
    const { context } = await import("./treasuryLedger").then(({ loadTreasuryCashContext }) =>
      loadTreasuryCashContext(db as unknown as Db, 12).then((context) => ({ context }))
    );

    await expect(
      creditTreasuryProceeds(db as unknown as Db, "CN", 20, new Date(), {
        flow: "soe_remittance",
        key: "unpaired-proceeds",
        ledger: { context },
      })
    ).rejects.toThrow("paired source leg");

    expect(db.collection("federalBudget").docs[0]).toMatchObject({
      treasuryCashLocal: 10,
      treasuryBalance: 10,
    });
    expect(db.collection("bankMoneyMoves").docs).toEqual([]);
  });
});
