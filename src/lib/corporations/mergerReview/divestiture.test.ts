import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId, type Db } from "mongodb";

vi.mock("@/lib/market/featureFlag", () => ({
  getMarketSystemModeForDb: vi.fn().mockResolvedValue("off"),
  marketAtLeast: () => false,
}));
vi.mock("../corpMarketShare", () => ({ loadIndustryBasis: vi.fn() }));

import { loadIndustryBasis } from "../corpMarketShare";
import {
  controlledGroupIds,
  groupIndustrySharePercent,
  settleDivestitureIfSatisfied,
} from "./divestiture";

const PARENT = new ObjectId();
const CHILD = new ObjectId();
const GRANDCHILD = new ObjectId();
const OUTSIDER = new ObjectId();

/** A corp whose sole corporate shareholder holds `pct` of a 100-share float. */
function ownedBy(id: ObjectId, holder: ObjectId | null, pct: number) {
  return {
    _id: id,
    totalShares: 100,
    shareholders: holder ? [{ corporationId: holder, shares: pct }] : [],
  };
}

function makeDb(corps: unknown[]) {
  const updateOne = vi.fn().mockResolvedValue({ matchedCount: 1 });
  const db = {
    collection: vi.fn(() => ({
      find: () => ({ toArray: () => Promise.resolve(corps) }),
      updateOne,
    })),
  } as unknown as Db;
  return { db, updateOne };
}

describe("controlledGroupIds", () => {
  it("walks a control chain in one pass", async () => {
    const { db } = makeDb([
      ownedBy(PARENT, null, 0),
      ownedBy(CHILD, PARENT, 60),
      ownedBy(GRANDCHILD, CHILD, 80),
      ownedBy(OUTSIDER, null, 0),
    ]);
    const group = await controlledGroupIds(db, PARENT);
    expect([...group].sort()).toEqual(
      [PARENT.toString(), CHILD.toString(), GRANDCHILD.toString()].sort()
    );
  });

  it("excludes a holding that is not control", async () => {
    const { db } = makeDb([ownedBy(PARENT, null, 0), ownedBy(CHILD, PARENT, 50)]);
    const group = await controlledGroupIds(db, PARENT);
    expect(group.has(CHILD.toString())).toBe(false);
  });

  it("terminates on an ownership cycle instead of looping", async () => {
    const { db } = makeDb([ownedBy(PARENT, CHILD, 60), ownedBy(CHILD, PARENT, 60)]);
    const group = await controlledGroupIds(db, PARENT);
    expect(group.size).toBe(2);
  });
});

describe("groupIndustrySharePercent", () => {
  beforeEach(() => vi.clearAllMocks());

  it("attributes a controlled subsidiary's position to the parent", async () => {
    vi.mocked(loadIndustryBasis).mockResolvedValue(
      new Map([
        [
          "steel",
          {
            basisByCorp: new Map([
              [PARENT.toString(), 300],
              [CHILD.toString(), 400],
              [OUTSIDER.toString(), 300],
            ]),
            anchorByCorp: new Map(),
            basisMarket: 1_000,
          },
        ],
      ]) as never
    );
    const { db } = makeDb([
      ownedBy(PARENT, null, 0),
      ownedBy(CHILD, PARENT, 60),
      ownedBy(OUTSIDER, null, 0),
    ]);
    const share = await groupIndustrySharePercent(db, PARENT, "US", "steel" as never, false);
    expect(share).toBe(70);
  });
});

describe("settleDivestitureIfSatisfied", () => {
  const obligation = {
    reviewId: new ObjectId(),
    sectorType: "steel" as const,
    dueTurn: 200,
    thresholdPercent: 60,
    countryId: "US",
  };

  beforeEach(() => vi.clearAllMocks());

  it("does NOT discharge on a spin-off into a wholly-owned subsidiary", async () => {
    // The business moved out of the parent, but the group still holds 70%.
    vi.mocked(loadIndustryBasis).mockResolvedValue(
      new Map([
        [
          "steel",
          {
            basisByCorp: new Map([[CHILD.toString(), 700]]),
            anchorByCorp: new Map(),
            basisMarket: 1_000,
          },
        ],
      ]) as never
    );
    const { db, updateOne } = makeDb([ownedBy(PARENT, null, 0), ownedBy(CHILD, PARENT, 100)]);
    const discharged = await settleDivestitureIfSatisfied(db, {
      _id: PARENT,
      pendingDivestiture: obligation,
    } as never);
    expect(discharged).toBe(false);
    expect(updateOne).not.toHaveBeenCalled();
  });

  it("discharges once the group has sold the subsidiary down below control", async () => {
    vi.mocked(loadIndustryBasis).mockResolvedValue(
      new Map([
        [
          "steel",
          {
            basisByCorp: new Map([[CHILD.toString(), 700]]),
            anchorByCorp: new Map(),
            basisMarket: 1_000,
          },
        ],
      ]) as never
    );
    const { db, updateOne } = makeDb([ownedBy(PARENT, null, 0), ownedBy(CHILD, PARENT, 40)]);
    const discharged = await settleDivestitureIfSatisfied(db, {
      _id: PARENT,
      pendingDivestiture: obligation,
    } as never);
    expect(discharged).toBe(true);
    expect(updateOne.mock.calls[0][1].$unset).toEqual({ pendingDivestiture: "" });
  });

  it("is a no-op for a corporation under no order", async () => {
    const { db, updateOne } = makeDb([]);
    expect(await settleDivestitureIfSatisfied(db, { _id: PARENT } as never)).toBe(false);
    expect(updateOne).not.toHaveBeenCalled();
  });
});
