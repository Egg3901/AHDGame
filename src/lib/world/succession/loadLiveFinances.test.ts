import { ObjectId, type Db } from "mongodb";
import { describe, expect, it } from "vitest";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { loadLiveSuccessionFinances } from "./loadLiveFinances";

describe("live federation finance inventory", () => {
  it("keeps cash, bond stock and every creditor contract separate", async () => {
    const mem = createInMemoryDb();
    mem.seed("federalBudget", [
      {
        _id: "RU",
        countryId: "RU",
        currencyCode: "RUB",
        treasuryBalance: 75,
        debt: { principal: 200 },
      },
    ]);
    mem.seed("bonds", [
      {
        _id: new ObjectId("000000000000000000000001"),
        issuerType: "sovereign",
        countryId: "RU",
        currencyCode: "RUB",
        totalIssued: 200,
        restructureHaircutPercent: 0.25,
        maturityTurn: 90,
        matured: false,
        defaulted: false,
      },
      {
        _id: new ObjectId("000000000000000000000002"),
        issuerType: "sovereign",
        countryId: "RU",
        currencyCode: "USD",
        totalIssued: 50,
        maturityTurn: 91,
        matured: false,
        defaulted: false,
      },
      {
        _id: new ObjectId("000000000000000000000003"),
        issuerType: "sovereign",
        countryId: "RU",
        totalIssued: 25,
        maturityTurn: 70,
        matured: true,
        defaulted: false,
      },
      {
        _id: new ObjectId("000000000000000000000004"),
        issuerType: "sovereign",
        countryId: "PL",
        totalIssued: 999,
        maturityTurn: 90,
        matured: false,
        defaulted: false,
      },
    ]);

    const snapshot = await loadLiveSuccessionFinances(mem as unknown as Db, "RU");
    expect(snapshot.treasuryBalanceLocal).toBe(75);
    expect(snapshot.reportedDebtPrincipalLocal).toBe(200);
    expect(snapshot.activeBondPrincipalByCurrency).toEqual({ RUB: 150, USD: 50 });
    expect(
      snapshot.creditorContracts.map((bond) => [bond.bondId, bond.outstandingPrincipal])
    ).toEqual([
      ["000000000000000000000001", 150],
      ["000000000000000000000002", 50],
      ["000000000000000000000003", 0],
    ]);
    expect(await mem.collection("bonds").find({}).toArray()).toHaveLength(4);
  });

  it("rejects missing or duplicate source budgets", async () => {
    const mem = createInMemoryDb();
    await expect(loadLiveSuccessionFinances(mem as unknown as Db, "RU")).rejects.toThrow(
      "exactly one source budget"
    );
    mem.seed("federalBudget", [
      { _id: "RU", countryId: "RU", treasuryBalance: 1, debt: { principal: 1 } },
      { _id: "federal", countryId: "RU", treasuryBalance: 1, debt: { principal: 1 } },
    ]);
    await expect(loadLiveSuccessionFinances(mem as unknown as Db, "RU")).rejects.toThrow(
      "exactly one source budget"
    );
  });
});
