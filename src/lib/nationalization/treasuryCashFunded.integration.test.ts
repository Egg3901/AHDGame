import { ObjectId, type Db } from "mongodb";
import { describe, expect, it } from "vitest";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import {
  remitToTreasury,
  creditTreasuryProceeds,
  settleFundedTreasuryCompensation,
} from "./treasury";
import { loadTreasuryCashContext } from "./treasuryLedger";
import { withInjectedCrash, InjectedCrash } from "@/lib/test-utils/faultyDb";
import { settleFundedWholeCorpShareholderPool } from "./ownershipTransition";
import type { Character, Corporation } from "@/lib/db/types";

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
  db.seed("corporations", [
    { _id: corpId, countryId: "CN", liquidCurrencyCode: "CNY", liquidCapital: 100 },
  ]);
  return { db, corpId };
}

describe("funded Treasury corporation transfers", () => {
  it("freezes and resumes a multi-recipient whole-corp buyout after a partial payout", async () => {
    const { db, corpId } = world();
    const characterId = new ObjectId("650000000000000000000021");
    const recipientCorpId = new ObjectId("650000000000000000000022");
    const fundId = new ObjectId("650000000000000000000023");
    const target = db.collection("corporations").docs[0] as unknown as Corporation;
    target.totalShares = 100;
    target.publicFloat = 25;
    target.shareholders = [
      { characterId, shares: 25 },
      { corporationId: recipientCorpId, shares: 25 },
      { fundId, shares: 25 },
    ];
    db.seed("corporations", [
      target as unknown as Record<string, unknown>,
      { _id: recipientCorpId, countryId: "US", liquidCurrencyCode: "USD", liquidCapital: 10 },
    ]);
    db.seed("characters", [{ _id: characterId, countryId: "US", cashOnHand: 5 }]);
    db.seed("indexFunds", [
      { _id: fundId, name: "Fund", anchorCurrencyCode: "USD", cashAnchor: 2 },
    ]);
    await db
      .collection("federalBudget")
      .updateOne({ countryId: "CN" }, { $set: { treasuryCashLocal: 200 } });
    const ledger = { context: await loadTreasuryCashContext(db as unknown as Db, 12) };
    const input = {
      countryId: "CN" as const,
      target,
      poolAnchor: 100,
      fxByCurrency: new Map([
        ["CNY", 1],
        ["USD", 1],
      ]) as ReadonlyMap<"CNY" | "USD", number>,
      forexEnabled: true,
      ledger,
      key: `nationalize-corporation:CN:${corpId.toHexString()}:12`,
      now: new Date("2026-10-04T00:00:00Z"),
    };
    const crashing = withInjectedCrash(db, {
      collection: "characters",
      op: "updateOne",
      onCall: 1,
      afterWrite: true,
    });
    await expect(settleFundedWholeCorpShareholderPool(crashing.db, input)).rejects.toBeInstanceOf(
      InjectedCrash
    );
    expect(db.collection("federalBudget").docs[0]?.treasuryCashLocal).toBe(125);
    const paidCharacter = db.collection("characters").docs[0] as unknown as Character;
    expect(paidCharacter.currencyBalances?.personal?.USD).toBe(25);

    // Mutable holder shares and current quotes no longer affect the winning receipt.
    target.shareholders = [];
    await db
      .collection("corporations")
      .updateOne({ _id: recipientCorpId }, { $set: { liquidCurrencyCode: "EUR" } });
    await expect(
      settleFundedWholeCorpShareholderPool(db as unknown as Db, {
        ...input,
        target,
        fxByCurrency: new Map(),
      })
    ).rejects.toThrow();
    expect(db.collection("federalBudget").docs[0]?.treasuryCashLocal).toBe(125);
    expect(
      db
        .collection("corporations")
        .docs.find((doc) => String(doc._id) === recipientCorpId.toHexString())?.liquidCapital
    ).toBe(10);
    await db
      .collection("corporations")
      .updateOne({ _id: recipientCorpId }, { $set: { liquidCurrencyCode: "USD" } });
    await settleFundedWholeCorpShareholderPool(db as unknown as Db, {
      ...input,
      target,
      poolAnchor: 0,
      fxByCurrency: new Map(),
    });
    expect(db.collection("federalBudget").docs[0]).toMatchObject({
      treasuryCashLocal: 125,
      treasuryBalance: -65,
    });
    const retriedCharacter = db.collection("characters").docs[0] as unknown as Character;
    expect(retriedCharacter.currencyBalances?.personal?.USD).toBe(25);
    expect(
      db
        .collection("corporations")
        .docs.find((doc) => String(doc._id) === recipientCorpId.toHexString())?.liquidCapital
    ).toBe(35);
    expect(db.collection("indexFunds").docs[0]?.cashAnchor).toBe(27);
    expect(db.collection("bankMoneyMoves").docs[0]?.status).toBe("applied");
  });

  it("settles sector compensation as one durable Treasury debit and donor credit", async () => {
    const { db, corpId } = world();
    const donor = db.collection("corporations").docs[0]! as unknown as Corporation;
    const ledger = { context: await loadTreasuryCashContext(db as unknown as Db, 12) };
    const input = {
      countryId: "CN" as const,
      donor,
      payoutAnchor: 5,
      fxByCurrency: new Map([
        ["CNY", 1],
        ["USD", 1],
      ]) as ReadonlyMap<"CNY" | "USD", number>,
      now: new Date("2026-10-04T00:00:00Z"),
      key: `nationalize-sector:CN:${corpId.toHexString()}:12`,
      ledger,
    };

    const first = await settleFundedTreasuryCompensation(db as unknown as Db, input);
    const replay = await settleFundedTreasuryCompensation(db as unknown as Db, input);

    expect(first).toEqual({
      donorAmountLocal: 5,
      treasuryAmountLocal: 5,
      payoutAnchor: 5,
      newlySettled: true,
    });
    expect(replay).toEqual({
      donorAmountLocal: 5,
      treasuryAmountLocal: 5,
      payoutAnchor: 5,
      newlySettled: false,
    });
    expect(db.collection("federalBudget").docs[0]).toMatchObject({
      treasuryCashLocal: 5,
      treasuryBalance: 5,
    });
    expect(db.collection("corporations").docs[0]?.liquidCapital).toBe(105);
    expect(db.collection("bankMoneyMoves").docs).toEqual([
      expect.objectContaining({
        _id: `treasury-nationalization-compensation:${input.key}`,
        status: "applied",
        legs: [
          expect.objectContaining({ kind: "debit", collection: "federalBudget", applied: true }),
          expect.objectContaining({ kind: "credit", collection: "corporations", applied: true }),
        ],
      }),
    ]);
  });

  it("resumes the frozen donor credit after a crash following the Treasury debit", async () => {
    const { db, corpId } = world();
    const donor = db.collection("corporations").docs[0]! as unknown as Corporation;
    const ledger = { context: await loadTreasuryCashContext(db as unknown as Db, 12) };
    const input = {
      countryId: "CN" as const,
      donor,
      payoutAnchor: 5,
      fxByCurrency: new Map([
        ["CNY", 1],
        ["USD", 1],
      ]) as ReadonlyMap<"CNY" | "USD", number>,
      now: new Date("2026-10-04T00:00:00Z"),
      key: `nationalize-sector:CN:${corpId.toHexString()}:12`,
      ledger,
    };
    const crashing = withInjectedCrash(db, {
      collection: "federalBudget",
      op: "updateOne",
      onCall: 1,
      afterWrite: true,
    });

    await expect(settleFundedTreasuryCompensation(crashing.db, input)).rejects.toBeInstanceOf(
      InjectedCrash
    );
    expect(db.collection("federalBudget").docs[0]).toMatchObject({ treasuryCashLocal: 5 });
    expect(db.collection("corporations").docs[0]?.liquidCapital).toBe(100);

    const resumed = await settleFundedTreasuryCompensation(db as unknown as Db, {
      ...input,
      payoutAnchor: 0,
      fxByCurrency: new Map(),
    });
    expect(resumed).toMatchObject({ donorAmountLocal: 5, treasuryAmountLocal: 5, payoutAnchor: 5 });
    await settleFundedTreasuryCompensation(db as unknown as Db, input);

    expect(db.collection("federalBudget").docs[0]).toMatchObject({
      treasuryCashLocal: 5,
      treasuryBalance: 5,
    });
    expect(db.collection("corporations").docs[0]?.liquidCapital).toBe(105);
  });

  it("does not repeat a donor credit after a crash just after that credit lands", async () => {
    const { db, corpId } = world();
    const donor = db.collection("corporations").docs[0]! as unknown as Corporation;
    const ledger = { context: await loadTreasuryCashContext(db as unknown as Db, 12) };
    const input = {
      countryId: "CN" as const,
      donor,
      payoutAnchor: 5,
      fxByCurrency: new Map([
        ["CNY", 1],
        ["USD", 1],
      ]) as ReadonlyMap<"CNY" | "USD", number>,
      now: new Date("2026-10-04T00:00:00Z"),
      key: `nationalize-sector:CN:${corpId.toHexString()}:12`,
      ledger,
    };
    const crashing = withInjectedCrash(db, {
      collection: "corporations",
      op: "updateOne",
      onCall: 1,
      afterWrite: true,
    });

    await expect(settleFundedTreasuryCompensation(crashing.db, input)).rejects.toBeInstanceOf(
      InjectedCrash
    );
    expect(db.collection("corporations").docs[0]?.liquidCapital).toBe(105);

    await settleFundedTreasuryCompensation(db as unknown as Db, input);
    expect(db.collection("federalBudget").docs[0]).toMatchObject({
      treasuryCashLocal: 5,
      treasuryBalance: 5,
    });
    expect(db.collection("corporations").docs[0]?.liquidCapital).toBe(105);
  });

  it("keeps an unpaid frozen claim in the original denomination across currency changes", async () => {
    const { db, corpId } = world();
    const donor = db.collection("corporations").docs[0]! as unknown as Corporation;
    const ledger = { context: await loadTreasuryCashContext(db as unknown as Db, 12) };
    const input = {
      countryId: "CN" as const,
      donor,
      payoutAnchor: 5,
      fxByCurrency: new Map([
        ["CNY", 1],
        ["USD", 1],
      ]) as ReadonlyMap<"CNY" | "USD", number>,
      now: new Date("2026-10-04T00:00:00Z"),
      key: `nationalize-sector:CN:${corpId.toHexString()}:12`,
      ledger,
    };
    const crashing = withInjectedCrash(db, {
      collection: "federalBudget",
      op: "updateOne",
      onCall: 1,
      afterWrite: true,
    });
    await expect(settleFundedTreasuryCompensation(crashing.db, input)).rejects.toBeInstanceOf(
      InjectedCrash
    );
    await db
      .collection("corporations")
      .updateOne({ _id: corpId }, { $set: { liquidCurrencyCode: "EUR" } });

    const changedDonor = db.collection("corporations").docs[0]! as unknown as Corporation;
    await expect(
      settleFundedTreasuryCompensation(db as unknown as Db, {
        ...input,
        donor: changedDonor,
        fxByCurrency: new Map(),
      })
    ).rejects.toThrow();
    expect(db.collection("federalBudget").docs[0]).toMatchObject({ treasuryCashLocal: 5 });
    expect(db.collection("corporations").docs[0]?.liquidCapital).toBe(100);

    await db
      .collection("corporations")
      .updateOne({ _id: corpId }, { $set: { liquidCurrencyCode: "CNY" } });
    const restoredDonor = db.collection("corporations").docs[0]! as unknown as Corporation;
    await settleFundedTreasuryCompensation(db as unknown as Db, {
      ...input,
      donor: restoredDonor,
      fxByCurrency: new Map(),
    });

    expect(db.collection("federalBudget").docs[0]).toMatchObject({
      treasuryCashLocal: 5,
      treasuryBalance: 5,
    });
    expect(db.collection("corporations").docs[0]?.liquidCapital).toBe(105);
  });

  it("guards the fallback donor currency with its original country", async () => {
    const { db, corpId } = world();
    await db
      .collection("corporations")
      .updateOne({ _id: corpId }, { $unset: { liquidCurrencyCode: "" } });
    const donor = db.collection("corporations").docs[0]! as unknown as Corporation;
    const ledger = { context: await loadTreasuryCashContext(db as unknown as Db, 12) };
    const input = {
      countryId: "CN" as const,
      donor,
      payoutAnchor: 5,
      fxByCurrency: new Map([
        ["CNY", 1],
        ["USD", 1],
      ]) as ReadonlyMap<"CNY" | "USD", number>,
      now: new Date("2026-10-04T00:00:00Z"),
      key: `nationalize-sector:CN:${corpId.toHexString()}:12`,
      ledger,
    };
    const crashing = withInjectedCrash(db, {
      collection: "federalBudget",
      op: "updateOne",
      onCall: 1,
      afterWrite: true,
    });
    await expect(settleFundedTreasuryCompensation(crashing.db, input)).rejects.toBeInstanceOf(
      InjectedCrash
    );
    await db.collection("corporations").updateOne({ _id: corpId }, { $set: { countryId: "UK" } });

    await expect(
      settleFundedTreasuryCompensation(db as unknown as Db, {
        ...input,
        donor: db.collection("corporations").docs[0]! as unknown as Corporation,
      })
    ).rejects.toThrow();
    expect(db.collection("corporations").docs[0]?.liquidCapital).toBe(100);

    await db.collection("corporations").updateOne({ _id: corpId }, { $set: { countryId: "CN" } });
    await settleFundedTreasuryCompensation(db as unknown as Db, {
      ...input,
      donor: db.collection("corporations").docs[0]! as unknown as Corporation,
    });
    expect(db.collection("corporations").docs[0]?.liquidCapital).toBe(105);
  });

  it("rejects a fresh compensation quote when the donor currency FX rate is missing", async () => {
    const { db, corpId } = world();
    const input = {
      countryId: "CN" as const,
      donor: db.collection("corporations").docs[0]! as unknown as Corporation,
      payoutAnchor: 5,
      fxByCurrency: new Map([["USD", 1]]) as ReadonlyMap<"USD", number>,
      now: new Date("2026-10-04T00:00:00Z"),
      key: `nationalize-sector:CN:${corpId.toHexString()}:12`,
      ledger: { context: await loadTreasuryCashContext(db as unknown as Db, 12) },
    };

    await expect(settleFundedTreasuryCompensation(db as unknown as Db, input)).rejects.toThrow(
      "Missing valid compensation FX rate for donor currency CNY"
    );
    expect(db.collection("federalBudget").docs[0]).toMatchObject({
      treasuryCashLocal: 10,
      treasuryBalance: 10,
    });
    expect(db.collection("corporations").docs[0]?.liquidCapital).toBe(100);
    expect(db.collection("bankMoneyMoves").docs).toHaveLength(0);
  });

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
