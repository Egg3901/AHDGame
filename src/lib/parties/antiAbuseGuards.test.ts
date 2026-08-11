import { describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import type { Character, PoliticalParty } from "@/lib/db/types";
import { createMockDb } from "@/lib/test-utils/mockDb";
import {
  buildNppElectionEligiblePartyKeys,
  getPartyNppControlStatus,
  getPartySwitchCooldown,
  getPurgeRejoinBlock,
  prunePurgeRejoinBlocks,
  PARTY_NPP_CONTROL_MIN_PLAYERS,
} from "./antiAbuseGuards";
import { PURGE_REJOIN_COOLDOWN_TURNS } from "@/lib/constants/partyActions";
import type { PurgeRejoinBlock } from "@/lib/db/types";

function makeParty(overrides: Partial<PoliticalParty> = {}): PoliticalParty {
  const now = new Date("2026-01-01T00:00:00Z");
  return {
    _id: new ObjectId(),
    sequentialId: 10,
    countryId: "US",
    name: "Custom Party",
    abbreviation: "CP",
    color: "#ffffff",
    economicPosition: 0,
    socialPosition: 0,
    chairId: null,
    viceChairId: null,
    treasurerId: null,
    committeeIds: [],
    memberCount: 0,
    isDefault: false,
    createdBy: null,
    treasury: 0,
    nationalTaxRate: 0,
    politicalStrength: 0,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe("party anti-abuse guards", () => {
  it("rate-limits party switching after a recent membership transition", () => {
    const result = getPartySwitchCooldown(
      {
        partyJoinedAt: new Date("2026-01-01T00:00:00Z"),
        lastPartySwitchAt: new Date("2026-01-01T12:00:00Z"),
      },
      new Date("2026-01-02T00:00:00Z")
    );

    expect(result.ok).toBe(false);
    expect(result.unblockAt?.toISOString()).toBe("2026-01-02T12:00:00.000Z");
  });

  it("allows default parties to use NPP controls immediately", async () => {
    const db = createMockDb();
    const result = await getPartyNppControlStatus({
      db: db as unknown as Db,
      countryId: "US",
      party: makeParty({ isDefault: true }),
      now: new Date("2026-01-01T00:00:00Z"),
    });

    expect(result.ok).toBe(true);
    expect(db.collectionMocks.characters).toBeUndefined();
  });

  it("blocks custom party NPP controls until party and actor tenure are stable", async () => {
    const db = createMockDb();
    const result = await getPartyNppControlStatus({
      db: db as unknown as Db,
      countryId: "US",
      party: makeParty({ createdAt: new Date("2026-01-01T00:00:00Z") }),
      actor: {
        party: "10",
        partyJoinedAt: new Date("2026-01-01T00:00:00Z"),
      } as Pick<Character, "party" | "partyJoinedAt" | "lastPartySwitchAt">,
      now: new Date("2026-01-01T12:00:00Z"),
    });

    expect(result.ok).toBe(false);
    expect(result.error).toContain("48 hours");
  });

  it("allows custom party NPP controls after age, membership, and actor tenure pass", async () => {
    const db = createMockDb();
    const members = Array.from({ length: PARTY_NPP_CONTROL_MIN_PLAYERS }, () => ({
      userId: new ObjectId(),
    }));
    db.collection("characters").find.mockReturnValue({
      project: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue(members),
      }),
    });
    db.collection("users").find.mockReturnValue({
      project: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([]),
      }),
    });

    const result = await getPartyNppControlStatus({
      db: db as unknown as Db,
      countryId: "US",
      party: makeParty({ createdAt: new Date("2026-01-01T00:00:00Z") }),
      actor: {
        party: "10",
        partyJoinedAt: new Date("2026-01-01T00:00:00Z"),
      } as Pick<Character, "party" | "partyJoinedAt" | "lastPartySwitchAt">,
      now: new Date("2026-01-04T00:00:00Z"),
    });

    expect(result.ok).toBe(true);
  });

  it("allows aged custom party NPPs to enter elections without the manual-control player minimum", async () => {
    const db = createMockDb();
    const keys = buildNppElectionEligiblePartyKeys(
      [makeParty({ createdAt: new Date("2026-01-01T00:00:00Z") })],
      new Date("2026-01-04T00:00:00Z")
    );

    expect(keys.has("US:10")).toBe(true);
    expect(db.collectionMocks.characters).toBeUndefined();
  });

  it("keeps brand-new custom parties out of automatic NPP election entry", async () => {
    const keys = buildNppElectionEligiblePartyKeys(
      [makeParty({ createdAt: new Date("2026-01-01T00:00:00Z") })],
      new Date("2026-01-01T12:00:00Z")
    );

    expect(keys.has("US:10")).toBe(false);
  });
});

describe("purge rejoin blocks", () => {
  const block = (overrides: Partial<PurgeRejoinBlock> = {}): PurgeRejoinBlock => ({
    partyId: "1",
    countryId: "IE",
    purgedAtTurn: 100,
    ...overrides,
  });

  describe("prunePurgeRejoinBlocks", () => {
    it("returns [] for undefined or empty", () => {
      expect(prunePurgeRejoinBlocks(undefined, 100)).toEqual([]);
      expect(prunePurgeRejoinBlocks([], 100)).toEqual([]);
    });

    it("keeps blocks still within the cooldown window", () => {
      const blocks = [block({ purgedAtTurn: 100 })];
      // 100 + 24 = 124 > 110 -> active
      expect(prunePurgeRejoinBlocks(blocks, 110)).toEqual(blocks);
    });

    it("drops blocks at or past expiry", () => {
      const expiryTurn = 100 + PURGE_REJOIN_COOLDOWN_TURNS; // 124
      // at expiry: 124 > 124 is false -> dropped
      expect(prunePurgeRejoinBlocks([block({ purgedAtTurn: 100 })], expiryTurn)).toEqual([]);
      // past expiry
      expect(prunePurgeRejoinBlocks([block({ purgedAtTurn: 100 })], expiryTurn + 5)).toEqual([]);
    });

    it("keeps active and drops expired in a mixed list", () => {
      const active = block({ partyId: "2", purgedAtTurn: 120 });
      const expired = block({ partyId: "3", purgedAtTurn: 50 });
      expect(prunePurgeRejoinBlocks([active, expired], 130)).toEqual([active]);
    });
  });

  describe("getPurgeRejoinBlock", () => {
    it("is not blocked for undefined/empty blocks", () => {
      expect(getPurgeRejoinBlock(undefined, "1", "IE", 100)).toEqual({
        blocked: false,
        turnsRemaining: 0,
      });
      expect(getPurgeRejoinBlock([], "1", "IE", 100)).toEqual({
        blocked: false,
        turnsRemaining: 0,
      });
    });

    it("blocks rejoining the purging party within the window with correct turnsRemaining", () => {
      const result = getPurgeRejoinBlock([block({ purgedAtTurn: 100 })], "1", "IE", 110);
      // 100 + 24 - 110 = 14
      expect(result).toEqual({ blocked: true, turnsRemaining: 14 });
    });

    it("does not block at or after expiry", () => {
      const expiryTurn = 100 + PURGE_REJOIN_COOLDOWN_TURNS; // 124
      expect(getPurgeRejoinBlock([block({ purgedAtTurn: 100 })], "1", "IE", expiryTurn)).toEqual({
        blocked: false,
        turnsRemaining: 0,
      });
    });

    it("does not block a different party", () => {
      expect(getPurgeRejoinBlock([block({ partyId: "1" })], "2", "IE", 110)).toEqual({
        blocked: false,
        turnsRemaining: 0,
      });
    });

    it("does not block the same sequentialId in a different country", () => {
      expect(
        getPurgeRejoinBlock([block({ partyId: "1", countryId: "IE" })], "1", "UK", 110)
      ).toEqual({
        blocked: false,
        turnsRemaining: 0,
      });
    });
  });
});
