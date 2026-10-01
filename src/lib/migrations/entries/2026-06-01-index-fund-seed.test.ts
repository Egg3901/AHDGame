import { describe, it, expect } from "vitest";
import { getAllFundDefinitions } from "@/lib/indexFunds/fundDefinitions";
import { migration } from "./2026-06-01-index-fund-seed";
import type { MigrationContext } from "../types";

describe("2026-06-01-index-fund-seed migration", () => {
  it("has stable id and is idempotent", () => {
    expect(migration.id).toBe("2026-06-01-index-fund-seed");
    expect(migration.idempotent).toBe(true);
  });

  it("seeds exactly the number of definitions in getAllFundDefinitions", () => {
    const definitions = getAllFundDefinitions();
    // 16 country funds (8 countries × 2 each) + 1 global broad + 17 sector + 12 bond = 46
    expect(definitions.length).toBe(46);
  });

  it("produces valid fund documents with all required fields", () => {
    const definitions = getAllFundDefinitions();
    for (const def of definitions) {
      expect(def.slug).toBeTruthy();
      expect(def.name).toBeTruthy();
      expect(def.ticker).toBeTruthy();
      expect(["country", "global"]).toContain(def.scope);
      expect(["broad", "sector", "bond"]).toContain(def.kind);
      expect(def.anchorCurrencyCode).toBeTruthy();
    }
  });

  it("country funds have countryId, sector funds have sectorType", () => {
    const definitions = getAllFundDefinitions();
    for (const def of definitions) {
      if (def.scope === "country") {
        expect(def.countryId).toBeDefined();
        expect(def.sectorType).toBeUndefined();
      }
      if (def.kind === "sector") {
        expect(def.sectorType).toBeDefined();
        expect(def.scope).toBe("global");
      }
    }
  });

  it("dry run reports would-upsert but does not touch DB", async () => {
    const ctx: MigrationContext = { dryRun: true };
    const result = await migration.execute({} as any, ctx);
    expect(result.notes?.length).toBeGreaterThan(0);
    expect(result.notes![0]).toMatch(/would upsert \d+ fund definitions/);
  });
});
