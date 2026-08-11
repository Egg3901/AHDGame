import { describe, expect, it } from "vitest";
import { plantSizeUnits } from "@/lib/constants/facilityQuantum";
import { SECTOR_EXPANSION_BASE_COST } from "@/lib/constants/corporations";
import { getEraNominalAmount } from "@/lib/constants/sectorSeedEra";
import { foundingStarterUnits, sectorEntryFeeAnchor } from "./foundingPlant";

describe("foundingPlant", () => {
  it("sizes the starter to one facility quantum", () => {
    expect(foundingStarterUnits("agriculture")).toBe(plantSizeUnits("agriculture"));
    expect(foundingStarterUnits("agriculture")).toBe(60);
    expect(foundingStarterUnits("manufacturing")).toBe(25);
  });

  it("era-deflates the entry fee for 1953 and leaves modern unchanged", () => {
    expect(sectorEntryFeeAnchor("2019-default")).toBe(SECTOR_EXPANSION_BASE_COST);
    expect(sectorEntryFeeAnchor("1953-default")).toBe(
      getEraNominalAmount(SECTOR_EXPANSION_BASE_COST, "1953-default")
    );
    expect(sectorEntryFeeAnchor("1953-default")).toBeLessThan(SECTOR_EXPANSION_BASE_COST / 50);
  });

  it("applies the tech expansion discount after era scaling", () => {
    const full = sectorEntryFeeAnchor("1953-default", 0);
    const half = sectorEntryFeeAnchor("1953-default", 0.5);
    expect(half).toBe(Math.round(full * 0.5));
  });
});
