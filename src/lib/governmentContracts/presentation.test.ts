import { it, expect } from "vitest";
import type { Db } from "mongodb";
import { createMockDb } from "@/lib/test-utils/mockDb";
import { contractCurrencyQuotes, contractCapacityQuotes } from "./presentation";
import type { GovernmentTender } from "./types";
it("uses the government's recorded currency and live floating USD rather than assuming parity", async () => {
  const db = createMockDb();
  db.collection("exchangeRates");
  db.collection("federalBudget");
  db.collectionMocks.exchangeRates.find().toArray.mockResolvedValue([
    { currencyCode: "USD", rate: 1.25 },
    { currencyCode: "JPY", rate: 100 },
  ]);
  db.collectionMocks.federalBudget.findOne.mockResolvedValue({ currencyCode: "USD" });
  const quotes = await contractCurrencyQuotes(db as unknown as Db, "US", "1991");
  expect(quotes.government).toEqual({ code: "USD", rate: 1.25 });
  expect(quotes.quote("JPY")).toEqual({ code: "JPY", rate: 100 });
  expect(db.collectionMocks.federalBudget.findOne).toHaveBeenCalledWith(
    { countryId: "US" },
    { projection: { currencyCode: 1 } }
  );
});
it("fails closed on invalid observed FX rather than treating the amount as anchor", async () => {
  const db = createMockDb();
  db.collection("exchangeRates");
  db.collection("federalBudget");
  db.collectionMocks.exchangeRates
    .find()
    .toArray.mockResolvedValue([{ currencyCode: "USD", rate: 0 }]);
  const quotes = await contractCurrencyQuotes(db as unknown as Db, "US", "1991");
  expect(quotes.government).toBeNull();
});
it("batches capacities by URL country and reports missing separately from zero", async () => {
  const db = createMockDb();
  db.collection("stateResourceCapacity");
  const c = db.collectionMocks.stateResourceCapacity;
  c.find().toArray.mockResolvedValue([{ stateId: "MN", resources: { iron: 10000, oil: 0 } }]);
  c.find.mockClear();
  const row = (id: string, stateId: string, resource: string) =>
    ({ _id: id, terms: { type: "extraction", stateId, resource, share: 0.1 } }) as GovernmentTender;
  const quotes = await contractCapacityQuotes(db as unknown as Db, "US", [
    row("a", "MN", "iron"),
    row("b", "MN", "oil"),
    row("c", "TX", "oil"),
  ]);
  expect(c.find).toHaveBeenCalledOnce();
  expect(c.find).toHaveBeenCalledWith(
    { countryId: "US", stateId: { $in: ["MN", "TX"] } },
    { projection: { stateId: 1, resources: 1 } }
  );
  expect(quotes.get("a")).toEqual({ totalDailyUnits: 10000, allocatedDailyUnits: 1000 });
  expect(quotes.get("b")).toEqual({ totalDailyUnits: 0, allocatedDailyUnits: 0 });
  expect(quotes.get("c")).toBeNull();
});
