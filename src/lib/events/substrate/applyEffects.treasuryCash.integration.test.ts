import type { Db } from "mongodb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { withInjectedCrash } from "@/lib/test-utils/faultyDb";
import { applyCountryTreasuryDelta } from "./applyEffects";

vi.mock("@/lib/financialTxLog/emit", () => ({
  emitTx: vi.fn().mockResolvedValue("applied"),
}));

describe("funded national event Treasury cash", () => {
  beforeEach(() => vi.clearAllMocks());

  function setup() {
    const db = createInMemoryDb();
    db.seed("gameConfig", [{ _id: "default", treasuryCashLedgerEnabled: true }]);
    db.seed("gameState", [{ _id: "current", currentTurn: 4, preset: "2019-default" }]);
    db.seed("exchangeRates", [{ currencyCode: "USD", rate: 1 }]);
    db.seed("federalBudget", [
      {
        _id: "US",
        countryId: "US",
        currencyCode: "USD",
        treasuryCashLocal: 10,
        treasuryBalance: -20,
      },
    ]);
    return db;
  }

  it("replays a funded event cost with its original currency quote after a crash", async () => {
    const db = setup();
    const fault = withInjectedCrash(db, {
      collection: "federalBudget",
      op: "updateOne",
      afterWrite: true,
      onCall: 1,
      matches: (args) => {
        const update = args[1] as { $inc?: Record<string, number> };
        return update.$inc?.treasuryCashLocal === -5;
      },
    });

    await expect(
      applyCountryTreasuryDelta(
        fault.db as unknown as Db,
        "US",
        4,
        -5,
        { source: "fixture" },
        "2019-default",
        true,
        "world-event-treasury:fixture:0"
      )
    ).rejects.toThrow("crash after");
    fault.disarm();
    await db.collection("exchangeRates").updateOne({ currencyCode: "USD" }, { $set: { rate: 8 } });

    await applyCountryTreasuryDelta(
      fault.db as unknown as Db,
      "US",
      5,
      -900,
      { source: "replayed fixture" },
      "2019-default",
      true,
      "world-event-treasury:fixture:0"
    );

    expect(db.collection("federalBudget").docs[0]).toMatchObject({
      treasuryCashLocal: 5,
      treasuryBalance: -25,
    });
    expect(db.collection("bankMoneyMoves").docs).toHaveLength(1);
    expect(db.collection("bankMoneyMoves").docs[0]).toMatchObject({ status: "applied" });
  });

  it("keeps unbacked positive event awards analytical and outside Treasury cash", async () => {
    const db = setup();
    const { emitTx } = await import("@/lib/financialTxLog/emit");

    await applyCountryTreasuryDelta(
      db as unknown as Db,
      "US",
      4,
      5,
      { source: "sports victory" },
      "2019-default",
      true,
      "world-event-treasury:positive-fixture:0"
    );

    expect(db.collection("federalBudget").docs[0]).toMatchObject({
      treasuryCashLocal: 10,
      treasuryBalance: -15,
    });
    expect(emitTx).not.toHaveBeenCalled();
    expect(db.collection("bankMoneyMoves").docs).toHaveLength(1);
    expect(db.collection("bankMoneyMoves").docs[0]).toMatchObject({ status: "applied" });
  });
});
