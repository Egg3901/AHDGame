import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import {
  anchorToLocal,
  loadCampaignFxRate,
  getCampaignCurrency,
  campaignLocalRate,
  campaignAnchorToLocal,
} from "./campaignCurrency";

describe("anchorToLocal", () => {
  it("multiplies by rate and rounds", () => {
    expect(anchorToLocal(80000, 0.9396507936068564)).toBe(75172);
    expect(anchorToLocal(0, 0.94)).toBe(0);
  });

  it("is identity at rate 1", () => {
    expect(anchorToLocal(500000, 1)).toBe(500000);
  });
});

describe("campaignLocalRate", () => {
  it("US is 1.0 (parity with anchor)", () => expect(campaignLocalRate("US")).toBe(1.0));
  it("NG is the frozen base rate 1550 (matches the forex baseRate)", () =>
    expect(campaignLocalRate("NG")).toBe(1550));
  it("unknown country falls back to 1.0", () => expect(campaignLocalRate("ZZ")).toBe(1.0));
});

describe("campaignAnchorToLocal", () => {
  it("US round-trips face value", () => expect(campaignAnchorToLocal(38122, "US")).toBe(38122));
  it("NG scales by 1550 and rounds", () =>
    expect(campaignAnchorToLocal(38122, "NG")).toBe(Math.round(38122 * 1550)));
  it("is zero for zero anchor", () => expect(campaignAnchorToLocal(0, "NG")).toBe(0));
});

describe("getCampaignCurrency", () => {
  it("maps US to USD", () => {
    expect(getCampaignCurrency("US")).toBe("USD");
  });
  it("falls back to USD for unknown country", () => {
    expect(getCampaignCurrency("ZZ" as never)).toBe("USD");
  });
});

describe("loadCampaignFxRate", () => {
  let db: MockDb;
  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("exchangeRates");
  });

  it("returns the stored rate and currency for the country", async () => {
    db.collectionMocks.exchangeRates!.findOne.mockResolvedValue({
      currencyCode: "USD",
      rate: 0.94,
    });
    const r = await loadCampaignFxRate(db as unknown as Db, "US");
    expect(r.currencyCode).toBe("USD");
    expect(r.rate).toBe(0.94);
  });

  it("falls back to rate 1 when no rate doc exists", async () => {
    db.collectionMocks.exchangeRates!.findOne.mockResolvedValue(null);
    const r = await loadCampaignFxRate(db as unknown as Db, "US");
    expect(r.rate).toBe(1);
    expect(r.currencyCode).toBe("USD");
  });
});
