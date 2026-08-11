import { describe, it, expect } from "vitest";
import {
  getAllFundDefinitions,
  BROAD_FUND_DEFINITIONS,
  SECTOR_FUND_DEFINITIONS,
  GLOBAL_BROAD_FUND,
  SECTOR_FUND_PRIMARY_TYPES,
  BROAD_FUND_COUNTRIES,
} from "./fundDefinitions";

describe("fundDefinitions", () => {
  describe("BROAD_FUND_COUNTRIES", () => {
    it("has 8 countries with stock exchanges (US, UK, JP, DE, IE, BR, CN, NG)", () => {
      expect(BROAD_FUND_COUNTRIES).toHaveLength(8);
      const countryIds = BROAD_FUND_COUNTRIES.map((d) => d.countryId);
      expect(countryIds).toContain("US");
      expect(countryIds).toContain("UK");
      expect(countryIds).toContain("JP");
      expect(countryIds).toContain("DE");
      expect(countryIds).toContain("IE");
      expect(countryIds).toContain("BR");
      expect(countryIds).toContain("CN");
      expect(countryIds).toContain("NG");
    });

    it("anchors the Nigerian funds in NGN", () => {
      const ng = BROAD_FUND_COUNTRIES.find((d) => d.countryId === "NG");
      expect(ng?.currencyCode).toBe("NGN");
    });
  });

  describe("BROAD_FUND_DEFINITIONS", () => {
    it("has 8 country fund groups", () => {
      expect(BROAD_FUND_DEFINITIONS).toHaveLength(8);
    });

    it("names the Nigerian funds after the NGX", () => {
      const ng = BROAD_FUND_DEFINITIONS.find((d) => d.countryId === "NG");
      expect(ng?.funds.map((f) => f.name)).toEqual(["NGX 25 Index", "NGX 50 Index"]);
    });

    it("each country has a Top 25 and Top 50 fund", () => {
      for (const def of BROAD_FUND_DEFINITIONS) {
        expect(def.funds).toHaveLength(2);
        expect(def.funds[0].topN).toBe(25);
        expect(def.funds[1].topN).toBe(50);
      }
    });

    it("country fund slugs follow pattern {country}_top_{n}", () => {
      for (const def of BROAD_FUND_DEFINITIONS) {
        for (const fund of def.funds) {
          expect(fund.slug).toBe(`${def.countryId.toLowerCase()}_top_${fund.topN}`);
        }
      }
    });
  });

  describe("GLOBAL_BROAD_FUND", () => {
    it("is a global broad-market fund anchored in USD", () => {
      expect(GLOBAL_BROAD_FUND.scope).toBe("global");
      expect(GLOBAL_BROAD_FUND.kind).toBe("broad");
      expect(GLOBAL_BROAD_FUND.anchorCurrencyCode).toBe("USD");
      expect(GLOBAL_BROAD_FUND.topN).toBe(50);
    });
  });

  describe("SECTOR_FUND_DEFINITIONS", () => {
    it("has 17 sector funds — one per CorporationType", () => {
      expect(SECTOR_FUND_DEFINITIONS).toHaveLength(17);
    });

    it("all sector funds are global scope and USD-anchored", () => {
      for (const fund of SECTOR_FUND_DEFINITIONS) {
        expect(fund.scope).toBe("global");
        expect(fund.kind).toBe("sector");
        expect(fund.anchorCurrencyCode).toBe("USD");
      }
    });

    it("every sectorType is a valid CorporationType", () => {
      for (const fund of SECTOR_FUND_DEFINITIONS) {
        expect(fund.sectorType).toBeTruthy();
      }
    });

    it("all sector slugs are unique", () => {
      const slugs = SECTOR_FUND_DEFINITIONS.map((f) => f.slug);
      expect(new Set(slugs).size).toBe(slugs.length);
    });

    it("all sector tickers are unique", () => {
      const tickers = SECTOR_FUND_DEFINITIONS.map((f) => f.ticker);
      expect(new Set(tickers).size).toBe(tickers.length);
    });
  });

  describe("SECTOR_FUND_PRIMARY_TYPES", () => {
    it("maps every sector label to exactly one CorporationType (standalone funds)", () => {
      for (const [_label, types] of Object.entries(SECTOR_FUND_PRIMARY_TYPES)) {
        expect(types).toHaveLength(1);
      }
    });

    it("has a mapping for every sector fund definition", () => {
      for (const fund of SECTOR_FUND_DEFINITIONS) {
        const mapped = SECTOR_FUND_PRIMARY_TYPES[fund.sectorLabel];
        expect(mapped).toBeDefined();
        expect(mapped).toContain(fund.sectorType);
      }
    });
  });

  describe("getAllFundDefinitions", () => {
    it("returns the correct total: 8×2 country broad + 1 global broad + 17 sector = 34", () => {
      const all = getAllFundDefinitions();
      expect(all).toHaveLength(34);
    });

    it("returns unique slugs for all funds", () => {
      const all = getAllFundDefinitions();
      const slugs = all.map((f) => f.slug);
      expect(new Set(slugs).size).toBe(slugs.length);
    });

    it("returns unique tickers for all funds", () => {
      const all = getAllFundDefinitions();
      const tickers = all.map((f) => f.ticker);
      expect(new Set(tickers).size).toBe(tickers.length);
    });

    it("country funds have countryId and topN", () => {
      const all = getAllFundDefinitions();
      const countryFunds = all.filter((f) => f.scope === "country");
      expect(countryFunds.length).toBe(16); // 8 countries × 2
      for (const f of countryFunds) {
        expect(f.countryId).toBeTruthy();
        expect(f.topN).toBeTruthy();
      }
    });

    it("sector funds have sectorType but no countryId", () => {
      const all = getAllFundDefinitions();
      const sectorFunds = all.filter((f) => f.kind === "sector");
      for (const f of sectorFunds) {
        expect(f.sectorType).toBeTruthy();
        expect(f.countryId).toBeUndefined();
      }
    });

    it("global broad fund has no countryId and no sectorType", () => {
      const all = getAllFundDefinitions();
      const globalBroad = all.find((f) => f.scope === "global" && f.kind === "broad");
      expect(globalBroad).toBeTruthy();
      expect(globalBroad!.countryId).toBeUndefined();
      expect(globalBroad!.sectorType).toBeUndefined();
    });
  });
});
