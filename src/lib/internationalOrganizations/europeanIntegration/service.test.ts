import { describe, expect, it } from "vitest";
import type { Db } from "mongodb";
import { createMockDb } from "@/lib/test-utils/mockDb";
import { ensureEuropeanIntegrationState } from "./service";
import { withEuropeanInstitution } from "./definition";
import { INTERNATIONAL_ORGANIZATIONS } from "@/lib/constants/internationalOrganizations";

describe("European institutional initialization", () => {
  it("starts a fresh 1991 world as a Community with its twelve members", async () => {
    const db = createMockDb();
    db.collection("gameState").findOne.mockResolvedValue({ currentTurn: 1 });
    const state = await ensureEuropeanIntegrationState(db as unknown as Db, "1991-default", false);
    const definition = withEuropeanInstitution(INTERNATIONAL_ORGANIZATIONS.EU, state);
    expect(state).toMatchObject({ stage: "community", source: "historical-seed" });
    expect(definition.name).toBe("European Economic Community");
    expect(definition.foundingMembersByEra?.["1991-default"]).toHaveLength(12);
    expect(definition.foundingMembersByEra?.["1991-default"]).toContain("UK");
  });
  it("preserves an existing early union as an alternate-history settlement", async () => {
    const db = createMockDb();
    db.collection("gameState").findOne.mockResolvedValue({ currentTurn: 100 });
    const state = await ensureEuropeanIntegrationState(db as unknown as Db, "1991-default", true);
    expect(state).toMatchObject({ stage: "union", source: "legacy-settlement" });
    expect(withEuropeanInstitution(INTERNATIONAL_ORGANIZATIONS.EU, state)).toEqual(
      INTERNATIONAL_ORGANIZATIONS.EU
    );
  });
  it("does not backfill members into a progressed world that has none", async () => {
    const db = createMockDb();
    db.collection("gameState").findOne.mockResolvedValue({ currentTurn: 100 });
    const state = await ensureEuropeanIntegrationState(db as unknown as Db, "1991-default", false);
    const definition = withEuropeanInstitution(INTERNATIONAL_ORGANIZATIONS.EU, state);
    expect(state.source).toBe("legacy-settlement");
    expect(definition.foundingMembers).toEqual([]);
    expect(definition.foundingMembersByEra?.["1991-default"]).toBeUndefined();
  });
  it("does not reset a stored rejection on seed replay", async () => {
    const db = createMockDb();
    const state = {
      stage: "community",
      source: "historical-seed",
      establishedTurn: 1,
      ratifications: { DK: { approved: false, decisionId: "referendum", turn: 70 } },
    };
    db.collection("gameState").findOne.mockResolvedValue({
      currentTurn: 100,
      europeanIntegration: state,
    });
    expect(await ensureEuropeanIntegrationState(db as unknown as Db, "1991-default", true)).toBe(
      state
    );
    expect(db.collectionMocks.gameState.updateOne).not.toHaveBeenCalled();
  });
  it("uses the winning state after concurrent initialization", async () => {
    const db = createMockDb();
    const winner = {
      stage: "union",
      source: "legacy-settlement",
      establishedTurn: 100,
      ratifications: {},
    };
    db.collection("gameState")
      .findOne.mockResolvedValueOnce({ currentTurn: 100 })
      .mockResolvedValueOnce({ europeanIntegration: winner });
    db.collection("gameState").updateOne.mockResolvedValue({ matchedCount: 0 });
    expect(await ensureEuropeanIntegrationState(db as unknown as Db, "1991-default", false)).toBe(
      winner
    );
  });
});

describe("enacted Maastricht ratifications", () => {
  it("settles only after every current membership has a passed authorization and the effective date arrives", async () => {
    const { recordEnactedMaastricht, reconcileEuropeanTreatyLive } = await import("./service");
    const { ObjectId } = await import("mongodb");
    const db = createMockDb();
    const world = {
      currentTurn: 55,
      startingYear: 1991,
      preset: "1991-default",
      europeanIntegration: {
        stage: "community",
        source: "historical-seed",
        establishedTurn: 1,
        ratifications: {},
      },
    };
    const members = ["DE", "IE", "UK"].map((countryId) => ({
      _id: new ObjectId(),
      countryId,
      joinedTurn: 0,
    }));
    db.collection("gameState").findOne.mockImplementation(async () => structuredClone(world));
    db.collection("gameState").updateOne.mockImplementation(async (_filter, update) => {
      Object.assign(world, update.$set);
      return { matchedCount: 1 };
    });
    db.collection("organizationMemberships").find.mockReturnValue({ toArray: async () => members });
    const asDb = db as unknown as Db;
    await recordEnactedMaastricht(asDb, "DE", true, "de-law", 55);
    await recordEnactedMaastricht(asDb, "IE", true, "ie-law", 56);
    expect(await reconcileEuropeanTreatyLive(asDb, 137)).toBe(false);
    await recordEnactedMaastricht(asDb, "UK", true, "uk-law", 57);
    expect(await reconcileEuropeanTreatyLive(asDb, 136)).toBe(false);
    // A new membership identity cannot reuse the country's old authorization.
    members[2]._id = new ObjectId();
    members[2].joinedTurn = 100;
    expect(await reconcileEuropeanTreatyLive(asDb, 137)).toBe(false);
    await recordEnactedMaastricht(asDb, "UK", true, "uk-new-law", 138);
    expect(await reconcileEuropeanTreatyLive(asDb, 138)).toBe(true);
    expect(world.europeanIntegration.stage).toBe("union");
    const settled = structuredClone(world);
    expect(await reconcileEuropeanTreatyLive(asDb, 139)).toBe(false);
    expect(world).toEqual(settled);
  });
});
