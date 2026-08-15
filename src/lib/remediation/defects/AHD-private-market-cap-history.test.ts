import { describe, expect, it } from "vitest";
import type { MarketCapHistory } from "@/lib/db/types";
import { removeUnlistedCaps } from "./AHD-private-market-cap-history";

describe("removeUnlistedCaps", () => {
  it("subtracts private capitalization while preserving the candle spread", () => {
    const row: MarketCapHistory = {
      turn: 108,
      globalMarketCap: 20_000,
      globalHigh: 20_100,
      globalLow: 19_900,
      nyseMarketCap: 18_000,
      nyseHigh: 18_100,
      nyseLow: 17_900,
      ftseMarketCap: 2_000,
      ftseHigh: 2_020,
      ftseLow: 1_980,
      exchangeCaps: {
        nyse: { marketCap: 18_000, high: 18_100, low: 17_900 },
        ftse: { marketCap: 2_000, high: 2_020, low: 1_980 },
      },
      bySector: { defense: 16_000, finance: 4_000 },
      createdAt: new Date(),
    };

    const repaired = removeUnlistedCaps(row, {
      global: 15_000,
      byExchange: { nyse: 15_000 },
      bySector: { defense: 15_000 },
    });

    expect(repaired.listingUniverse).toBe("public-only");
    expect(repaired.globalMarketCap).toBe(5_000);
    expect(repaired.globalHigh).toBe(5_100);
    expect(repaired.globalLow).toBe(4_900);
    expect(repaired.exchangeCaps?.nyse).toEqual({ marketCap: 3_000, high: 3_100, low: 2_900 });
    expect(repaired.exchangeCaps?.ftse).toEqual({ marketCap: 2_000, high: 2_020, low: 1_980 });
    expect(repaired.bySector).toEqual({ defense: 1_000, finance: 4_000 });
  });
});
