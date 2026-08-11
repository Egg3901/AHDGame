import { describe, it, expect } from "vitest";
import { getAllFundDefinitions } from "@/lib/indexFunds/fundDefinitions";
import { migration } from "./2026-07-04-ngx-index-fund-seed";
import type { MigrationContext } from "../types";

describe("2026-07-04-ngx-index-fund-seed migration", () => {
  it("has stable id and is idempotent", () => {
    expect(migration.id).toBe("2026-07-04-ngx-index-fund-seed");
    expect(migration.idempotent).toBe(true);
  });

  it("the definition inventory now includes the two NGX broad funds", () => {
    const definitions = getAllFundDefinitions();
    const ng = definitions.filter((d) => d.countryId === "NG");
    expect(ng.map((d) => d.slug).sort()).toEqual(["ng_top_25", "ng_top_50"]);
    expect(ng.map((d) => d.ticker).sort()).toEqual(["NG25", "NG50"]);
    for (const def of ng) {
      expect(def.anchorCurrencyCode).toBe("NGN");
      expect(def.scope).toBe("country");
      expect(def.kind).toBe("broad");
    }
  });

  it("dry run reports would-upsert but does not touch DB", async () => {
    const ctx: MigrationContext = { dryRun: true };
    const result = await migration.execute({} as any, ctx);
    expect(result.notes?.length).toBeGreaterThan(0);
    expect(result.notes![0]).toMatch(/would upsert \d+ fund definitions/);
  });
});
