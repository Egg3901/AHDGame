import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, createAsyncIterableCursor, type MockDb } from "@/lib/test-utils/mockDb";
import {
  PARTYLESS_FOUNDING_PRIOR_MARKER,
  seedPartylessFoundingCandidates,
} from "@/lib/npp/seedPartylessFoundingCandidates";

vi.mock("@/lib/countryAccess", () => ({
  getEnabledCountryIdsFromDb: vi.fn(async () => ["US", "IE"]),
}));

describe("seedPartylessFoundingCandidates", () => {
  let db: MockDb;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("gameState").findOne.mockResolvedValue({
      preset: "1991-default",
      startingPartiesMode: "none",
      preIteration: { active: true },
    });
    db.collection("states").find.mockReturnValue(
      createAsyncIterableCursor([
        { _id: "CA", countryId: "US" },
        { _id: "DUB", countryId: "IE" },
      ])
    );
    db.collection("elections").find.mockReturnValue(
      createAsyncIterableCursor([
        { _id: "us-house", countryId: "US", state: "CA", electionType: "house" },
        { _id: "us-senate", countryId: "US", state: "CA", electionType: "senate" },
        { _id: "ie-dail", countryId: "IE", state: "DUB", electionType: "dail" },
        { _id: "ie-president", countryId: "IE", state: "IE", electionType: "uachtaran" },
        { _id: "us-president", countryId: "US", state: "US", electionType: "president" },
        { _id: "cn-house", countryId: "CN", state: "BJ", electionType: "npcDelegate" },
      ])
    );
    db.collection("npps").find.mockReturnValue(createAsyncIterableCursor([]));
    db.collection("counters").findOneAndUpdate.mockImplementation(
      async (_filter: unknown, update: { $inc: { seq: number } }) => ({
        _id: "npp",
        seq: update.$inc.seq,
      })
    );
  });

  it("seeds independent unseated NPPs for player cycle-0 races, excluding barred presidents", async () => {
    const result = await seedPartylessFoundingCandidates(db as unknown as Db, "1991-default");
    const inserted = db.collection("npps").insertMany.mock.calls[0]?.[0] as Array<{
      countryId: string;
      homeState: string;
      party: string;
      currentOffice: string | null;
      seededForOfficeType: string;
    }>;

    expect(result).toEqual({ nppsCreated: 4, byCountry: { US: 2, IE: 2 } });
    expect(inserted).toHaveLength(4);
    expect(inserted.every((npp) => npp.party === "independent")).toBe(true);
    expect(inserted.every((npp) => npp.currentOffice === null)).toBe(true);
    expect(
      inserted.every((npp) => npp.seededForOfficeType === PARTYLESS_FOUNDING_PRIOR_MARKER)
    ).toBe(true);
    expect(inserted.some((npp) => npp.countryId === "US" && npp.homeState === "US")).toBe(false);
    expect(db.collection("politicalParties").insertMany).not.toHaveBeenCalled();
    expect(db.collection("statePartyOrg").insertMany).not.toHaveBeenCalled();
  });

  it("does nothing outside the 1991 preset", async () => {
    await expect(
      seedPartylessFoundingCandidates(db as unknown as Db, "2019-default")
    ).rejects.toThrow("only for 1991-default");
    expect(db.collection("npps").insertMany).not.toHaveBeenCalled();
  });

  it.each([
    [
      "default starting parties",
      { startingPartiesMode: "default", preIteration: { active: true } },
    ],
    [
      "an inactive founding phase",
      { startingPartiesMode: "none", preIteration: { active: false } },
    ],
  ])("rejects %s before writing candidate data", async (_label, state) => {
    db.collection("gameState").findOne.mockResolvedValue({ preset: "1991-default", ...state });

    await expect(
      seedPartylessFoundingCandidates(db as unknown as Db, "1991-default")
    ).rejects.toThrow("require an active 1991-default founding phase");
    expect(db.collection("npps").insertMany).not.toHaveBeenCalled();
    expect(db.collection("counters").findOneAndUpdate).not.toHaveBeenCalled();
  });
});
