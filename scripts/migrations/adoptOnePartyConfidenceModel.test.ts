import { describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { runAdoptOnePartyConfidenceModel } from "./adoptOnePartyConfidenceModel";

/**
 * The migration's whole job is the guard: raise `hasLeaderConfidenceModel` on a
 * one-party state that never got the field, and leave a converted country's
 * deliberate `false` alone.
 */
function makeDb(docs: Array<Record<string, unknown>>) {
  const updateMany = vi.fn().mockResolvedValue({ modifiedCount: docs.length });
  const find = vi.fn().mockReturnValue({ toArray: () => Promise.resolve(docs) });
  const db = {
    collection: () => ({ find, updateMany }),
  } as unknown as Db;
  return { db, find, updateMany };
}

describe("runAdoptOnePartyConfidenceModel", () => {
  it("filters on governmentType so a converted country is never re-raised", async () => {
    const { db, find } = makeDb([]);
    await runAdoptOnePartyConfidenceModel(db);

    const filter = find.mock.calls[0][0];
    expect(filter.governmentType).toBe("onePartyState");
    expect(filter.hasLeaderConfidenceModel).toEqual({ $ne: true });
  });

  it("only considers countries the config says should carry the model", async () => {
    const { db, find } = makeDb([]);
    await runAdoptOnePartyConfidenceModel(db);

    const ids = find.mock.calls[0][0]._id.$in as string[];
    expect(ids).toContain("DD");
    expect(ids).toContain("RU");
    expect(ids).toContain("CN");
    // A market democracy must never appear in the candidate set.
    expect(ids).not.toContain("US");
    expect(ids).not.toContain("UK");
  });

  it("raises matching countries and reports them", async () => {
    const { db, updateMany } = makeDb([{ _id: "DD" }]);
    const res = await runAdoptOnePartyConfidenceModel(db);

    expect(updateMany).toHaveBeenCalledOnce();
    expect(updateMany.mock.calls[0][1].$set.hasLeaderConfidenceModel).toBe(true);
    expect(res.documentsUpdated).toBe(1);
    expect(res.notes?.some((n) => n.includes("DD"))).toBe(true);
  });

  it("writes nothing on a dry run", async () => {
    const { db, updateMany } = makeDb([{ _id: "DD" }]);
    const res = await runAdoptOnePartyConfidenceModel(db, { dryRun: true });

    expect(updateMany).not.toHaveBeenCalled();
    expect(res.documentsUpdated).toBe(0);
    expect(res.documentsScanned).toBe(1);
  });

  it("is a no-op when nothing needs raising", async () => {
    const { db, updateMany } = makeDb([]);
    const res = await runAdoptOnePartyConfidenceModel(db);

    expect(updateMany).not.toHaveBeenCalled();
    expect(res.documentsUpdated).toBe(0);
  });
});
