/**
 * The NPP move used to write `homeState` and stop there, leaving every other
 * region-derived fact behind — most visibly the `statePartyOrg` presence flag,
 * which is computed from where a party's NPPs live. These pin the full pipeline.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import type { NPP, State } from "@/lib/db/types";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/turn/partyOrg/presence", () => ({ updatePartyPresence: vi.fn() }));
vi.mock("@/lib/electionEngine/tallyCleaner", () => ({
  removeWithdrawnCandidateFromTally: vi.fn(),
}));
vi.mock("@/lib/governors/senateVacancy", () => ({
  notifyGovernorOfSenateVacancy: vi.fn(),
}));

const TARGET_STATE = {
  _id: "UK_SE",
  name: "South East",
  countryId: "UK",
} as unknown as State;

function makeNpp(overrides: Partial<NPP> = {}): NPP {
  return {
    _id: new ObjectId(),
    name: "Latoya O'Connor",
    countryId: "UK",
    homeState: "UK_LDN",
    party: "1",
    favorability: 55,
    politicalInfluence: 10,
    currentOffice: null,
    retiredAt: null,
    personality: { loyalty: 60, ambition: 50, stubbornness: 35 },
    policies: { economic: 0, social: 0 },
    generatedAt: new Date("2026-01-01"),
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    ...overrides,
  } as NPP;
}

describe("performNppRelocation", () => {
  let db: MockDb;
  const now = new Date("2026-07-28T00:00:00Z");

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
    db.collection("npps");
    db.collection("electedOfficials");
    db.collection("electionCandidates");
    db.collection("elections");
    db.collection("statePartyOrg");
    db.collectionMocks.statePartyOrg.findOne.mockResolvedValue(null);
  });

  it("moves the NPP to the target region", async () => {
    const npp = makeNpp();
    const { performNppRelocation } = await import("./performNppRelocation");

    const outcome = await performNppRelocation(db as unknown as Db, npp, TARGET_STATE, now);

    const call = db.collectionMocks.npps.updateOne.mock.calls[0];
    expect(call[0]).toEqual({ _id: npp._id });
    expect(call[1].$set).toEqual({
      homeState: "UK_SE",
      currentOffice: null,
      updatedAt: now,
    });
    expect(outcome.resignedFromOffice).toBeNull();
    expect(outcome.withdrawnGeneralElections).toBe(0);
  });

  it("recomputes party presence for BOTH the old and the new region", async () => {
    const npp = makeNpp();
    const { updatePartyPresence } = await import("@/lib/turn/partyOrg/presence");
    const { performNppRelocation } = await import("./performNppRelocation");

    const outcome = await performNppRelocation(db as unknown as Db, npp, TARGET_STATE, now);

    expect(vi.mocked(updatePartyPresence)).toHaveBeenCalledWith(db as unknown as Db, "UK_LDN", "1");
    expect(vi.mocked(updatePartyPresence)).toHaveBeenCalledWith(db as unknown as Db, "UK_SE", "1");
    expect(outcome.presenceRecountedStates).toEqual(["UK_LDN", "UK_SE"]);
  });

  it("skips the presence recount for an independent NPP", async () => {
    const npp = makeNpp({ party: "independent" });
    const { updatePartyPresence } = await import("@/lib/turn/partyOrg/presence");
    const { performNppRelocation } = await import("./performNppRelocation");

    const outcome = await performNppRelocation(db as unknown as Db, npp, TARGET_STATE, now);

    expect(vi.mocked(updatePartyPresence)).not.toHaveBeenCalled();
    expect(outcome.presenceRecountedStates).toEqual([]);
  });

  it("vacates a held seat, because a seat belongs to the region left behind", async () => {
    const npp = makeNpp({
      currentOffice: { type: "house", state: "UK_LDN" } as NPP["currentOffice"],
    });
    const { performNppRelocation } = await import("./performNppRelocation");

    const outcome = await performNppRelocation(db as unknown as Db, npp, TARGET_STATE, now);

    expect(outcome.resignedFromOffice).toBe("house (UK_LDN)");
    const officialsCall = db.collectionMocks.electedOfficials.updateOne.mock.calls[0];
    expect(officialsCall[0]).toEqual({ nppId: npp._id });
    expect(officialsCall[1].$unset).toHaveProperty("nppId");
  });

  it("withdraws still-open candidacies in the region being left", async () => {
    const npp = makeNpp();
    const electionId = new ObjectId();
    const candidateId = new ObjectId();
    db.collectionMocks.electionCandidates.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([{ _id: candidateId, electionId, status: "active" }]),
      sort: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      skip: vi.fn().mockReturnThis(),
      project: vi.fn().mockReturnThis(),
    });
    db.collectionMocks.elections.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([{ _id: electionId }]),
      sort: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      skip: vi.fn().mockReturnThis(),
      project: vi.fn().mockReturnThis(),
    });
    const { performNppRelocation } = await import("./performNppRelocation");

    const outcome = await performNppRelocation(db as unknown as Db, npp, TARGET_STATE, now);

    expect(outcome.withdrawnGeneralElections).toBe(1);
    expect(db.collectionMocks.electionCandidates.updateMany).toHaveBeenCalledWith(
      { _id: { $in: [candidateId] } },
      { $set: { status: "withdrawn", withdrawnAt: now } }
    );
  });

  it("strips state-party leadership held in the region being left", async () => {
    const npp = makeNpp();
    db.collectionMocks.statePartyOrg.findOne.mockResolvedValue({
      _id: "UK_LDN_1",
      stateId: "UK_LDN",
      partyId: "1",
      chairId: npp._id,
      viceChairId: null,
      treasurerId: null,
    });
    const { performNppRelocation } = await import("./performNppRelocation");

    const outcome = await performNppRelocation(db as unknown as Db, npp, TARGET_STATE, now);

    expect(outcome.clearedStateLeadership).toEqual(["chair"]);
    expect(db.collectionMocks.statePartyOrg.updateOne).toHaveBeenCalledWith(
      { _id: "UK_LDN_1" },
      { $set: { updatedAt: now, chairId: null } }
    );
  });

  it("leaves an unrelated state-party org untouched", async () => {
    const npp = makeNpp();
    db.collectionMocks.statePartyOrg.findOne.mockResolvedValue({
      _id: "UK_LDN_1",
      stateId: "UK_LDN",
      partyId: "1",
      chairId: new ObjectId(),
      viceChairId: null,
      treasurerId: null,
    });
    const { performNppRelocation } = await import("./performNppRelocation");

    const outcome = await performNppRelocation(db as unknown as Db, npp, TARGET_STATE, now);

    expect(outcome.clearedStateLeadership).toEqual([]);
    expect(db.collectionMocks.statePartyOrg.updateOne).not.toHaveBeenCalled();
  });
});

describe("describeNppRelocationCleanup", () => {
  it("says nothing when the move was clean", async () => {
    const { describeNppRelocationCleanup } = await import("./performNppRelocation");
    expect(
      describeNppRelocationCleanup({
        resignedFromOffice: null,
        withdrawnGeneralElections: 0,
        presenceRecountedStates: [],
        clearedStateLeadership: [],
      })
    ).toEqual([]);
  });

  it("names every consequence so the player is not surprised", async () => {
    const { describeNppRelocationCleanup } = await import("./performNppRelocation");
    expect(
      describeNppRelocationCleanup({
        resignedFromOffice: "house (UK_LDN)",
        withdrawnGeneralElections: 2,
        presenceRecountedStates: ["UK_LDN", "UK_SE"],
        clearedStateLeadership: ["chair", "treasurer"],
      })
    ).toEqual([
      "resigned from office",
      "withdrew from 2 active elections",
      "stood down as chair, treasurer",
    ]);
  });
});
