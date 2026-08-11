import { describe, it, expect } from "vitest";
import { PRIMARY_SECTOR_BY_COMMODITY } from "./commoditySector";

describe("PRIMARY_SECTOR_BY_COMMODITY", () => {
  it("maps each commodity to its highest-rate producing sector", () => {
    expect(PRIMARY_SECTOR_BY_COMMODITY.steel).toBe("manufacturing");
    expect(PRIMARY_SECTOR_BY_COMMODITY.oil).toBe("extraction");
    expect(PRIMARY_SECTOR_BY_COMMODITY.iron).toBe("extraction");
    expect(PRIMARY_SECTOR_BY_COMMODITY.vehicles).toBe("automobiles"); // 0.5 > defense 0.2
    expect(PRIMARY_SECTOR_BY_COMMODITY.electronics).toBe("technology"); // 0.35 > defense 0.15
    expect(PRIMARY_SECTOR_BY_COMMODITY.financial_services).toBe("financial");
    expect(PRIMARY_SECTOR_BY_COMMODITY.food).toBe("agriculture");
  });

  it("covers commodities that are actually produced", () => {
    expect(PRIMARY_SECTOR_BY_COMMODITY.healthcare_services).toBe("healthcare");
    expect(PRIMARY_SECTOR_BY_COMMODITY.software).toBeDefined();
  });
});
