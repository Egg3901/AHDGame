import { describe, expect, it } from "vitest";
import { formatProductionLevel, productionTone } from "./production";

describe("productionTone", () => {
  it("is error for negative levels (matches the CEO production surface encoding)", () => {
    expect(productionTone(-1)).toBe("error");
    expect(productionTone(-25)).toBe("error");
  });

  it("is success for positive levels", () => {
    expect(productionTone(1)).toBe("success");
    expect(productionTone(25)).toBe("success");
  });

  it("is neutral at zero", () => {
    expect(productionTone(0)).toBe("neutral");
  });
});

describe("formatProductionLevel", () => {
  it("signs positive levels explicitly, as a percent", () => {
    expect(formatProductionLevel(12)).toBe("+12%");
  });

  it("keeps the negative sign", () => {
    expect(formatProductionLevel(-12)).toBe("-12%");
  });

  it("renders zero unsigned", () => {
    expect(formatProductionLevel(0)).toBe("0%");
  });
});
