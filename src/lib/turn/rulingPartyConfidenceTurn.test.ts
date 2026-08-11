/**
 * Unit tests for ruling-party confidence turn processing.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";
import { processRulingPartyConfidenceTurn } from "@/lib/turn/rulingPartyConfidenceTurn";
import type { GovernmentFormation } from "@/lib/db/types/governmentFormation";
import type { CountryLeaderState } from "@/lib/db/types/countryLeaderState";
import { installNewLeader } from "@/lib/turn/rulingPartyConfidence";

vi.mock("@/lib/mongodb", () => ({
  getDb: vi.fn(),
}));

function makeMockDb() {
  const govDocs: Map<string, GovernmentFormation> = new Map();
  const leaderDocs: Map<string, CountryLeaderState> = new Map();

  const govCollection = {
    findOne: vi.fn().mockImplementation((filter: { _id?: string }) => {
      const doc = filter._id ? (govDocs.get(filter._id) ?? null) : null;
      return Promise.resolve(doc ? { ...doc } : null);
    }),
  };

  const leaderCollection = {
    findOne: vi.fn().mockImplementation((filter: { _id?: string }) => {
      const doc = filter._id ? (leaderDocs.get(filter._id) ?? null) : null;
      if (!doc) return Promise.resolve(null);
      return Promise.resolve({
        ...doc,
        leaderCharacterId: new ObjectId(doc.leaderCharacterId.toString()),
        createdAt: new Date(doc.createdAt),
        updatedAt: new Date(doc.updatedAt),
        confidenceHistory: doc.confidenceHistory.map((h: { at: string | number | Date }) => ({
          ...h,
          at: new Date(h.at),
        })),
      });
    }),
    replaceOne: vi.fn().mockImplementation((filter: { _id: string }, doc: CountryLeaderState) => {
      leaderDocs.set(filter._id, {
        ...doc,
        leaderCharacterId: new ObjectId(doc.leaderCharacterId.toString()),
      });
      return Promise.resolve({ modifiedCount: 1, upsertedCount: 1 });
    }),
    findOneAndUpdate: vi
      .fn()
      .mockImplementation(
        (
          filter: { _id: string },
          update: { $set?: Partial<CountryLeaderState>; $inc?: Record<string, number> }
        ) => {
          const existing = leaderDocs.get(filter._id);
          if (!existing) return Promise.resolve(null);
          const clone: CountryLeaderState = {
            ...existing,
            leaderCharacterId: new ObjectId(existing.leaderCharacterId.toString()),
            createdAt: new Date(existing.createdAt),
            updatedAt: new Date(existing.updatedAt),
            confidenceHistory: existing.confidenceHistory.map((h) => ({
              ...h,
              at: new Date(h.at),
            })),
          };
          if (update.$set) {
            Object.assign(clone, update.$set);
          }
          if (update.$inc) {
            const indexable = clone as unknown as Record<string, number>;
            for (const [key, val] of Object.entries(update.$inc)) {
              indexable[key] = (indexable[key] ?? 0) + val;
            }
          }
          leaderDocs.set(filter._id, clone);
          return Promise.resolve(clone);
        }
      ),
  };

  return {
    govDocs,
    leaderDocs,
    db: {
      collection: vi.fn().mockImplementation((name: string) => {
        if (name === "governmentFormations") return govCollection;
        if (name === "countryLeaderStates") return leaderCollection;
        return { findOne: vi.fn().mockResolvedValue(null) };
      }),
    } as unknown as import("mongodb").Db,
  };
}

describe("processRulingPartyConfidenceTurn", () => {
  const leaderId = new ObjectId();
  const currentTurn = 15;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null when no CN government formation exists", async () => {
    const { db } = makeMockDb();
    const result = await processRulingPartyConfidenceTurn(db, "CN", currentTurn);
    expect(result).toBeNull();
  });

  it("returns null when no leader is seated", async () => {
    const { db, govDocs } = makeMockDb();
    govDocs.set("CN", {
      _id: "CN",
      countryId: "CN",
      pmCharacterId: null,
      pmName: null,
      status: "pending",
      cycle: 1,
      formationType: null,
      lostMajority: false,
      governingPartyId: null,
      coalitionId: null,
      coalitionPartyIds: null,
      totalSeatsSupporting: 0,
      majorityThreshold: 0,
      seatsByParty: {},
      totalSeats: 0,
      activeVoteId: null,
      formedAt: null,
      formedTurn: null,
      collapsedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as GovernmentFormation);
    const result = await processRulingPartyConfidenceTurn(db, "CN", currentTurn);
    expect(result).toBeNull();
  });

  it("returns null when no confidence state exists", async () => {
    const { db, govDocs } = makeMockDb();
    govDocs.set("CN", {
      _id: "CN",
      countryId: "CN",
      pmCharacterId: leaderId,
      pmName: "Test Leader",
      status: "formed",
      cycle: 1,
      formationType: "majority",
      lostMajority: false,
      governingPartyId: "1",
      coalitionId: null,
      coalitionPartyIds: null,
      totalSeatsSupporting: 3000,
      majorityThreshold: 1501,
      seatsByParty: { "1": 3000 },
      totalSeats: 3000,
      activeVoteId: null,
      formedAt: new Date(),
      formedTurn: 10,
      collapsedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as GovernmentFormation);
    const result = await processRulingPartyConfidenceTurn(db, "CN", currentTurn);
    expect(result).toBeNull();
  });

  it("processes turn drift and updates confidence", async () => {
    const { db, govDocs, leaderDocs: _leaderDocs } = makeMockDb();

    // Set up government formation
    govDocs.set("CN", {
      _id: "CN",
      countryId: "CN",
      pmCharacterId: leaderId,
      pmName: "Test Leader",
      status: "formed",
      cycle: 1,
      formationType: "majority",
      lostMajority: false,
      governingPartyId: "1",
      coalitionId: null,
      coalitionPartyIds: null,
      totalSeatsSupporting: 3000,
      majorityThreshold: 1501,
      seatsByParty: { "1": 3000 },
      totalSeats: 3000,
      activeVoteId: null,
      formedAt: new Date(),
      formedTurn: 10,
      collapsedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as GovernmentFormation);

    // Install leader confidence
    await installNewLeader(db, "CN", leaderId, "premier", "1", 10);

    const result = await processRulingPartyConfidenceTurn(db, "CN", currentTurn, [
      "industrial-investment",
    ]);
    expect(result).not.toBeNull();
    expect(result!.previousConfidence).toBe(75);
    expect(result!.newConfidence).toBeGreaterThan(75); // industrial investment should boost
    expect(result!.delta).toBeGreaterThan(0);
    expect(result!.consequenceLevel).toBe("none");
    expect(result!.purgeEventsProcessed).toBe(0);
  });

  it("applies purge effects", async () => {
    const { db, govDocs, leaderDocs: _leaderDocs } = makeMockDb();

    govDocs.set("CN", {
      _id: "CN",
      countryId: "CN",
      pmCharacterId: leaderId,
      pmName: "Test Leader",
      status: "formed",
      cycle: 1,
      formationType: "majority",
      lostMajority: false,
      governingPartyId: "1",
      coalitionId: null,
      coalitionPartyIds: null,
      totalSeatsSupporting: 3000,
      majorityThreshold: 1501,
      seatsByParty: { "1": 3000 },
      totalSeats: 3000,
      activeVoteId: null,
      formedAt: new Date(),
      formedTurn: 10,
      collapsedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as GovernmentFormation);

    await installNewLeader(db, "CN", leaderId, "premier", "1", 10);

    const purges = [
      {
        countryId: "CN" as const,
        severity: "senior" as const,
        reason: "Corruption scandal",
        turn: currentTurn,
        processed: false,
        createdAt: new Date(),
      },
    ];

    const result = await processRulingPartyConfidenceTurn(db, "CN", currentTurn, [], purges);
    expect(result).not.toBeNull();
    expect(result!.delta).toBe(-7); // senior purge delta
    expect(result!.newConfidence).toBe(75 - 7);
    expect(result!.purgeEventsProcessed).toBe(1);
  });

  it("returns consequence level when confidence drops below threshold", async () => {
    const { db, govDocs, leaderDocs } = makeMockDb();

    govDocs.set("CN", {
      _id: "CN",
      countryId: "CN",
      pmCharacterId: leaderId,
      pmName: "Test Leader",
      status: "formed",
      cycle: 1,
      formationType: "majority",
      lostMajority: false,
      governingPartyId: "1",
      coalitionId: null,
      coalitionPartyIds: null,
      totalSeatsSupporting: 3000,
      majorityThreshold: 1501,
      seatsByParty: { "1": 3000 },
      totalSeats: 3000,
      activeVoteId: null,
      formedAt: new Date(),
      formedTurn: 10,
      collapsedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as GovernmentFormation);

    await installNewLeader(db, "CN", leaderId, "premier", "1", 10);

    // Manually drop confidence to near threshold
    const stateId = `CN_${leaderId.toString()}`;
    const stored = leaderDocs.get(stateId);
    if (stored) stored.partyConfidence = 48;

    const result = await processRulingPartyConfidenceTurn(db, "CN", currentTurn, [
      "market-liberalization",
    ]);
    expect(result).not.toBeNull();
    expect(result!.previousConfidence).toBe(48);
    expect(result!.newConfidence).toBeLessThan(48);
    expect(result!.consequenceLevel).toBe("discipline_loss");
  });
});
