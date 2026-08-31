/**
 * The leader's mandate has to survive a country merge.
 *
 * `countryLeaderStates` is keyed `${countryId}_${characterId}`, so a record does
 * not follow its leader when their state is absorbed — the carried head of
 * government arrived in the unified country with no mandate on record and the
 * next `installNewLeader` reset them to 75.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";
import {
  installNewLeader,
  carryLeaderStateOnMerge,
  adjustLeaderConfidence,
  INITIAL_CONFIDENCE,
  MAX_CONFIDENCE,
  REUNIFICATION_BUMP,
} from "@/lib/turn/rulingPartyConfidence";
import type { CountryLeaderState } from "@/lib/db/types/countryLeaderState";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/countryState", () => ({
  getCountryState: vi.fn().mockResolvedValue({ governmentType: "onePartyState" }),
}));

function makeMockDb() {
  const docs = new Map<string, CountryLeaderState>();

  const clone = (doc: CountryLeaderState): CountryLeaderState => ({
    ...doc,
    _id: doc._id,
    leaderCharacterId: new ObjectId(doc.leaderCharacterId.toString()),
    confidenceHistory: doc.confidenceHistory.map((h) => ({ ...h, at: new Date(h.at) })),
    createdAt: new Date(doc.createdAt),
    updatedAt: new Date(doc.updatedAt),
  });

  const collection = {
    findOne: vi.fn().mockImplementation((f: { _id?: string }) => {
      const doc = f._id ? docs.get(f._id) : undefined;
      return Promise.resolve(doc ? clone(doc) : null);
    }),
    replaceOne: vi.fn().mockImplementation((f: { _id: string }, doc: CountryLeaderState) => {
      docs.set(f._id, clone(doc));
      return Promise.resolve({ modifiedCount: 1, upsertedCount: 1 });
    }),
    deleteOne: vi.fn().mockImplementation((f: { _id: string }) => {
      const had = docs.delete(f._id);
      return Promise.resolve({ deletedCount: had ? 1 : 0 });
    }),
    findOneAndUpdate: vi
      .fn()
      .mockImplementation(
        (
          f: { _id: string },
          update: { $set?: Partial<CountryLeaderState>; $inc?: Record<string, number> }
        ) => {
          const existing = docs.get(f._id);
          if (!existing) return Promise.resolve(null);
          const next = clone(existing);
          if (update.$set) Object.assign(next, update.$set);
          if (update.$inc) {
            const indexable = next as unknown as Record<string, number>;
            for (const [k, v] of Object.entries(update.$inc)) {
              indexable[k] = (indexable[k] ?? 0) + v;
            }
          }
          docs.set(f._id, next);
          return Promise.resolve(next);
        }
      ),
  };

  return {
    docs,
    db: { collection: vi.fn().mockReturnValue(collection) } as unknown as import("mongodb").Db,
  };
}

describe("carryLeaderStateOnMerge", () => {
  const leaderId = new ObjectId();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  async function seatGdrLeader(db: import("mongodb").Db, confidence: number) {
    await installNewLeader(db, "DD", leaderId, "generalSecretary", "1", 400);
    // Move off the install default so the carry is provably reading the record
    // rather than re-installing at INITIAL_CONFIDENCE.
    await adjustLeaderConfidence(
      db,
      "DD",
      leaderId,
      confidence - INITIAL_CONFIDENCE,
      "test setup",
      400
    );
  }

  it("carries the record to the survivor, bumped, and clears the absorbed row", async () => {
    const { db, docs } = makeMockDb();
    await seatGdrLeader(db, 76);

    const carried = await carryLeaderStateOnMerge(db, {
      fromCountryId: "DD",
      toCountryId: "DE",
      leaderCharacterId: leaderId,
      leaderOfficeType: "chancellor",
      governingPartyId: "7",
      currentTurn: 530,
    });

    expect(carried).not.toBeNull();
    expect(carried!.partyConfidence).toBe(76 + REUNIFICATION_BUMP);
    expect(carried!.countryId).toBe("DE");
    expect(carried!.leaderOfficeType).toBe("chancellor");
    expect(carried!.governingPartyId).toBe("7");
    // Tenure continues; it does not restart.
    expect(carried!.startedAtTurn).toBe(400);

    expect(docs.has(`DE_${leaderId.toString()}`)).toBe(true);
    expect(docs.has(`DD_${leaderId.toString()}`)).toBe(false);
  });

  it("records the carry in the confidence history", async () => {
    const { db } = makeMockDb();
    await seatGdrLeader(db, 76);

    const carried = await carryLeaderStateOnMerge(db, {
      fromCountryId: "DD",
      toCountryId: "DE",
      leaderCharacterId: leaderId,
      leaderOfficeType: "chancellor",
      governingPartyId: "7",
      currentTurn: 530,
    });

    const top = carried!.confidenceHistory[0]!;
    expect(top.turn).toBe(530);
    expect(top.previous).toBe(76);
    expect(top.next).toBe(76 + REUNIFICATION_BUMP);
    expect(top.delta).toBe(REUNIFICATION_BUMP);
  });

  it("clamps the bump at MAX_CONFIDENCE", async () => {
    const { db } = makeMockDb();
    await seatGdrLeader(db, MAX_CONFIDENCE);

    const carried = await carryLeaderStateOnMerge(db, {
      fromCountryId: "DD",
      toCountryId: "DE",
      leaderCharacterId: leaderId,
      leaderOfficeType: "chancellor",
      governingPartyId: "7",
      currentTurn: 530,
    });

    expect(carried!.partyConfidence).toBe(MAX_CONFIDENCE);
  });

  it("is idempotent — a second run does not bump again", async () => {
    const { db } = makeMockDb();
    await seatGdrLeader(db, 76);

    const args = {
      fromCountryId: "DD" as const,
      toCountryId: "DE" as const,
      leaderCharacterId: leaderId,
      leaderOfficeType: "chancellor",
      governingPartyId: "7",
      currentTurn: 530,
    };
    await carryLeaderStateOnMerge(db, args);
    const second = await carryLeaderStateOnMerge(db, { ...args, currentTurn: 531 });

    expect(second!.partyConfidence).toBe(76 + REUNIFICATION_BUMP);
    expect(
      second!.confidenceHistory.filter((h) => h.reason.includes("reunification"))
    ).toHaveLength(1);
  });

  it("returns null when the absorbed leader has no record (an NPP head of government)", async () => {
    const { db, docs } = makeMockDb();

    const carried = await carryLeaderStateOnMerge(db, {
      fromCountryId: "DD",
      toCountryId: "DE",
      leaderCharacterId: new ObjectId(),
      leaderOfficeType: "chancellor",
      governingPartyId: "7",
      currentTurn: 530,
    });

    expect(carried).toBeNull();
    expect(docs.size).toBe(0);
  });
});
