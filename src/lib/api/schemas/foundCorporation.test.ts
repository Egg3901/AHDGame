import { describe, it, expect } from "vitest";
import { foundCorporationSchema } from "./corporations";
import {
  CORPORATION_TYPES,
  FOUNDABLE_CORPORATION_TYPES,
  isRetiredCorporationType,
} from "@/lib/constants/corporations";

const base = { name: "Acme Holdings", tickerSymbol: "ACME", type: "manufacturing" };

describe("foundCorporationSchema retired sector types", () => {
  it("foundable types are CORPORATION_TYPES minus automobiles and entertainment", () => {
    expect(FOUNDABLE_CORPORATION_TYPES).not.toContain("automobiles");
    expect(FOUNDABLE_CORPORATION_TYPES).not.toContain("entertainment");
    expect(FOUNDABLE_CORPORATION_TYPES.length).toBe(CORPORATION_TYPES.length - 2);
    expect(CORPORATION_TYPES).toContain("automobiles");
    expect(isRetiredCorporationType("entertainment")).toBe(true);
  });

  it("accepts every foundable type as primary and secondary", () => {
    for (const t of FOUNDABLE_CORPORATION_TYPES) {
      expect(foundCorporationSchema.safeParse({ ...base, type: t }).success).toBe(true);
      expect(foundCorporationSchema.safeParse({ ...base, secondaryType: t }).success).toBe(true);
    }
  });

  it.each(["automobiles", "entertainment"])("rejects retired %s as primary", (t) => {
    const r = foundCorporationSchema.safeParse({ ...base, type: t });
    expect(r.success).toBe(false);
    expect(JSON.stringify(r.error?.issues)).toContain("no longer a foundable sector");
  });

  it.each(["automobiles", "entertainment"])("rejects retired %s as secondary", (t) => {
    expect(foundCorporationSchema.safeParse({ ...base, secondaryType: t }).success).toBe(false);
  });

  it("still rejects unknown types", () => {
    expect(foundCorporationSchema.safeParse({ ...base, type: "nope" }).success).toBe(false);
  });
});
