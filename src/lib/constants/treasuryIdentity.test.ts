import { describe, it, expect } from "vitest";
import { COUNTRY_ORDER } from "@/lib/constants/countries";
import { getNationalIdentity } from "@/lib/constants/nationalIdentity";
import { getTreasuryIdentity } from "./treasuryIdentity";

describe("treasuryIdentity", () => {
  it("resolves an identity for every country", () => {
    for (const c of COUNTRY_ORDER) {
      const t = getTreasuryIdentity(c);
      expect(t.glyph.length).toBeGreaterThan(0);
      expect(t.budgetTitle.length).toBeGreaterThan(0);
      expect(t.ministry.length).toBeGreaterThan(0);
    }
  });

  it("reuses the national brand palette + accent (one brand source of truth)", () => {
    for (const c of COUNTRY_ORDER) {
      const t = getTreasuryIdentity(c);
      const n = getNationalIdentity(c);
      expect(t.palette).toEqual(n.palette);
      expect(t.accent).toBe(n.accent);
      expect(t.accentSoft).toBe(n.accentSoft);
    }
  });

  it("uses finance-ministry labels distinct from the corp economy-ministry", () => {
    expect(getTreasuryIdentity("CN").glyph).toBe("财");
    expect(getTreasuryIdentity("CN").ministry).toContain("财政部");
    expect(getNationalIdentity("CN").glyph).toBe("国"); // corp differs
  });
});
