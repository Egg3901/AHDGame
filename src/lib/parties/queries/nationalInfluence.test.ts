import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import type { PoliticalParty } from "@/lib/db/types";
import { getNationalPartyInfluenceView } from "./nationalInfluence";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));

// The view fans out to several collections via getNationalPartyInfluenceOptions;
// an empty world keeps the test focused on the Action Point fields.
function emptyWorld(db: MockDb) {
  const emptyCursor = {
    toArray: vi.fn().mockResolvedValue([]),
    project: vi.fn().mockReturnThis(),
    sort: vi.fn().mockReturnThis(),
  };
  db.collection("states").find.mockReturnValue(emptyCursor);
  db.collection("npps").find.mockReturnValue(emptyCursor);
  db.collection("statePartyOrg").find.mockReturnValue(emptyCursor);
  db.collection("elections").find.mockReturnValue(emptyCursor);
  db.collection("electionCandidates").find.mockReturnValue(emptyCursor);
  db.collection("characters").find.mockReturnValue(emptyCursor);
}

function makeParty(overrides: Partial<PoliticalParty>): PoliticalParty {
  return {
    _id: new ObjectId(),
    sequentialId: 1,
    countryId: "US",
    name: "Democratic Party",
    treasury: 500_000,
    politicalStrength: 20,
    ...overrides,
  } as PoliticalParty;
}

describe("getNationalPartyInfluenceView — Action Points", () => {
  let db: MockDb;

  beforeEach(async () => {
    db = createMockDb();
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
    emptyWorld(db);
  });

  it("exposes the major-tier pool and marks actions available when AP is sufficient", async () => {
    const party = makeParty({ tier: "major", nppActionPoints: 5 });
    const view = await getNationalPartyInfluenceView(db as unknown as Db, party, "US");

    expect(view.nppActionPoints).toBe(5);
    expect(view.nppActionPointCap).toBe(160);
    expect(view.nppActionPointRegen).toBe(16);
    expect(view.actions.every((a) => a.available)).toBe(true);
    expect(view.actions.every((a) => a.actionCost === 1)).toBe(true);
    const fundByType = Object.fromEntries(view.actions.map((a) => [a.type, a.baseFundCost]));
    expect(fundByType.boost_favorability).toBe(5000);
    expect(fundByType.boost_influence).toBe(5000);
    expect(fundByType.boost_loyalty).toBe(12500);
    expect(fundByType.reduce_stubbornness).toBe(12500);
    expect(fundByType.relocate_state).toBe(0);
  });

  it("marks actions unavailable with an Action Points reason when the pool is empty", async () => {
    const party = makeParty({ tier: "major", nppActionPoints: 0 });
    const view = await getNationalPartyInfluenceView(db as unknown as Db, party, "US");

    expect(view.nppActionPoints).toBe(0);
    expect(view.actions.every((a) => !a.available)).toBe(true);
    expect(view.actions[0].unavailableReason).toMatch(/Action Points/);
  });

  it("heals an undefined balance to the tier cap for display", async () => {
    const party = makeParty({ tier: "minor", nppActionPoints: undefined });
    const view = await getNationalPartyInfluenceView(db as unknown as Db, party, "US");

    expect(view.nppActionPointCap).toBe(80);
    expect(view.nppActionPoints).toBe(80);
    expect(view.nppActionPointRegen).toBe(8);
  });
});
