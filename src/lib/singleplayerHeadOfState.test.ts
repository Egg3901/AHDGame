import { describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import {
  getSingleplayerHeadOfStateOfficeType,
  mayRuleByDecree,
  reconcileSingleplayerHeadOfState,
  seatSingleplayerHeadOfState,
} from "./singleplayerHeadOfState";
import type { Character } from "@/lib/db/types";
import { createMockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/turn/parliamentaryGovernment", () => ({
  appointPrimeMinister: vi.fn().mockResolvedValue(undefined),
  ensureParliamentaryGovernmentFormation: vi.fn().mockResolvedValue(null),
  tallySeatsByParty: vi.fn().mockResolvedValue({ "1": 2822, "2": 105, "3": 53 }),
}));
vi.mock("@/lib/singleplayer", () => ({
  SINGLEPLAYER_USER_ID: "504c41594552000000000001",
  isSingleplayer: vi.fn().mockReturnValue(true),
}));

describe("singleplayer head of state seating", () => {
  it("grants decree authority only to the matching permanent local head of state", () => {
    const ruler = { countryId: "DE", singleplayerHeadOfState: true } as Character;
    expect(mayRuleByDecree(ruler, "DE", true)).toBe(true);
    expect(mayRuleByDecree(ruler, "US", true)).toBe(false);
    expect(mayRuleByDecree(ruler, "DE", false)).toBe(false);
    expect(mayRuleByDecree({ countryId: "DE" } as Character, "DE", true)).toBe(false);
  });
  it("uses the governing executive for UK and Germany", () => {
    expect(getSingleplayerHeadOfStateOfficeType("UK", "2023-default")).toBe("primeMinister");
    expect(getSingleplayerHeadOfStateOfficeType("DE", "2023-default")).toBe("chancellor");
    expect(getSingleplayerHeadOfStateOfficeType("CN", "2019-default")).toBe("premier");
  });

  it("writes the player into the authored presidential office", async () => {
    const characterId = new ObjectId();
    const character = {
      _id: characterId,
      countryId: "US",
      name: "Local President",
      party: "Democratic Party",
    } as unknown as Character;
    const characters = {
      findOne: vi.fn().mockResolvedValue(character),
      updateMany: vi.fn().mockResolvedValue({}),
      updateOne: vi.fn().mockResolvedValue({}),
    };
    const electedOfficials = {
      updateMany: vi.fn().mockResolvedValue({}),
      updateOne: vi.fn().mockResolvedValue({}),
    };
    const npps = { updateMany: vi.fn().mockResolvedValue({}) };
    const db = {
      collection: vi.fn((name: string) =>
        name === "characters" ? characters : name === "npps" ? npps : electedOfficials
      ),
    };

    await expect(
      seatSingleplayerHeadOfState(db as never, {
        characterId,
        countryId: "US",
        now: new Date("2026-01-01T00:00:00Z"),
      })
    ).resolves.toBe(true);

    expect(electedOfficials.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({ officeType: "president" }),
      expect.objectContaining({
        $set: expect.objectContaining({ characterId, characterName: "Local President" }),
        $unset: { nppId: "" },
      }),
      { upsert: true }
    );
    expect(npps.updateMany).toHaveBeenCalledWith(
      { countryId: "US", "currentOffice.type": "president" },
      { $set: { currentOffice: null, updatedAt: expect.any(Date) } }
    );
    expect(characters.updateOne).toHaveBeenCalledWith(
      { _id: characterId },
      expect.objectContaining({
        $set: { currentOffice: { type: "president" }, updatedAt: expect.any(Date) },
      })
    );
  });

  it("writes a parliamentary head of state into the canonical government formation", async () => {
    const characterId = new ObjectId();
    const character = {
      _id: characterId,
      countryId: "CN",
      name: "Canonical Premier",
      party: "1",
    } as unknown as Character;
    const characters = {
      findOne: vi.fn().mockResolvedValue(character),
      updateMany: vi.fn().mockResolvedValue({}),
      updateOne: vi.fn().mockResolvedValue({}),
    };
    const electedOfficials = {
      updateMany: vi.fn().mockResolvedValue({}),
      updateOne: vi.fn().mockResolvedValue({}),
    };
    const npps = { updateMany: vi.fn().mockResolvedValue({}) };
    const governmentFormations = {
      findOne: vi.fn().mockResolvedValue({
        _id: "CN",
        countryId: "CN",
        cycle: 1,
        status: "pending",
        formationType: null,
        lostMajority: false,
        pmCharacterId: null,
        pmName: null,
        governingPartyId: "1",
        coalitionId: null,
        coalitionPartyIds: null,
        totalSeatsSupporting: 0,
        majorityThreshold: 1491,
        seatsByParty: {},
        totalSeats: 2980,
        activeVoteId: null,
        formedAt: null,
        formedTurn: null,
        collapsedAt: null,
        createdAt: new Date("2026-01-01T00:00:00Z"),
        updatedAt: new Date("2026-01-01T00:00:00Z"),
      }),
      updateOne: vi.fn().mockResolvedValue({}),
    };
    const db = {
      collection: vi.fn((name: string) => {
        if (name === "characters") return characters;
        if (name === "npps") return npps;
        if (name === "electedOfficials") return electedOfficials;
        return governmentFormations;
      }),
    };

    await expect(
      seatSingleplayerHeadOfState(db as never, {
        characterId,
        countryId: "CN",
        now: new Date("2026-01-01T00:00:00Z"),
        preset: "2019-default",
      })
    ).resolves.toBe(true);

    expect(governmentFormations.updateOne).toHaveBeenCalledWith(
      { _id: "CN" },
      expect.objectContaining({
        $set: expect.objectContaining({
          status: "formed",
          pmCharacterId: characterId,
          pmName: "Canonical Premier",
          governingPartyId: "1",
          seatsByParty: { "1": 2822, "2": 105, "3": 53 },
          totalSeats: 2980,
          majorityThreshold: 1491,
        }),
      })
    );
  });

  it("repairs an existing local HOS world without rewriting it on every status poll", async () => {
    const characterId = new ObjectId();
    const character = {
      _id: characterId,
      userId: new ObjectId("504c41594552000000000001"),
      countryId: "CN",
      name: "Canonical Premier",
      party: "1",
      singleplayerHeadOfState: true,
      currentOffice: { type: "premier" },
    } as unknown as Character;
    let formation: Record<string, unknown> = {
      _id: "CN",
      countryId: "CN",
      cycle: 1,
      status: "pending",
      formationType: null,
      lostMajority: false,
      pmCharacterId: null,
      pmName: null,
      governingPartyId: "1",
      coalitionId: null,
      coalitionPartyIds: null,
      totalSeatsSupporting: 0,
      majorityThreshold: 1491,
      seatsByParty: { "1": 2822, "2": 105, "3": 53 },
      totalSeats: 2980,
      activeVoteId: null,
      formedAt: null,
      formedTurn: null,
      collapsedAt: null,
      createdAt: new Date("2026-01-01T00:00:00Z"),
      updatedAt: new Date("2026-01-01T00:00:00Z"),
    };
    const db = createMockDb();
    db.collection("gameState");
    db.collection("characters");
    db.collection("governmentFormations");
    db.collectionMocks.gameState.findOne.mockResolvedValue({
      _id: "current",
      preset: "2019-default",
      currentTurn: 3,
      singleplayerConfig: { mode: "head-of-state" },
    });
    db.collectionMocks.characters.findOne.mockResolvedValue(character);
    db.collectionMocks.governmentFormations.findOne.mockImplementation(async () => formation);
    db.collectionMocks.governmentFormations.updateOne.mockImplementation(
      async (_filter, update) => {
        formation = { ...formation, ...(update as { $set: Record<string, unknown> }).$set };
        return { matchedCount: 1, modifiedCount: 1 };
      }
    );

    await expect(
      reconcileSingleplayerHeadOfState(db as never, { now: new Date("2026-01-01T00:00:00Z") })
    ).resolves.toBe(true);
    await expect(
      reconcileSingleplayerHeadOfState(db as never, { now: new Date("2026-01-01T00:00:01Z") })
    ).resolves.toBe(true);

    expect(db.collectionMocks.governmentFormations.updateOne).toHaveBeenCalledOnce();
    expect(formation).toMatchObject({
      status: "formed",
      pmCharacterId: characterId,
      pmName: "Canonical Premier",
      totalSeatsSupporting: 2822,
    });
  });
});
