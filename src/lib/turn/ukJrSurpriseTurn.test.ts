import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { UK_JR_SURPRISE_TEMPLATES } from "@/lib/uk/judicialReview/surpriseTemplates";
import { UK_JR_SURPRISE_SPAWN_PROBABILITY_PER_TURN } from "@/lib/uk/judicialReview/surpriseSpawn";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/billEnactment", () => ({ onBillEnacted: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/news", () => ({ createSystemNewsPost: vi.fn().mockResolvedValue(undefined) }));

const cursor = (rows: unknown[]) => ({
  toArray: vi.fn().mockResolvedValue(rows),
  project: vi.fn().mockReturnThis(),
  sort: vi.fn().mockReturnThis(),
  limit: vi.fn().mockReturnThis(),
});

describe("processUkJrSurpriseTurn", () => {
  let db: MockDb;

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("ukJudicialReviewCases");
    db.collection("governmentFormations");
    db.collection("politicalParties");
    db.collection("enactedLaws");
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
  });

  it("does nothing when the spawn roll misses", async () => {
    const { processUkJrSurpriseTurn } = await import("./ukJrSurpriseTurn");
    const result = await processUkJrSurpriseTurn(
      1,
      db as unknown as Db,
      UK_JR_SURPRISE_SPAWN_PROBABILITY_PER_TURN,
      0
    );
    expect(result.spawned).toBe(false);
    const { onBillEnacted } = await import("@/lib/billEnactment");
    expect(onBillEnacted).not.toHaveBeenCalled();
  });

  it("spawns, resolves via left-leaning ruling party, and enacts with uk_judicial_review_surprise source", async () => {
    db.collectionMocks["ukJudicialReviewCases"]!.find.mockReturnValue(cursor([]));
    db.collectionMocks["governmentFormations"]!.findOne.mockResolvedValue({
      status: "formed",
      rulingPartyId: "1",
    });
    db.collectionMocks["politicalParties"]!.findOne.mockResolvedValue({
      sequentialId: 1,
      economicPosition: -2,
      socialPosition: -2,
    });
    db.collectionMocks["ukJudicialReviewCases"]!.insertOne.mockResolvedValue({
      insertedId: new ObjectId(),
    });

    const { processUkJrSurpriseTurn } = await import("./ukJrSurpriseTurn");
    const result = await processUkJrSurpriseTurn(10, db as unknown as Db, 0, 0);

    expect(result.spawned).toBe(true);
    expect(result.caseKey).toBe(UK_JR_SURPRISE_TEMPLATES[0].templateKey);
    expect(result.majoritySide).toBe(-1);

    const { onBillEnacted } = await import("@/lib/billEnactment");
    expect(onBillEnacted).toHaveBeenCalledTimes(1);
    const [, syntheticBill] = vi.mocked(onBillEnacted).mock.calls[0];
    expect(syntheticBill).toMatchObject({
      countryId: "UK",
      source: "uk_judicial_review_surprise",
      legislationTypeId: UK_JR_SURPRISE_TEMPLATES[0].negativeEffect.legislationTypeId,
    });
  });

  it("records the case but skips enactment on a lean tie", async () => {
    db.collectionMocks["ukJudicialReviewCases"]!.find.mockReturnValue(cursor([]));
    db.collectionMocks["governmentFormations"]!.findOne.mockResolvedValue(null);
    db.collectionMocks["ukJudicialReviewCases"]!.insertOne.mockResolvedValue({
      insertedId: new ObjectId(),
    });

    const { processUkJrSurpriseTurn } = await import("./ukJrSurpriseTurn");
    const result = await processUkJrSurpriseTurn(10, db as unknown as Db, 0, 0);

    expect(result.spawned).toBe(true);
    expect(result.majoritySide).toBe(0);
    const { onBillEnacted } = await import("@/lib/billEnactment");
    expect(onBillEnacted).not.toHaveBeenCalled();
  });
});
