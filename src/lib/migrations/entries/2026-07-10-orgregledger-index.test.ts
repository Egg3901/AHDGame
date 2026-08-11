import { describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { migration } from "./2026-07-10-orgregledger-index";

function mockDb() {
  const createIndex = vi.fn().mockResolvedValue("reg_ledger_lookup");
  const collection = vi.fn().mockReturnValue({ createIndex });
  const db = { collection } as unknown as Db;
  return { db, collection, createIndex };
}

describe("2026-07-10-orgregledger-index migration", () => {
  it("creates the compound reg-ledger lookup index on orgRegLedger", async () => {
    const { db, collection, createIndex } = mockDb();
    await migration.execute(db, { dryRun: false });

    expect(collection).toHaveBeenCalledWith("orgRegLedger");
    expect(createIndex).toHaveBeenCalledTimes(1);
    const [keys, options] = createIndex.mock.calls[0];
    // Equality fields of getStateRegLedger's query first, sort key (turn desc) last.
    expect(keys).toEqual({ countryId: 1, stateId: 1, partyId: 1, metric: 1, turn: -1 });
    expect(options).toMatchObject({ name: "reg_ledger_lookup" });
  });

  it("does not touch the database in dry-run mode", async () => {
    const { db, createIndex } = mockDb();
    const result = await migration.execute(db, { dryRun: true });

    expect(createIndex).not.toHaveBeenCalled();
    expect(result.documentsUpdated).toBe(0);
  });

  it("is marked idempotent (createIndex with a stable name is a safe re-run)", () => {
    expect(migration.idempotent).toBe(true);
  });
});
