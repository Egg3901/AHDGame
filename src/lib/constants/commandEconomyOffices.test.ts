import { describe, it, expect } from "vitest";
import {
  commandEconomyOffices,
  clampRange,
  CREDIT_AGGRESSIVENESS_RANGE,
  LABOR_QUALITY_RANGE,
} from "./commandEconomyOffices";

describe("commandEconomyOffices", () => {
  it("maps the command countries to their planning + state-bank seats", () => {
    expect(commandEconomyOffices("RU")).toEqual({
      plannerCabinetId: "chairman_of_gosplan",
      bankCabinetId: "gosbank_liaison",
    });
    expect(commandEconomyOffices("CN")).toEqual({
      plannerCabinetId: "vice_premier",
      bankCabinetId: "pboc_governor",
    });
    // DD mirrors RU's slot ids (ddCabinet.ts): Staatliche Plankommission chair
    // + Staatsbank der DDR liaison.
    expect(commandEconomyOffices("DD")).toEqual({
      plannerCabinetId: "chairman_of_gosplan",
      bankCabinetId: "gosbank_liaison",
    });
  });

  it("returns null for market countries and empty input", () => {
    expect(commandEconomyOffices("US")).toBeNull();
    expect(commandEconomyOffices(null)).toBeNull();
    expect(commandEconomyOffices(undefined)).toBeNull();
  });
});

describe("clampRange", () => {
  it("clamps to the range and maps non-finite to the floor", () => {
    expect(clampRange(0.5, CREDIT_AGGRESSIVENESS_RANGE)).toBe(0.5);
    expect(clampRange(5, CREDIT_AGGRESSIVENESS_RANGE)).toBe(1);
    expect(clampRange(-2, LABOR_QUALITY_RANGE)).toBe(0);
    expect(clampRange(Number.NaN, LABOR_QUALITY_RANGE)).toBe(0);
  });
});
