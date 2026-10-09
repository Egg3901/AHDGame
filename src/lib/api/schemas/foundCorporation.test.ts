import { describe, it, expect } from "vitest";
import { foundCorporationSchema } from "./corporations";
import { OPERATING_SECTOR_TYPES } from "@/lib/constants/corporations";

const base = { name: "Acme Holdings", tickerSymbol: "ACME", type: "manufacturing" };

describe("foundCorporationSchema operating lanes", () => {
  it("accepts every operating lane as primary and secondary", () => {
    for (const lane of OPERATING_SECTOR_TYPES) {
      expect(foundCorporationSchema.safeParse({ ...base, type: lane }).success).toBe(true);
      expect(foundCorporationSchema.safeParse({ ...base, secondaryType: lane }).success).toBe(true);
    }
  });

  it("founds vehicle makers and entertainment houses through their lanes", () => {
    expect(
      foundCorporationSchema.safeParse({ ...base, type: "manufacturing_vehicles" }).success
    ).toBe(true);
    expect(foundCorporationSchema.safeParse({ ...base, type: "media_entertainment" }).success).toBe(
      true
    );
  });

  it("still rejects unknown types", () => {
    expect(foundCorporationSchema.safeParse({ ...base, type: "nope" }).success).toBe(false);
  });
});
