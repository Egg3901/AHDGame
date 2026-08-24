import { describe, it, expect, beforeEach, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { migrateProvisionSnapshots } from "./structuredProvisionSnapshots";

const LT = {
  _id: "at_works_councils",
  policyOptions: [
    {
      id: "o1",
      name: "Sectoral Bargaining",
      effectDirection: -1,
      explanation: "The Arbeitsverfassungsgesetz and the Parity Commission: OeGB unions set wages.",
    },
    {
      id: "o2",
      name: "Enterprise Bargaining",
      effectDirection: 1,
      explanation: "Firm-level deals.",
    },
  ],
};

const cursorOf = (rows: unknown[]) => ({
  toArray: vi.fn().mockResolvedValue(rows),
  sort: vi.fn().mockReturnThis(),
  project: vi.fn().mockReturnThis(),
});

describe("migrateProvisionSnapshots", () => {
  let db: MockDb;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("legislationTypes");
    db.collectionMocks["legislationTypes"]!.find.mockReturnValue(cursorOf([LT]));
    db.collection("bills");
    db.collectionMocks["bills"]!.find.mockReturnValue(cursorOf([]));
    db.collection("stateBills");
    db.collectionMocks["stateBills"]!.find.mockReturnValue(cursorOf([]));
  });

  function withBill(provisions: Array<Record<string, unknown>>) {
    db.collectionMocks["bills"]!.find.mockReturnValue(
      cursorOf([{ _id: new ObjectId(), provisions }])
    );
  }

  it("re-resolves a lossy combined snapshot back to the true option name", async () => {
    // The old combiner dropped option.name because the explanation contained
    // ": ", so the stored title was a fragment of the explanation text.
    withBill([
      {
        legislationTypeId: "at_works_councils",
        policyOptionId: "o1",
        effectDirection: -1,
        policyOptionNameSnapshot:
          "The Arbeitsverfassungsgesetz and the Parity Commission: OeGB unions set wages.",
      },
    ]);

    const result = await migrateProvisionSnapshots(db as unknown as Db, { dryRun: false });

    expect(result.updated).toBe(1);
    const update = db.collectionMocks["bills"]!.updateOne.mock.calls[0]?.[1] as {
      $set: Record<string, unknown>;
    };
    expect(update.$set["provisions.0.policyOptionNameSnapshot"]).toBe("Sectoral Bargaining");
    expect(update.$set["provisions.0.policyOptionExplanationSnapshot"]).toBe(
      "The Arbeitsverfassungsgesetz and the Parity Commission: OeGB unions set wages."
    );
  });

  it("re-resolves the current-law snapshot from its persisted id", async () => {
    withBill([
      {
        legislationTypeId: "at_works_councils",
        policyOptionId: "o2",
        effectDirection: 1,
        currentPolicyOptionIdSnapshot: "o1",
        currentPolicyOptionNameSnapshot:
          "The Arbeitsverfassungsgesetz and the Parity Commission: OeGB unions set wages.",
      },
    ]);

    await migrateProvisionSnapshots(db as unknown as Db, { dryRun: false });

    const update = db.collectionMocks["bills"]!.updateOne.mock.calls[0]?.[1] as {
      $set: Record<string, unknown>;
    };
    expect(update.$set["provisions.0.currentPolicyOptionNameSnapshot"]).toBe("Sectoral Bargaining");
    expect(update.$set["provisions.0.currentPolicyOptionExplanationSnapshot"]).toBe(
      "The Arbeitsverfassungsgesetz and the Parity Commission: OeGB unions set wages."
    );
  });

  it("writes nothing in dry-run mode but still reports what it would change", async () => {
    withBill([
      {
        legislationTypeId: "at_works_councils",
        policyOptionId: "o1",
        effectDirection: -1,
        policyOptionNameSnapshot: "wrong",
      },
    ]);

    const result = await migrateProvisionSnapshots(db as unknown as Db, { dryRun: true });

    expect(result.updated).toBe(1);
    expect(db.collectionMocks["bills"]!.updateOne).not.toHaveBeenCalled();
  });

  it("leaves a provision alone when no option id is persisted", async () => {
    // Nothing identifies which option was in force, so the legacy string stays
    // and the read path splits it. Reconstructing it would be guesswork.
    withBill([
      {
        legislationTypeId: "at_works_councils",
        effectDirection: -1,
        policyOptionNameSnapshot: "Legacy: text",
      },
    ]);

    const result = await migrateProvisionSnapshots(db as unknown as Db, { dryRun: false });

    expect(result.skipped).toBe(1);
    expect(result.updated).toBe(0);
    expect(db.collectionMocks["bills"]!.updateOne).not.toHaveBeenCalled();
  });

  it("skips a provision whose legislation type is no longer in the catalog", async () => {
    withBill([{ legislationTypeId: "deleted_law", policyOptionId: "o1", effectDirection: -1 }]);

    const result = await migrateProvisionSnapshots(db as unknown as Db, { dryRun: false });

    expect(result.skipped).toBe(1);
    expect(db.collectionMocks["bills"]!.updateOne).not.toHaveBeenCalled();
  });

  it("skips a provision whose persisted option id is no longer in the ladder", async () => {
    withBill([
      { legislationTypeId: "at_works_councils", policyOptionId: "gone", effectDirection: -1 },
    ]);

    const result = await migrateProvisionSnapshots(db as unknown as Db, { dryRun: false });

    expect(result.skipped).toBe(1);
    expect(db.collectionMocks["bills"]!.updateOne).not.toHaveBeenCalled();
  });

  it("is idempotent — a second run updates nothing", async () => {
    withBill([
      {
        legislationTypeId: "at_works_councils",
        policyOptionId: "o1",
        effectDirection: -1,
        policyOptionNameSnapshot: "Sectoral Bargaining",
        policyOptionExplanationSnapshot:
          "The Arbeitsverfassungsgesetz and the Parity Commission: OeGB unions set wages.",
      },
    ]);

    const result = await migrateProvisionSnapshots(db as unknown as Db, { dryRun: false });

    expect(result.updated).toBe(0);
    expect(db.collectionMocks["bills"]!.updateOne).not.toHaveBeenCalled();
  });

  it("walks stateBills as well as bills", async () => {
    db.collectionMocks["stateBills"]!.find.mockReturnValue(
      cursorOf([
        {
          _id: new ObjectId(),
          provisions: [
            { legislationTypeId: "at_works_councils", policyOptionId: "o2", effectDirection: 1 },
          ],
        },
      ])
    );

    const result = await migrateProvisionSnapshots(db as unknown as Db, { dryRun: false });

    expect(result.updated).toBe(1);
    expect(db.collectionMocks["stateBills"]!.updateOne).toHaveBeenCalled();
  });

  it("ignores subsidy provisions, which carry no policy option", async () => {
    withBill([{ type: "subsidy", scopeType: "economy_wide" }]);

    const result = await migrateProvisionSnapshots(db as unknown as Db, { dryRun: false });

    expect(result.scanned).toBe(0);
    expect(result.updated).toBe(0);
    expect(db.collectionMocks["bills"]!.updateOne).not.toHaveBeenCalled();
  });
});
