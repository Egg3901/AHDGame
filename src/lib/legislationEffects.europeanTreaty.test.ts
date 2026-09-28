import { describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb } from "@/lib/test-utils/mockDb";
import { applyLegislationEffect } from "./legislationEffects";
import type { EuropeanIntegrationState } from "./internationalOrganizations/europeanIntegration/rules";

vi.mock("@/lib/turn/currentTurn", () => ({ getCurrentTurn: vi.fn().mockResolvedValue(60) }));

describe("Maastricht national enactment", () => {
  function world() {
    const db = createMockDb();
    const membershipId = new ObjectId();
    const state: {
      currentTurn: number;
      startingYear: number;
      preset: string;
      europeanIntegration: EuropeanIntegrationState;
    } = {
      currentTurn: 60,
      startingYear: 1991,
      preset: "1991-default",
      europeanIntegration: {
        stage: "community",
        source: "historical-seed",
        establishedTurn: 1,
        ratifications: {},
      },
    };
    db.collection("gameState").findOne.mockImplementation(async () => structuredClone(state));
    db.collection("gameState").updateOne.mockImplementation(
      async (_filter, update: { $set: { europeanIntegration: EuropeanIntegrationState } }) => {
        state.europeanIntegration = update.$set.europeanIntegration;
        return { matchedCount: 1 };
      }
    );
    db.collection("organizationMemberships").find.mockReturnValue({
      toArray: async () => [{ _id: membershipId, countryId: "UK", joinedTurn: 0 }],
    });
    return { db, state, membershipId };
  }

  it.each(["ratify", "reject"] as const)(
    "records a passed %s bill and preserves it on replay",
    async (action) => {
      const { db, state, membershipId } = world();
      const bill: Parameters<typeof applyLegislationEffect>[1] = {
        _id: new ObjectId(),
        countryId: "UK",
        stateId: "uk_national",
        provisions: [{ type: "european_treaty", treaty: "maastricht", action }],
      };
      await applyLegislationEffect(db as unknown as Db, bill);
      expect(state.europeanIntegration.ratifications.UK).toMatchObject({
        approved: action === "ratify",
        source: "national-law",
        decisionId: String(bill._id),
        turn: 60,
        membershipId: String(membershipId),
      });
      await applyLegislationEffect(db as unknown as Db, bill);
      expect(db.collectionMocks.gameState.updateOne).toHaveBeenCalledTimes(1);
      expect(db.collectionMocks.tariffs?.updateOne).toBeUndefined();
    }
  );

  it("rejects a regional treaty enactment without recording national consent", async () => {
    const { db } = world();
    await expect(
      applyLegislationEffect(db as unknown as Db, {
        _id: new ObjectId(),
        countryId: "UK",
        stateId: "london",
        provisions: [{ type: "european_treaty", treaty: "maastricht", action: "ratify" }],
      })
    ).rejects.toThrow("national legislation");
    expect(db.collectionMocks.gameState.updateOne).not.toHaveBeenCalled();
  });
});
