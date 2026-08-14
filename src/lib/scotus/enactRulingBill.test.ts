import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import type { PolicyProvision } from "@/lib/db/types/legislation";

vi.mock("@/lib/billEnactment", () => ({ onBillEnacted: vi.fn().mockResolvedValue(undefined) }));

const provision: PolicyProvision = {
  type: "policy",
  legislationTypeId: "us_legal_immigration_visas",
  policyOptionId: "legal_immigration_visas_opt_5",
  effectDirection: -1,
};

describe("enactRulingBill", () => {
  let db: MockDb;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
  });

  it("persists a signed bills row before driving onBillEnacted, so the deep-link resolves", async () => {
    const { enactRulingBill } = await import("./enactRulingBill");
    const { onBillEnacted } = await import("@/lib/billEnactment");

    const { billId } = await enactRulingBill(db as unknown as Db, {
      title: "In re Wandering Carnival License v. Bureau of Visas (Surprise SCOTUS Ruling)",
      legislationTypeId: provision.legislationTypeId,
      effectDirection: -1,
      provision,
      countryId: "US",
      stateId: "federal",
      source: "scotus_surprise_ruling",
      votesFor: 5,
      votesAgainst: 3,
      currentTurn: 99,
    });

    // The bills row must exist — this is the fix: previously nothing was inserted.
    const insert = db.collectionMocks["bills"]!.insertOne;
    expect(insert).toHaveBeenCalledTimes(1);
    const [inserted] = insert.mock.calls[0] as [Record<string, unknown>];
    expect(inserted._id).toEqual(billId);
    expect(inserted.status).toBe("signed");
    expect(inserted.source).toBe("scotus_surprise_ruling");
    expect(inserted.countryId).toBe("US");
    expect(inserted.stateId).toBe("federal");
    expect(inserted.votesFor).toBe(5);
    expect(inserted.votesAgainst).toBe(3);
    expect(inserted.provisions).toEqual([provision]);

    // onBillEnacted still runs the shared effect pipeline, keyed to the same id
    // the statePolicies row will reference.
    expect(onBillEnacted).toHaveBeenCalledTimes(1);
    const [, enactedArg] = vi.mocked(onBillEnacted).mock.calls[0];
    expect((enactedArg as { _id: ObjectId })._id).toEqual(billId);
    expect(enactedArg).toMatchObject({ source: "scotus_surprise_ruling", countryId: "US" });
  });

  it("returns the enactedLawId when onBillEnacted produced an enactedLaws row", async () => {
    const lawId = new ObjectId();
    const db2 = createMockDb();
    db2.collection("enactedLaws").findOne.mockResolvedValue({ _id: lawId });

    const { enactRulingBill } = await import("./enactRulingBill");
    const { enactedLawId } = await enactRulingBill(db2 as unknown as Db, {
      title: "Case (Judicial Review)",
      legislationTypeId: "uk_policy",
      effectDirection: 1,
      provision: { type: "policy", legislationTypeId: "uk_policy", effectDirection: 1 },
      countryId: "UK",
      stateId: "uk_national",
      source: "uk_judicial_review_surprise",
      currentTurn: 42,
    });

    expect(enactedLawId).toEqual(lawId);
  });
});
