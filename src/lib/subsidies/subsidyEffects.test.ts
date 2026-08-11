import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Subsidy } from "@/lib/db/types";
import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import {
  SUBSIDY_MARGIN_BONUS,
  corpQualifiesForSubsidy,
  getSubsidyMarginModifier,
  applySubsidyProvision,
  applyEndSubsidyProvision,
  getActiveSubsidies,
} from "./subsidyEffects";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));

const billId = new ObjectId();
const baseFields = {
  _id: new ObjectId(),
  sourceBillId: billId,
  active: true,
  createdAt: new Date(),
  updatedAt: new Date(),
};

function makeSubsidy(overrides: Partial<Subsidy>): Subsidy {
  return {
    countryId: "US",
    scope: "national",
    stateId: undefined,
    scopeType: "economy_wide",
    targetSectorType: undefined,
    targetStrategyId: undefined,
    domesticOnly: false,
    ...baseFields,
    ...overrides,
  } as Subsidy;
}

describe("SUBSIDY_MARGIN_BONUS", () => {
  it("is 7.5", () => {
    expect(SUBSIDY_MARGIN_BONUS).toBe(7.5);
  });
});

describe("corpQualifiesForSubsidy", () => {
  it("economy_wide national subsidy qualifies any corp in the country", () => {
    const s = makeSubsidy({ scopeType: "economy_wide", scope: "national", countryId: "US" });
    // Corp HQ'd in CA (US state), operating in NY
    expect(corpQualifiesForSubsidy(s, "CA", "technology", "NY", undefined, "US", "US")).toBe(true);
  });

  it("rejects sector that operates outside the subsidy country", () => {
    const s = makeSubsidy({ scopeType: "economy_wide", scope: "national", countryId: "US" });
    expect(corpQualifiesForSubsidy(s, "CA", "technology", "ENG", undefined, "UK", "US")).toBe(
      false
    );
  });

  it("sector subsidy only matches the target sector type", () => {
    const s = makeSubsidy({ scopeType: "sector", targetSectorType: "energy" });
    expect(corpQualifiesForSubsidy(s, "CA", "energy", "CA", undefined, "US", "US")).toBe(true);
    expect(corpQualifiesForSubsidy(s, "CA", "technology", "CA", undefined, "US", "US")).toBe(false);
  });

  it("strategy filter matches sector.strategyId", () => {
    const s = makeSubsidy({ scopeType: "economy_wide", targetStrategyId: "renewables" });
    expect(corpQualifiesForSubsidy(s, "CA", "energy", "CA", "renewables", "US", "US")).toBe(true);
    expect(corpQualifiesForSubsidy(s, "CA", "energy", "CA", "nuclear", "US", "US")).toBe(false);
  });

  it("strategy filter defaults to 'standard' when sector has no strategyId", () => {
    const s = makeSubsidy({ scopeType: "economy_wide", targetStrategyId: "standard" });
    expect(corpQualifiesForSubsidy(s, "CA", "energy", "CA", undefined, "US", "US")).toBe(true);
    expect(corpQualifiesForSubsidy(s, "CA", "energy", "CA", "renewables", "US", "US")).toBe(false);
  });

  it("domesticOnly national: rejects foreign corp", () => {
    const s = makeSubsidy({ scopeType: "economy_wide", domesticOnly: true, countryId: "US" });
    // UK corp (HQ in ENG) operating in US state
    expect(corpQualifiesForSubsidy(s, "ENG", "technology", "CA", undefined, "US", "UK")).toBe(
      false
    );
  });

  it("domesticOnly national: accepts domestic corp", () => {
    const s = makeSubsidy({ scopeType: "economy_wide", domesticOnly: true, countryId: "US" });
    expect(corpQualifiesForSubsidy(s, "CA", "technology", "CA", undefined, "US", "US")).toBe(true);
  });

  it("state subsidy only applies to sectors operating in that state", () => {
    const s = makeSubsidy({ scope: "state", stateId: "CA", scopeType: "economy_wide" });
    expect(corpQualifiesForSubsidy(s, "CA", "technology", "CA", undefined)).toBe(true);
    expect(corpQualifiesForSubsidy(s, "CA", "technology", "NY", undefined)).toBe(false);
  });

  it("domesticOnly state: rejects corp HQ'd outside that state", () => {
    const s = makeSubsidy({
      scope: "state",
      stateId: "CA",
      scopeType: "economy_wide",
      domesticOnly: true,
    });
    expect(corpQualifiesForSubsidy(s, "NY", "technology", "CA", undefined)).toBe(false);
    expect(corpQualifiesForSubsidy(s, "CA", "technology", "CA", undefined)).toBe(true);
  });
});

describe("getSubsidyMarginModifier", () => {
  it("returns 0 when no subsidies", () => {
    expect(getSubsidyMarginModifier([], "CA", "technology", "CA", undefined, "US", "US")).toBe(0);
  });

  it("returns SUBSIDY_MARGIN_BONUS for one qualifying subsidy", () => {
    const s = makeSubsidy({ scopeType: "economy_wide" });
    expect(getSubsidyMarginModifier([s], "CA", "technology", "CA", undefined, "US", "US")).toBe(
      7.5
    );
  });

  it("stacks two qualifying subsidies (federal + state)", () => {
    const national = makeSubsidy({ scope: "national", scopeType: "economy_wide" });
    const state = makeSubsidy({ scope: "state", stateId: "CA", scopeType: "economy_wide" });
    expect(
      getSubsidyMarginModifier([national, state], "CA", "technology", "CA", undefined, "US", "US")
    ).toBe(15);
  });

  it("skips inactive subsidies", () => {
    const s = makeSubsidy({ scopeType: "economy_wide", active: false });
    expect(getSubsidyMarginModifier([s], "CA", "technology", "CA", undefined, "US", "US")).toBe(0);
  });
});

describe("applySubsidyProvision", () => {
  let db: MockDb;

  beforeEach(async () => {
    db = createMockDb();
  });

  it("upserts a subsidy document", async () => {
    const mockCollection = {
      updateOne: vi.fn().mockResolvedValue({ upsertedCount: 1 }),
      insertOne: vi.fn().mockResolvedValue({ insertedId: new ObjectId() }),
    };
    (db.collection as ReturnType<typeof vi.fn>).mockReturnValue(mockCollection);

    await applySubsidyProvision(
      db as unknown as Db,
      "US",
      "national",
      undefined,
      { type: "subsidy", scopeType: "sector", targetSectorType: "energy", domesticOnly: false },
      billId
    );

    expect(mockCollection.updateOne).toHaveBeenCalledOnce();
    const [filter, update] = mockCollection.updateOne.mock.calls[0];
    expect(filter.scopeType).toBe("sector");
    expect(filter.targetSectorType).toBe("energy");
    expect(update.$set.active).toBe(true);
    expect(update.$set.domesticOnly).toBe(false);
  });
});

describe("applyEndSubsidyProvision", () => {
  let db: MockDb;

  beforeEach(() => {
    db = createMockDb();
  });

  it("deactivates matching subsidies", async () => {
    const mockCollection = {
      updateMany: vi.fn().mockResolvedValue({ modifiedCount: 1 }),
      insertOne: vi.fn().mockResolvedValue({ insertedId: new ObjectId() }),
    };
    (db.collection as ReturnType<typeof vi.fn>).mockReturnValue(mockCollection);

    await applyEndSubsidyProvision(db as unknown as Db, "US", "national", undefined, {
      type: "end_subsidy",
      scopeType: "sector",
      targetSectorType: "energy",
    });

    expect(mockCollection.updateMany).toHaveBeenCalledOnce();
    const [filter, update] = mockCollection.updateMany.mock.calls[0];
    expect(filter.active).toBe(true);
    expect(update.$set.active).toBe(false);
  });
});

describe("getActiveSubsidies", () => {
  it("queries subsidies collection with active: true", async () => {
    const mockDocs: Subsidy[] = [makeSubsidy({})];
    const mockCollection = {
      find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue(mockDocs) }),
    };
    const db = { collection: vi.fn().mockReturnValue(mockCollection) } as unknown as Db;

    const result = await getActiveSubsidies(db);
    expect(mockCollection.find).toHaveBeenCalledWith({ active: true });
    expect(result).toEqual(mockDocs);
  });
});
