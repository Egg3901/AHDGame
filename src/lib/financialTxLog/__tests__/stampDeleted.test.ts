import { describe, it, expect, beforeEach, vi } from "vitest";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { stampSubjectDeleted } from "../stampDeleted";

vi.mock("@/lib/financialTxLog/expiresAt", () => ({
  computeExpiresAt: vi.fn().mockResolvedValue(new Date("2026-05-04T00:00:00Z")), // 7 days after the test stamp
}));

describe("stampSubjectDeleted", () => {
  let db: MockDb;
  const entityId = new ObjectId();
  const deletedAt = new Date("2026-04-27T16:00:00Z");

  beforeEach(() => {
    db = createMockDb();
    db.collection("financialTxLog");
    db.collection("gameConfig"); // computeExpiresAt is mocked but pre-init for safety
  });

  it("stamps subjectDeletedAt on rows where entity is the subject (un-stamped only)", async () => {
    await stampSubjectDeleted(db as never, entityId, {
      sequentialId: 213,
      deletedAt,
    });

    const subjectCall = db.collectionMocks.financialTxLog.updateMany.mock.calls[0];
    expect(subjectCall[0]).toEqual({
      subjectId: entityId,
      subjectDeletedAt: { $exists: false },
    });
    expect(subjectCall[1]).toMatchObject({
      $set: { subjectDeletedAt: deletedAt, subjectSequentialId: 213 },
      $max: { expiresAt: new Date("2026-05-04T00:00:00Z") },
    });
  });

  it("stamps counterpartyDeletedAt separately on rows where entity is the counterparty", async () => {
    await stampSubjectDeleted(db as never, entityId, {
      sequentialId: 213,
      deletedAt,
    });

    const calls = db.collectionMocks.financialTxLog.updateMany.mock.calls;
    expect(calls).toHaveLength(2);
    const cptyCall = calls[1];
    expect(cptyCall[0]).toEqual({
      counterpartyId: entityId,
      counterpartyDeletedAt: { $exists: false },
    });
    expect(cptyCall[1]).toMatchObject({
      $set: {
        counterpartyDeletedAt: deletedAt,
        counterpartySequentialId: 213,
      },
    });
  });

  it("works without sequentialId (admin force-delete with no seq lookup)", async () => {
    await stampSubjectDeleted(db as never, entityId, { deletedAt });

    const subjectCall = db.collectionMocks.financialTxLog.updateMany.mock.calls[0];
    const subjectSet = (subjectCall[1] as { $set: Record<string, unknown> }).$set;
    expect(subjectSet).toEqual({ subjectDeletedAt: deletedAt });
    expect(subjectSet.subjectSequentialId).toBeUndefined();
  });

  it("uses the current date when deletedAt is not provided", async () => {
    const before = Date.now();
    await stampSubjectDeleted(db as never, entityId);
    const after = Date.now();

    const stampedAt = (
      db.collectionMocks.financialTxLog.updateMany.mock.calls[0][1] as {
        $set: { subjectDeletedAt: Date };
      }
    ).$set.subjectDeletedAt;
    expect(stampedAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(stampedAt.getTime()).toBeLessThanOrEqual(after);
  });
});
