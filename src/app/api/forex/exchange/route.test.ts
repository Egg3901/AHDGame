import { expect, it, vi } from "vitest";
import { createMockDb } from "@/lib/test-utils/mockDb";
const mocks = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("@/lib/mongodb", () => ({ getDb: mocks.getDb }));
vi.mock("@/lib/currency/featureFlag", () => ({ isForexEnabled: async () => true }));
import { GET } from "./route";
it("publishes effective peg bounds without exposing intervention history", async () => {
  const db = createMockDb();
  mocks.getDb.mockResolvedValue(db);
  db.collection("exchangeRates")
    .find()
    .toArray.mockResolvedValue([
      {
        countryId: "US",
        currencyCode: "USD",
        rate: 1,
        baseRate: 1,
        fxRegime: "peg",
        pegTarget: 0.5,
        interventionPolicy: {
          floor: 0.5,
          ceiling: 0.51,
          recentInterventions: [{ reservesSpent: 99 }],
        },
      },
    ]);
  const response = await GET();
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.rates[0].interventionBand).toEqual({
    floor: 0.5,
    ceiling: 0.5,
    setAtTurn: null,
    defending: true,
  });
  expect(body.rates[0]).not.toHaveProperty("interventionPolicy");
});
