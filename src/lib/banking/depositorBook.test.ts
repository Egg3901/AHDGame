import { describe, expect, it } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { resolveBankingPolicy } from "./rules/policy";
import { getBankDepositorBook } from "./depositorBook";

const bank = new ObjectId();
const first = new ObjectId();
const second = new ObjectId();
const unnamed = new ObjectId();
const owner = { isCeo: true, isAdmin: false, isChair: false };

describe("bank depositor balances", () => {
  it("reads legacy balances only for the selected bank and currency", async () => {
    const db = createInMemoryDb();
    db.seed("characters", [
      {
        _id: first,
        name: "First",
        sequentialId: 1,
        currencyBalances: {
          savings: { USD: 100, GBP: 999 },
          savingsHolder: { USD: bank.toString() },
        },
      },
      {
        _id: second,
        name: "Second",
        currencyBalances: { savings: { USD: 300 }, savingsHolder: { USD: bank.toString() } },
      },
      {
        _id: new ObjectId(),
        name: "Elsewhere",
        currencyBalances: {
          savings: { USD: 999 },
          savingsHolder: { USD: new ObjectId().toString() },
        },
      },
      {
        _id: new ObjectId(),
        name: "Empty",
        currencyBalances: { savings: { USD: 0 }, savingsHolder: { USD: bank.toString() } },
      },
    ]);
    const book = await getBankDepositorBook(
      db as unknown as Db,
      bank,
      "USD",
      resolveBankingPolicy({}),
      owner
    );
    expect(book?.source).toBe("legacy");
    expect(book?.rows.map((r) => [r.name, r.balance])).toEqual([
      ["Second", 300],
      ["First", 100],
    ]);
    expect(book?.total).toBe(400);
    expect(JSON.stringify(book)).not.toContain(first.toString());
    expect(JSON.stringify(book)).not.toContain(second.toString());
    expect(new Set(book?.rows.map((row) => row.key)).size).toBe(book?.rows.length);
  });

  it("uses authoritative accounts without double-counting legacy projections", async () => {
    const db = createInMemoryDb();
    db.seed("characters", [
      {
        _id: first,
        name: "First",
        sequentialId: 1,
        currencyBalances: { savings: { USD: 9999 }, savingsHolder: { USD: bank.toString() } },
      },
    ]);
    db.seed("npps", [{ _id: second, name: "Second" }]);
    db.seed("savingsAccounts", [
      {
        _id: new ObjectId(),
        ownerId: first,
        ownerType: "character",
        holder: bank.toString(),
        currency: "USD",
        status: "open",
        balance: 100,
      },
      {
        _id: new ObjectId(),
        ownerId: second,
        ownerType: "npp",
        holder: bank.toString(),
        currency: "USD",
        status: "frozen",
        balance: 200,
      },
      {
        _id: new ObjectId(),
        ownerId: unnamed,
        ownerType: "character",
        holder: bank.toString(),
        currency: "USD",
        status: "open",
        balance: 50,
      },
      {
        _id: new ObjectId(),
        ownerId: first,
        ownerType: "character",
        holder: bank.toString(),
        currency: "GBP",
        status: "open",
        balance: 900,
      },
      {
        _id: new ObjectId(),
        ownerId: first,
        ownerType: "character",
        holder: "centralBank",
        currency: "USD",
        status: "open",
        balance: 900,
      },
      {
        _id: new ObjectId(),
        ownerId: first,
        ownerType: "character",
        holder: bank.toString(),
        currency: "USD",
        status: "closed",
        balance: 900,
      },
      {
        _id: new ObjectId(),
        ownerId: new ObjectId(),
        ownerType: "corporation",
        holder: bank.toString(),
        currency: "USD",
        status: "open",
        balance: 800,
      },
    ]);
    const policy = resolveBankingPolicy({
      savingsAccountsMode: "authoritative",
      savingsAccountsReadCurrencies: ["USD"],
    });
    const book = await getBankDepositorBook(db as unknown as Db, bank, "USD", policy, owner);
    expect(book?.source).toBe("accounts");
    expect(book?.rows.map((r) => [r.type, r.name, r.balance])).toEqual([
      ["npp", "Second", 200],
      ["character", "First", 100],
      ["character", null, 50],
    ]);
    expect(book?.total).toBe(350);
    const keys = book!.rows.map((row) => row.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(JSON.stringify(book)).not.toContain(first.toString());
    expect(JSON.stringify(book)).not.toContain(second.toString());
    expect(JSON.stringify(book)).not.toContain(unnamed.toString());

    const repeated = await getBankDepositorBook(db as unknown as Db, bank, "USD", policy, owner);
    expect(repeated?.rows.map((row) => row.key)).toEqual(keys);
  });

  it("respects the currency read cohort", async () => {
    const db = createInMemoryDb();
    db.seed("characters", [
      {
        _id: first,
        name: "First",
        currencyBalances: { savings: { USD: 25 }, savingsHolder: { USD: bank.toString() } },
      },
    ]);
    const policy = resolveBankingPolicy({
      savingsAccountsMode: "authoritative",
      savingsAccountsReadCurrencies: ["GBP"],
    });
    expect(
      (await getBankDepositorBook(db as unknown as Db, bank, "USD", policy, owner))?.total
    ).toBe(25);
  });

  it("does not access the database for an ordinary viewer", async () => {
    const db = {
      collection: () => {
        throw new Error("Private read");
      },
    };
    expect(
      await getBankDepositorBook(db as unknown as Db, bank, "USD", resolveBankingPolicy({}), {
        isCeo: false,
        isAdmin: false,
        isChair: false,
      })
    ).toBeNull();
  });

  it.each(["isAdmin", "isChair"] as const)(
    "allows the existing %s supervisor role",
    async (role) => {
      const db = createInMemoryDb();
      const access = { isCeo: false, isAdmin: false, isChair: false, [role]: true };
      expect(
        await getBankDepositorBook(
          db as unknown as Db,
          bank,
          "USD",
          resolveBankingPolicy({}),
          access
        )
      ).toEqual({ source: "legacy", rows: [], total: 0 });
    }
  );
});
