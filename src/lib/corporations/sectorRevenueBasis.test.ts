import { describe, it, expect } from "vitest";
import { sectorEconomicRevenue } from "@/lib/corporations/sectorRevenueBasis";
import type { CorporateSector } from "@/lib/db/types";

describe("sectorEconomicRevenue", () => {
  it("prefers realizedRevenue when present (even when 0)", () => {
    expect(sectorEconomicRevenue({ revenue: 1_000, realizedRevenue: 700 } as CorporateSector)).toBe(
      700
    );
    expect(sectorEconomicRevenue({ revenue: 1_000, realizedRevenue: 0 } as CorporateSector)).toBe(
      0
    );
  });

  it("falls back to nameplate revenue when realizedRevenue is absent", () => {
    expect(sectorEconomicRevenue({ revenue: 1_000 } as CorporateSector)).toBe(1_000);
    expect(
      sectorEconomicRevenue({ revenue: 1_000, realizedRevenue: undefined } as CorporateSector)
    ).toBe(1_000);
  });

  it("returns 0 when neither is present", () => {
    expect(sectorEconomicRevenue({} as CorporateSector)).toBe(0);
  });
});
