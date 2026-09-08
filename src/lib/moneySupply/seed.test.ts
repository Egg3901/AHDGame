import { describe, expect, it } from "vitest";
import type { Db } from "mongodb";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { seedMoneySupplyBaselines } from "./seed";

describe("monetary baseline denomination", () => {
  it("converts 1953 Italian GDP from its authored dollars into the seeded lira basis", async () => {
    const db = createInMemoryDb();
    db.seed("centralBanks", [{ _id: "IT", countryId: "IT" }]);
    db.seed("federalBudget", [{ _id: "IT", gdp: 17_000_000_000 }]);
    db.seed("exchangeRates", [
      { _id: "IT", countryId: "IT", currencyCode: "ITL", baseRate: 625, rate: 700 },
    ]);
    await seedMoneySupplyBaselines(db as unknown as Db, "1953-default");
    expect(db.collection("centralBanks").docs[0].externalBroadMoney).toBe(4_462_500_000_000);
  });

  it("preserves already initialized balances and issuance history", async () => {
    const db = createInMemoryDb();
    db.seed("centralBanks", [
      {
        _id: "IT",
        countryId: "IT",
        externalBroadMoney: 123,
        netMoneyCreatedLifetime: 45,
        monetaryOperations: [{ type: "qe", amount: 45 }],
      },
    ]);
    db.seed("federalBudget", [{ _id: "IT", gdp: 17_000_000_000 }]);
    db.seed("exchangeRates", [{ _id: "IT", currencyCode: "ITL", baseRate: 625 }]);
    await seedMoneySupplyBaselines(db as unknown as Db, "1953-default");
    expect(db.collection("centralBanks").docs[0]).toMatchObject({
      externalBroadMoney: 123,
      netMoneyCreatedLifetime: 45,
      monetaryOperations: [{ type: "qe", amount: 45 }],
    });
  });
});
