import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import type { Crisis, CrisisInteraction } from "@/lib/db/types/crisis";
import { spendFromTreasury } from "@/lib/budget/treasurySpend";
import { runUnionBanStrikeResponse } from "./unionBanStrike";

vi.mock("@/lib/budget/treasurySpend", () => ({ spendFromTreasury: vi.fn() }));
vi.mock("./unionBanStrikeWire", () => ({
  announceUnionBanStrikeEnd: vi.fn(),
  announceUnionBanStrikeStart: vi.fn(),
}));

const characterId = new ObjectId();
const crisisId = new ObjectId();
const crisis = {
  _id: crisisId,
  templateKey: "union_ban_general_strike",
  countryIds: ["US"],
  status: "active",
  effects: [{ effectType: "tick", targetType: "profitMargin", value: -20 }],
} as Crisis;

function fixture() {
  const crisisUpdate = vi.fn().mockResolvedValue({ modifiedCount: 1 });
  const unionUpdate = vi.fn().mockResolvedValue({ modifiedCount: 1 });
  const db = {
    collection: (name: string) => {
      if (name === "crises") return { findOne: async () => crisis, updateOne: crisisUpdate };
      if (name === "unions") {
        return {
          find: () => ({
            toArray: async () => [
              { countryId: "US", sectorType: "manufacturing", undergroundStrength: 35 },
            ],
          }),
          updateMany: unionUpdate,
        };
      }
      if (name === "federalBudget") {
        return { findOne: async () => ({ unionsBanned: true, gdp: 1_000_000 }) };
      }
      if (name === "characters") {
        return {
          updateOne: vi.fn().mockResolvedValue({ modifiedCount: 1 }),
          findOne: async () => ({ favorability: 50, archetypeApprovals: {} }),
        };
      }
      throw new Error(`unexpected collection ${name}`);
    },
  } as unknown as Db;
  const respond = (response: "army" | "negotiate" | "rideOut") =>
    runUnionBanStrikeResponse({
      db,
      crisis,
      interaction: {} as CrisisInteraction,
      characterId,
      countryId: "US",
      currentTurn: 42,
      response,
    });
  return { respond, crisisUpdate, unionUpdate };
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.restoreAllMocks());

describe("underground resistance in ban-strike responses", () => {
  it("leaves 75% of effects after ride-out when a cell is strong", async () => {
    const { respond, crisisUpdate } = fixture();
    await respond("rideOut");
    expect(crisisUpdate).toHaveBeenCalledWith(
      { _id: crisisId },
      { $set: { effects: [{ ...crisis.effects[0], value: -15 }] } }
    );
  });

  it("doubles the bounded negotiation concession against a strong cell", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0.99);
    const { respond } = fixture();
    await respond("negotiate");
    expect(spendFromTreasury).toHaveBeenCalledWith(expect.anything(), "US", 1_000, {
      resyncDerived: true,
      witness: { flow: "crisis_response", site: "crises/unionBanStrike" },
    });
  });

  it("ends the crisis immediately with the army but leaves sympathy in the cells", async () => {
    const { respond, crisisUpdate, unionUpdate } = fixture();
    await respond("army");
    expect(crisisUpdate).toHaveBeenCalledWith(
      { _id: crisisId, status: "active" },
      expect.objectContaining({
        $set: expect.objectContaining({ status: "resolved", endTurn: 42 }),
      })
    );
    expect(unionUpdate).toHaveBeenCalledWith(
      { countryId: "US" },
      expect.objectContaining({ $inc: { undergroundStrength: 4 } })
    );
  });
});
