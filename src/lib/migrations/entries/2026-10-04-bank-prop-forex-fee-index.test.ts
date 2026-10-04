import { describe, expect, it } from "vitest";
import type { Db } from "mongodb";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { migration } from "./2026-10-04-bank-prop-forex-fee-index";

describe("forex fee recovery migration", () => {
  it("leaves indexes unchanged in dry run and creates one sparse index on repeated apply", async () => {
    const memory = createInMemoryDb();
    const db = memory as unknown as Db;
    await migration.execute(db, { dryRun: true });
    expect(await memory.collection("corporations").indexes()).toEqual([]);
    await migration.execute(db, { dryRun: false });
    await migration.execute(db, { dryRun: false });
    expect(await memory.collection("corporations").indexes()).toEqual([
      {
        name: "corporations_bankPropForexFee_turn",
        key: { "bankPropForexFee.turn": 1 },
        sparse: true,
      },
    ]);
  });
});
