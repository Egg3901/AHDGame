import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import type { ActionAuditInput } from "@/lib/db/types/actionAuditLog";

const captureException = vi.fn();
vi.mock("@sentry/nextjs", () => ({
  captureException: (...a: unknown[]) => captureException(...a),
}));

vi.mock("@/lib/mongodb", () => ({
  getDb: vi.fn(),
}));

const isAuditLogEnabled = vi.fn();
vi.mock("@/lib/audit/featureFlag", () => ({
  isAuditLogEnabled: (...a: unknown[]) => isAuditLogEnabled(...a),
}));

import { getDb } from "@/lib/mongodb";
import {
  recordAudit,
  recordAuditBulk,
  flushRecordAuditBufferForTest,
  resetRecordAuditBufferForTest,
} from "./recordAudit";

function baseEntry(overrides: Partial<ActionAuditInput> = {}): ActionAuditInput {
  return {
    source: "api",
    action: "wire.send",
    category: "money",
    subject: { type: "character", id: "char1" },
    outcome: "ok",
    ...overrides,
  };
}

describe("recordAudit / recordAuditBulk", () => {
  let db: MockDb;

  beforeEach(() => {
    resetRecordAuditBufferForTest();
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("actionAuditLog");
    db.collection("gameState");
    db.collection("gameConfig");
    vi.mocked(getDb).mockResolvedValue(db as never);
    isAuditLogEnabled.mockResolvedValue(true);
  });

  it("flag OFF: buffers but never inserts", async () => {
    isAuditLogEnabled.mockResolvedValue(false);

    recordAudit(baseEntry());
    await flushRecordAuditBufferForTest();

    expect(db.collectionMocks.actionAuditLog.insertMany).not.toHaveBeenCalled();
  });

  it("flag ON: buffers the entry then writes it on flush", async () => {
    recordAudit(baseEntry({ action: "corp.dividends" }));

    // Not written yet — still buffered until a flush happens.
    expect(db.collectionMocks.actionAuditLog.insertMany).not.toHaveBeenCalled();

    await flushRecordAuditBufferForTest();

    expect(db.collectionMocks.actionAuditLog.insertMany).toHaveBeenCalledTimes(1);
    const [docs, opts] = db.collectionMocks.actionAuditLog.insertMany.mock.calls[0];
    expect(opts).toEqual({ ordered: false });
    expect(docs).toHaveLength(1);
    expect(docs[0]).toMatchObject({ action: "corp.dividends", category: "money", outcome: "ok" });
    expect(docs[0]._id).toBeDefined();
    expect(docs[0].ts).toBeInstanceOf(Date);
    expect(docs[0].expiresAt).toBeInstanceOf(Date);
    expect(typeof docs[0].turn).toBe("number");
    expect(typeof docs[0].traceId).toBe("string");
    expect(docs[0].actor).toEqual({ kind: "system" });
  });

  it("insert failure is captured by Sentry and never throws", async () => {
    db.collectionMocks.actionAuditLog.insertMany.mockRejectedValue(new Error("mongo down"));

    recordAudit(baseEntry());
    await expect(flushRecordAuditBufferForTest()).resolves.toBeUndefined();

    expect(captureException).toHaveBeenCalledTimes(1);
    const [err, ctx] = captureException.mock.calls[0];
    expect(err).toBeInstanceOf(Error);
    expect((ctx as { extra: { phase: string } }).extra.phase).toBe("recordAudit.flush");
  });

  it("recordAuditBulk batches many entries into a single insertMany call", async () => {
    const entries = Array.from({ length: 5 }, (_, i) =>
      baseEntry({ action: `turn.event.${i}`, source: "turn" })
    );

    recordAuditBulk(entries);
    expect(db.collectionMocks.actionAuditLog.insertMany).not.toHaveBeenCalled();

    await flushRecordAuditBufferForTest();

    expect(db.collectionMocks.actionAuditLog.insertMany).toHaveBeenCalledTimes(1);
    const [docs] = db.collectionMocks.actionAuditLog.insertMany.mock.calls[0];
    expect(docs).toHaveLength(5);
    expect(docs.map((d: ActionAuditInput) => d.action)).toEqual([
      "turn.event.0",
      "turn.event.1",
      "turn.event.2",
      "turn.event.3",
      "turn.event.4",
    ]);
  });

  it("recordAuditBulk with an empty array is a no-op", async () => {
    recordAuditBulk([]);
    await flushRecordAuditBufferForTest();
    expect(db.collectionMocks.actionAuditLog.insertMany).not.toHaveBeenCalled();
  });

  it("caps delta to at most 8 entries", async () => {
    const delta = Array.from({ length: 12 }, (_, i) => ({
      field: `f${i}`,
      before: i,
      after: i + 1,
    }));
    recordAudit(baseEntry({ delta }));
    await flushRecordAuditBufferForTest();

    const [docs] = db.collectionMocks.actionAuditLog.insertMany.mock.calls[0];
    expect(docs[0].delta).toHaveLength(8);
  });
});
