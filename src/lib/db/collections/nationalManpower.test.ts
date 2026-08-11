import { describe, it, expect, beforeEach } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { getNationalManpower, setNationalManpower } from "./nationalManpower";

describe("nationalManpower collection", () => {
  let db: MockDb;
  beforeEach(() => {
    db = createMockDb();
    db.collection("nationalManpower");
  });

  it("returns defaults when no doc exists", async () => {
    db.collectionMocks.nationalManpower.findOne.mockResolvedValue(null);
    const m = await getNationalManpower(db as unknown as Db, "US");
    expect(m.pool).toBe(0);
    expect(m.mode).toBe("trained");
  });

  it("returns the stored doc when present", async () => {
    db.collectionMocks.nationalManpower.findOne.mockResolvedValue({
      countryId: "US",
      pool: 5000,
      mode: "conscript",
    });
    const m = await getNationalManpower(db as unknown as Db, "US");
    expect(m.pool).toBe(5000);
    expect(m.mode).toBe("conscript");
  });

  it("upserts on write", async () => {
    await setNationalManpower(db as unknown as Db, "US", { pool: 1234 });
    const call = db.collectionMocks.nationalManpower.updateOne.mock.calls[0];
    expect(call[0]).toEqual({ countryId: "US" });
    expect(call[1].$set).toEqual({ pool: 1234 });
    expect(call[2]).toEqual({ upsert: true });
  });
});
