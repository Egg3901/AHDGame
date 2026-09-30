import { beforeEach, expect, it, vi } from "vitest";
import { createMockDb } from "@/lib/test-utils/mockDb";
import { planEuroSettlement } from "@/lib/currency/euro/rules";
const mocks = vi.hoisted(() => ({ getDb: vi.fn(), isForexEnabled: vi.fn() }));
vi.mock("@/lib/mongodb", () => ({ getDb: mocks.getDb }));
vi.mock("@/lib/currency/featureFlag", () => ({ isForexEnabled: mocks.isForexEnabled }));
import { GET } from "./route";
beforeEach(() => {
  vi.clearAllMocks();
  mocks.isForexEnabled.mockResolvedValue(true);
});
it.each([true, false])(
  "publishes common quotes and source spreads when the anchor is available: %s",
  async (available) => {
    const db = createMockDb();
    mocks.getDb.mockResolvedValue(db);
    const union = planEuroSettlement({
      year: 1999,
      turn: 385,
      preset: "1991-default",
      europeanMembers: ["DE", "IE", "UK"],
      consentedCountries: ["DE", "IE", "UK"],
      rates: { EUR: 0.8, IEP: 0.7, GBP: 0.6 },
    }).union;
    db.collection("gameState").findOne.mockResolvedValue({ euroMonetaryUnion: union });
    db.collection("exchangeRates")
      .find()
      .toArray.mockResolvedValue([
        { currencyCode: "GBP", rate: 99, baseRate: 0.6, forexSpreadStrength: 0.5 },
        { currencyCode: "USD", rate: 1, baseRate: 1, forexSpreadStrength: 0.8 },
        ...(available
          ? [{ currencyCode: "EUR", rate: 1.6, baseRate: 0.8, forexSpreadStrength: 1.5 }]
          : []),
      ]);
    const response = await GET();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.rates.USD).toBe(1);
    expect(body.spreadStrengths.USD).toBe(0.8);
    if (available) {
      expect(body.rates.GBP).toBeCloseTo(1.2);
      expect(body.spreadStrengths.GBP).toBe(1.5);
      expect(body.baseRates.GBP).toBe(0.6);
    } else expect(body.rates.GBP).toBeUndefined();
  }
);
it("retains independent quotes and spreads before union settlement", async () => {
  const db = createMockDb();
  mocks.getDb.mockResolvedValue(db);
  db.collection("exchangeRates")
    .find()
    .toArray.mockResolvedValue([{ currencyCode: "GBP", rate: 0.6, forexSpreadStrength: 0.5 }]);
  const body = await (await GET()).json();
  expect(body.rates.GBP).toBe(0.6);
  expect(body.spreadStrengths.GBP).toBe(0.5);
});
