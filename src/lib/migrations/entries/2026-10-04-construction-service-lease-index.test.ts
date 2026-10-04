import { describe, expect, it } from "vitest";
import type { Db } from "mongodb";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { migration } from "./2026-10-04-construction-service-lease-index";

describe("construction service recovery index", () => {
  it("defaults to a dry run and applies idempotently without changing documents", async () => {
    const memory = createInMemoryDb();
    const db = memory as unknown as Db;
    await migration.execute(db, { dryRun: true });
    expect(await memory.collection("corporations").indexes()).toEqual([]);
    await migration.execute(db, { dryRun: false });
    await migration.execute(db, { dryRun: false });
    expect(await memory.collection("corporations").indexes()).toEqual([
      {
        name: "corporations_construction_service_turn",
        key: { "bankConstructionFunding.service.turn": 1 },
        sparse: true,
      },
    ]);
  });
});
