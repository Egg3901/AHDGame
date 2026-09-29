import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { getHeadOfGovernmentCharacterId } from "@/lib/api/headOfGovernment";
import {
  CRACKDOWN_LABOUR_APPROVAL_COST_PER_TURN,
  processCrackdownLabourApprovalTurn,
} from "./crackdownLabourApproval";

vi.mock("@/lib/api/headOfGovernment", () => ({ getHeadOfGovernmentCharacterId: vi.fn() }));

const executiveId = new ObjectId();

function stubDb(posture: "crackdown" | "normal" | "tolerant", banned = true) {
  let claimedTurn: number | undefined;
  const updateOne = vi.fn().mockImplementation(async (filter: Record<string, unknown>) => {
    const marker = filter["lastUnionCrackdownApprovalTurn.US"] as { $ne: number };
    if (claimedTurn === marker.$ne) return { modifiedCount: 0 };
    claimedTurn = marker.$ne;
    return { modifiedCount: 1 };
  });
  const find = vi.fn().mockImplementation((filter: Record<string, unknown>) => ({
    toArray: async () =>
      banned &&
      posture === "crackdown" &&
      filter.unionsBanned &&
      filter.unionEnforcementPosture === "crackdown"
        ? [{ countryId: "US" }]
        : [],
  }));
  const db = {
    collection: (name: string) => {
      if (name === "federalBudget") return { find };
      if (name === "characters") return { updateOne };
      throw new Error(`unexpected collection ${name}`);
    },
  } as unknown as Db;
  return { db, find, updateOne };
}

beforeEach(() => {
  vi.mocked(getHeadOfGovernmentCharacterId).mockResolvedValue(executiveId);
});

describe("crackdown labor approval", () => {
  it.each(["normal", "tolerant"] as const)("does not charge %s posture", async (posture) => {
    const { db, updateOne } = stubDb(posture);
    expect(await processCrackdownLabourApprovalTurn(db, 42)).toBe(0);
    expect(updateOne).not.toHaveBeenCalled();
  });

  it("does not charge without an active ban", async () => {
    const { db, updateOne } = stubDb("crackdown", false);
    expect(await processCrackdownLabourApprovalTurn(db, 42)).toBe(0);
    expect(updateOne).not.toHaveBeenCalled();
  });

  it("charges labor archetypes once per turn on the executive document", async () => {
    const { db, updateOne, find } = stubDb("crackdown");
    expect(await processCrackdownLabourApprovalTurn(db, 42)).toBe(1);
    expect(await processCrackdownLabourApprovalTurn(db, 42)).toBe(0);
    expect(await processCrackdownLabourApprovalTurn(db, 43)).toBe(1);
    expect(find).toHaveBeenCalledWith(
      { unionsBanned: true, unionEnforcementPosture: "crackdown" },
      { projection: { countryId: 1 } }
    );
    const [filter, pipeline] = updateOne.mock.calls[0];
    expect(filter).toEqual({
      _id: executiveId,
      "lastUnionCrackdownApprovalTurn.US": { $ne: 42 },
    });
    const set = pipeline[0].$set;
    expect(set["lastUnionCrackdownApprovalTurn.US"]).toBe(42);
    expect(set["archetypeApprovals.union_trades"]).toEqual({
      $max: [
        -100,
        {
          $subtract: [
            { $ifNull: ["$archetypeApprovals.union_trades", 0] },
            CRACKDOWN_LABOUR_APPROVAL_COST_PER_TURN,
          ],
        },
      ],
    });
    expect(set).toHaveProperty("archetypeApprovals.college_liberals");
    expect(set).toHaveProperty("archetypeApprovals.public_sector");
    expect(set).not.toHaveProperty("archetypeApprovals.small_business");
  });

  it("waits for a sitting executive rather than consuming a turn claim", async () => {
    vi.mocked(getHeadOfGovernmentCharacterId).mockResolvedValueOnce(null);
    const { db, updateOne } = stubDb("crackdown");
    expect(await processCrackdownLabourApprovalTurn(db, 42)).toBe(0);
    expect(updateOne).not.toHaveBeenCalled();
    expect(await processCrackdownLabourApprovalTurn(db, 42)).toBe(1);
  });
});
