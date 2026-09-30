import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createInMemoryDb, type InMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { closeCharacterSavings } from "../closeCharacterSavings";
import { buildSavingsComparison } from "../shadow";

vi.mock("@/lib/audit/recordAudit", () => ({ recordAudit: vi.fn(), recordAuditBulk: vi.fn() }));
vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
const OWNER = new ObjectId(),
  ACCOUNT = new ObjectId(),
  BANK = new ObjectId();
let memory: InMemoryDb, db: Db;
function seedAccount(holder = "centralBank", balance = 100) {
  memory.seed("corporations", [
    {
      _id: BANK,
      bankCharter: {
        status: "active",
        currency: "USD",
        cashReserves: 500,
        playerDeposits: holder === "centralBank" ? 0 : balance,
        totalDeposits: holder === "centralBank" ? 0 : balance,
      },
    },
  ]);
  memory.seed("savingsAccounts", [
    {
      _id: ACCOUNT,
      ownerType: "character",
      ownerId: OWNER,
      currency: "USD",
      holder,
      balance,
      status: "open",
      version: 1,
      accruedInterest: 3,
      interestEarned: 5,
      openedTurn: 1,
    },
  ]);
  memory.seed("characters", [
    {
      _id: OWNER,
      savingsAccountsOpened: { USD: true },
      currencyBalances: { savings: { USD: balance }, savingsHolder: { USD: holder } },
    },
  ]);
}
beforeEach(() => {
  memory = createInMemoryDb();
  db = memory as unknown as Db;
  memory.seed("gameState", [{ _id: "current", currentTurn: 20 }]);
  memory.seed("gameConfig", [
    {
      _id: "default",
      savingsAccountsMode: "authoritative",
      savingsAccountsReadCurrencies: ["USD"],
    },
  ]);
  memory.seed("centralBanks", [
    { _id: "US", externalBroadMoney: 1000, householdSavingsLiability: 100 },
  ]);
});
describe("departing owner savings", () => {
  it("releases central-bank liability while preserving backing and closes the retained account", async () => {
    seedAccount();
    await closeCharacterSavings(db, OWNER);
    expect(await db.collection("savingsAccounts").findOne({ _id: ACCOUNT })).toMatchObject({
      balance: 0,
      accruedInterest: 0,
      status: "closed",
    });
    expect(
      await db
        .collection<{ _id: string; externalBroadMoney: number; householdSavingsLiability: number }>(
          "centralBanks"
        )
        .findOne({ _id: "US" })
    ).toMatchObject({
      externalBroadMoney: 1000,
      householdSavingsLiability: 0,
    });
    await db.collection("characters").deleteOne({ _id: OWNER });
    expect(
      (await buildSavingsComparison(db, 20, { authoritativeCurrencies: ["USD"] }))
        .totalDiscrepancies
    ).toBe(0);
    await closeCharacterSavings(db, OWNER);
    expect(
      (
        await db
          .collection<{
            _id: string;
            externalBroadMoney: number;
            householdSavingsLiability: number;
          }>("centralBanks")
          .findOne({ _id: "US" })
      )?.householdSavingsLiability
    ).toBe(0);
  });
  it("returns bank backing once, including repair after the owner was already deleted", async () => {
    seedAccount(BANK.toHexString());
    await db.collection("characters").deleteOne({ _id: OWNER });
    await closeCharacterSavings(db, OWNER);
    await closeCharacterSavings(db, OWNER);
    expect((await db.collection("corporations").findOne({ _id: BANK }))?.bankCharter).toMatchObject(
      { cashReserves: 400, playerDeposits: 0 }
    );
    expect(
      (
        await db
          .collection<{
            _id: string;
            externalBroadMoney: number;
            householdSavingsLiability: number;
          }>("centralBanks")
          .findOne({ _id: "US" })
      )?.externalBroadMoney
    ).toBe(1100);
    expect(
      (await buildSavingsComparison(db, 20, { authoritativeCurrencies: ["USD"] }))
        .totalDiscrepancies
    ).toBe(0);
  });
  it("does not move backing for a shadow account that never became a liability", async () => {
    seedAccount(BANK.toHexString());
    await db
      .collection<{ _id: string; savingsAccountsMode: string }>("gameConfig")
      .updateOne({ _id: "default" }, { $set: { savingsAccountsMode: "shadow" } });
    await closeCharacterSavings(db, OWNER);
    expect(
      (await db.collection("corporations").findOne({ _id: BANK }))?.bankCharter.cashReserves
    ).toBe(500);
    expect(
      (
        await db
          .collection<{
            _id: string;
            externalBroadMoney: number;
            householdSavingsLiability: number;
          }>("centralBanks")
          .findOne({ _id: "US" })
      )?.externalBroadMoney
    ).toBe(1000);
  });
  it("refuses to take over a bank-resolution freeze", async () => {
    seedAccount();
    await db
      .collection("savingsAccounts")
      .updateOne({ _id: ACCOUNT }, { $set: { status: "frozen" } });
    await expect(closeCharacterSavings(db, OWNER)).rejects.toThrow("resolving");
    expect((await db.collection("savingsAccounts").findOne({ _id: ACCOUNT }))?.balance).toBe(100);
  });
  it("resumes after a cash credit failure without debiting the bank twice", async () => {
    seedAccount(BANK.toHexString());
    const collection = memory.collection("centralBanks");
    const update = collection.updateOne.bind(collection);
    const failure = vi.spyOn(collection, "updateOne").mockImplementationOnce(async () => {
      throw new Error("injected cash credit interruption");
    });
    await expect(closeCharacterSavings(db, OWNER)).rejects.toThrow(
      "injected cash credit interruption"
    );
    failure.mockImplementation(update);
    await closeCharacterSavings(db, OWNER);
    expect(
      (await db.collection("corporations").findOne({ _id: BANK }))?.bankCharter.cashReserves
    ).toBe(400);
    expect(
      (
        await db
          .collection<{
            _id: string;
            externalBroadMoney: number;
            householdSavingsLiability: number;
          }>("centralBanks")
          .findOne({ _id: "US" })
      )?.externalBroadMoney
    ).toBe(1100);
    expect((await db.collection("savingsAccounts").findOne({ _id: ACCOUNT }))?.status).toBe(
      "closed"
    );
    failure.mockRestore();
  });

  it("leaves an unfunded account open and permits a later funded retry", async () => {
    seedAccount(BANK.toHexString());
    await db
      .collection("corporations")
      .updateOne({ _id: BANK }, { $set: { "bankCharter.cashReserves": 50 } });
    await expect(closeCharacterSavings(db, OWNER)).rejects.toThrow("unfinished");
    expect(await db.collection("savingsAccounts").findOne({ _id: ACCOUNT })).toMatchObject({
      status: "open",
      balance: 100,
    });
    await db
      .collection("corporations")
      .updateOne({ _id: BANK }, { $set: { "bankCharter.cashReserves": 200 } });
    await closeCharacterSavings(db, OWNER);
    expect(
      (await db.collection("corporations").findOne({ _id: BANK }))?.bankCharter.cashReserves
    ).toBe(100);
  });
  it("records a missing-holder write-off only when the owner is already gone", async () => {
    seedAccount(BANK.toHexString());
    await db.collection("corporations").deleteOne({ _id: BANK });
    await expect(closeCharacterSavings(db, OWNER)).rejects.toThrow("Recover savings");
    expect((await db.collection("savingsAccounts").findOne({ _id: ACCOUNT }))?.balance).toBe(100);
    await db.collection("characters").deleteOne({ _id: OWNER });
    await closeCharacterSavings(db, OWNER, { allowMissingHolderWriteOff: true });
    expect((await db.collection("savingsAccounts").findOne({ _id: ACCOUNT }))?.status).toBe(
      "closed"
    );
    expect(
      (
        await db
          .collection<{
            _id: string;
            externalBroadMoney: number;
            householdSavingsLiability: number;
          }>("centralBanks")
          .findOne({ _id: "US" })
      )?.externalBroadMoney
    ).toBe(1000);
  });
});
