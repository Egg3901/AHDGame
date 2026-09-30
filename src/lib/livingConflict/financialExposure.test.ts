import { ObjectId, type Db } from "mongodb";
import { expect, it, vi } from "vitest";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { resetCorpFxRateCacheForTests } from "@/lib/currency/corporationCapital";
import { loadFinancialExposure } from "./financialExposure";
vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));

it("uses enacted euro membership and actual holdings without counting a position twice", async () => {
  resetCorpFxRateCacheForTests();
  const db = createInMemoryDb();
  db.seed("exchangeRates", [{ _id: "DE", currencyCode: "EUR", rate: 2 }]);
  const bank = new ObjectId(),
    bond = new ObjectId();
  db.seed("gameState", [
    { _id: "current", eurozoneEnabled: true, euroAdoptedCountries: ["IE", "DE"] },
  ]);
  db.seed("federalBudget", [
    { _id: "IE", countryId: "IE", currencyCode: "EUR", gdp: 10000, debt: { principal: 20000 } },
    { _id: "DE", countryId: "DE", currencyCode: "EUR", treasuryBalance: 10000 },
  ]);
  db.seed("corporations", [
    {
      _id: bank,
      countryId: "DE",
      bankCharter: {
        status: "active",
        confidence: 0.5,
        currency: "EUR",
        cashReserves: 1000,
        propBookMarkValue: 1000,
        propBook: [{ asset: "bond", ref: bond.toHexString(), units: 1 }],
      },
    },
  ]);
  db.seed("bonds", [
    {
      _id: bond,
      issuerType: "sovereign",
      countryId: "IE",
      defaulted: false,
      faceValue: 1000,
      currencyCode: "EUR",
      marketPrice: 1,
      holders: [{ corporationId: bank, units: 1 }],
    },
  ]);
  const exposure = await loadFinancialExposure(db as unknown as Db, new Set(["DE", "IE"]));
  expect(exposure.rows.find((row) => row.countryId === "DE")?.euroSovereignExposure).toBe(500);
  expect(exposure.euroExposure).toBe(50);
  await db.collection("bonds").updateOne({ _id: bond }, { $set: { holders: [] } });
  expect(
    (await loadFinancialExposure(db as unknown as Db, new Set(["DE", "IE"]))).euroExposure
  ).toBe(0);
  await db
    .collection("bonds")
    .updateOne({ _id: bond }, { $set: { holders: [{ corporationId: bank, units: 1 }] } });
  await db
    .collection("gameState")
    .updateOne({ _id: "current" }, { $set: { eurozoneEnabled: false } });
  expect(
    (await loadFinancialExposure(db as unknown as Db, new Set(["DE", "IE"]))).euroExposure
  ).toBe(0);
});
