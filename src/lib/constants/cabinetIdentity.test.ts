import { describe, it, expect } from "vitest";
import { CABINET_IDENTITY, getCabinetIdentity, cabinetIdentityVars } from "./cabinetIdentity";

describe("cabinet identity", () => {
  it("defines an identity for all six countries", () => {
    for (const id of ["US", "UK", "CN", "DE", "JP", "IE"] as const) {
      expect(CABINET_IDENTITY[id]).toBeDefined();
      expect(getCabinetIdentity(id).gov).toMatch(/^#/);
    }
  });

  it("marks CN and JP as CJK serif", () => {
    expect(getCabinetIdentity("CN").serif).toBe("cjk");
    expect(getCabinetIdentity("JP").serif).toBe("cjk");
    expect(getCabinetIdentity("US").serif).toBe("mono");
  });

  it("emits CSS custom properties", () => {
    const vars = cabinetIdentityVars("US") as Record<string, string>;
    expect(vars["--gov"]).toBe(getCabinetIdentity("US").gov);
    expect(vars["--g0"]).toBe(getCabinetIdentity("US").g0);
  });

  it("falls back for an unknown country", () => {
    expect(getCabinetIdentity("ZZ").gov).toBe(getCabinetIdentity("UK").gov);
  });
});
