import { describe, it, expect, vi } from "vitest";
import type { Db } from "mongodb";
import { backfillReportParticipants } from "./2026-08-04-battle-report-participants";

vi.mock("../utils/db", () => ({ connectDb: vi.fn(), closeDb: vi.fn() }));

function stubDb(docs: Array<Record<string, unknown>>) {
  const bulkWrite = vi.fn();
  const db = {
    collection: () => ({
      countDocuments: async (q: Record<string, unknown>) =>
        "attackers" in (q as { attackers?: unknown }) && docs.filter((d) => d.attackers).length,
      find: (q: Record<string, unknown>) => ({
        toArray: async () => {
          void q;
          return docs.filter((d) => !d.attackers);
        },
      }),
      bulkWrite,
    }),
  } as unknown as Db;
  return { db, bulkWrite };
}

const legacy = () => [
  { _id: "r1", declarerCountry: "US", targetCountry: "CN" },
  { _id: "r2", declarerCountry: "UK", targetCountry: "RU" },
];

describe("backfillReportParticipants", () => {
  it("backfills the arrays from the scalars", async () => {
    const { db, bulkWrite } = stubDb(legacy());
    const r = await backfillReportParticipants(db);
    expect(r.updated).toBe(2);
    const ops = bulkWrite.mock.calls[0][0] as Array<{
      updateOne: { update: { $set: { attackers: string[]; defenders: string[] } } };
    }>;
    expect(ops[0].updateOne.update.$set.attackers).toEqual(["US"]);
    expect(ops[0].updateOne.update.$set.defenders).toEqual(["CN"]);
    expect(ops[1].updateOne.update.$set.attackers).toEqual(["UK"]);
  });

  it("is idempotent — a document already carrying a roster is never rewritten", async () => {
    // Critical: re-running must not collapse a real coalition back to one name.
    const { db, bulkWrite } = stubDb([
      { _id: "r1", declarerCountry: "US", targetCountry: "CN", attackers: ["US", "UK"] },
    ]);
    const r = await backfillReportParticipants(db);
    expect(r.updated).toBe(0);
    expect(bulkWrite).not.toHaveBeenCalled();
  });

  it("writes nothing on a dry run", async () => {
    const { db, bulkWrite } = stubDb(legacy());
    const r = await backfillReportParticipants(db, true);
    expect(r.updated).toBe(2);
    expect(bulkWrite).not.toHaveBeenCalled();
  });

  it("handles an empty collection", async () => {
    const { db, bulkWrite } = stubDb([]);
    const r = await backfillReportParticipants(db);
    expect(r).toEqual({ updated: 0, alreadyDone: 0 });
    expect(bulkWrite).not.toHaveBeenCalled();
  });
});
