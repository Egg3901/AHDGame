import { describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { migration } from "./2026-07-04-union-leadership-indexes";

describe("2026-07-04-union-leadership-indexes migration", () => {
  it("plans unique organizer and vote indexes", async () => {
    const createIndex = vi.fn().mockResolvedValue("ok");
    const db = {
      collection: () => ({ createIndex }),
    } as unknown as Db;

    const result = await migration.execute(db, { dryRun: false });
    expect(createIndex).toHaveBeenCalledTimes(2);
    expect(result.notes).toHaveLength(2);
  });
});
