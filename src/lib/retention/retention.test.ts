import { describe, it, expect, beforeEach, vi } from "vitest";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { RetentionMode } from "./policy";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/r2", () => ({ isR2Enabled: vi.fn(() => true) }));
vi.mock("./archive", () => ({
  archiveDocs: vi.fn(async () => ({ archivedCount: 9, parts: 1, bytes: 10, keys: ["k"] })),
}));

import { getDb } from "@/lib/mongodb";
import { isR2Enabled } from "@/lib/r2";
import { archiveDocs } from "./archive";
import { runRetention } from "./retention";

let db: MockDb;

function withCurrentTurn(turn: number) {
  db.collection("gameState").findOne = vi.fn().mockResolvedValue({ currentTurn: turn });
}

beforeEach(() => {
  vi.clearAllMocks();
  db = createMockDb();
  (getDb as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(db);
  (isR2Enabled as unknown as ReturnType<typeof vi.fn>).mockReturnValue(true);
  withCurrentTurn(1009);
});

describe("runRetention — dry run", () => {
  it("performs NO writes and returns a manifest", async () => {
    const col = db.collection("financialTxLog");
    col.countDocuments = vi.fn().mockResolvedValue(100);

    const summary = await runRetention({ dryRun: true, collections: ["financialTxLog"] });

    expect(summary.dryRun).toBe(true);
    expect(col.deleteMany).not.toHaveBeenCalled();
    expect(archiveDocs).not.toHaveBeenCalled();
    const r = summary.results[0];
    expect(r.cutoff).toBe(1009 - 168);
    expect(r.wouldDelete).toBe(100);
  });
});

describe("runRetention — guard exclusion", () => {
  it("excludes each corp's latest row from the deleteMany filter", async () => {
    const col = db.collection("corporationHistory");
    col.countDocuments = vi.fn().mockResolvedValue(10);
    col.aggregate = vi.fn().mockReturnValue({
      toArray: vi.fn().mockResolvedValue([{ keepId: "corpLatest1" }, { keepId: "corpLatest2" }]),
    });
    col.deleteMany = vi.fn().mockResolvedValue({ deletedCount: 8 });

    await runRetention({ dryRun: false, collections: ["corporationHistory"] });

    expect(col.deleteMany).toHaveBeenCalledTimes(1);
    const filter = col.deleteMany.mock.calls[0][0] as Record<string, unknown>;
    const and = filter.$and as Record<string, unknown>[];
    const guardClause = and.find((c) => "_id" in c) as { _id: { $nin: unknown[] } };
    expect(guardClause._id.$nin).toEqual(["corpLatest1", "corpLatest2"]);
    // archived set is exactly the deleted (guard-excluded) set
    expect(archiveDocs).toHaveBeenCalledTimes(1);
  });
});

describe("runRetention — downsample", () => {
  it("deletes only rows NOT congruent to keep-every-K", async () => {
    const col = db.collection("orgRegLedger");
    col.countDocuments = vi.fn().mockResolvedValue(1000);
    col.deleteMany = vi.fn().mockResolvedValue({ deletedCount: 800 });

    const summary = await runRetention({ dryRun: false, collections: ["orgRegLedger"] });

    const filter = col.deleteMany.mock.calls[0][0] as Record<string, unknown>;
    const and = filter.$and as Record<string, unknown>[];
    const expr = and.find((c) => "$expr" in c) as { $expr: { $ne: unknown[] } };
    expect(expr.$expr.$ne).toBeDefined();
    // downsample archives the FULL old window (recoverable), not just the deleted subset
    expect(summary.results[0].mode).toBe(RetentionMode.DOWNSAMPLE);
    expect(archiveDocs).toHaveBeenCalledTimes(1);
  });
});

describe("runRetention — indexFundTransactions null-turn fallback", () => {
  it("uses a createdAt fallback in the old-row filter", async () => {
    const col = db.collection("indexFundTransactions");
    const seen: unknown[] = [];
    col.countDocuments = vi.fn().mockImplementation((f: unknown) => {
      seen.push(f);
      return Promise.resolve(5);
    });

    await runRetention({ dryRun: true, collections: ["indexFundTransactions"] });

    const base = seen[0] as Record<string, unknown>;
    expect(base.$or).toBeDefined();
    const orClauses = base.$or as Record<string, unknown>[];
    const hasCreatedAt = JSON.stringify(orClauses).includes("createdAt");
    expect(hasCreatedAt).toBe(true);
  });
});

describe("runRetention — archive-only never deletes", () => {
  it("archives actionLogs but issues no deleteMany", async () => {
    const col = db.collection("actionLogs");
    col.countDocuments = vi.fn().mockResolvedValue(50);

    await runRetention({ dryRun: false, collections: ["actionLogs"] });

    expect(archiveDocs).toHaveBeenCalledTimes(1);
    expect(col.deleteMany).not.toHaveBeenCalled();
  });
});
