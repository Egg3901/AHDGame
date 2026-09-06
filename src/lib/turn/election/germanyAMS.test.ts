import { describe, it, expect } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import {
  aggregateDirectMandates,
  allocateListSeatsPerLand,
  assignListSeats,
  maybeReconcileBundestag,
  persistBundestagResult,
  type BundestagElectionResult,
  type DirectMandates,
  type FederalAllocation,
  type ZweitstimmenByLand,
  type LandListAllocation,
  type ListOfficialDraft,
} from "./germanyAMS";
import type { ElectedOfficial } from "@/lib/db/types";

function oid(): ObjectId {
  return new ObjectId();
}

// ─────────────────────────────────────────────────────────────────────────────
// Lightweight in-memory Mongo-like fake — enough to exercise the orchestrator
// (find/findOne/insertOne/insertMany/updateOne/deleteMany/countDocuments with
// $in / $nin / $exists / $or filters and ObjectId equality).
// ─────────────────────────────────────────────────────────────────────────────

type Doc = Record<string, unknown>;

function matchClause(doc: Doc, key: string, val: unknown): boolean {
  if (val && typeof val === "object" && !(val instanceof ObjectId) && !Array.isArray(val)) {
    const cond = val as Record<string, unknown>;
    if ("$in" in cond) {
      const arr = cond.$in as unknown[];
      const dv = doc[key];
      return arr.some((v) =>
        v instanceof ObjectId && dv instanceof ObjectId ? v.equals(dv) : v === dv
      );
    }
    if ("$nin" in cond) {
      const arr = cond.$nin as unknown[];
      const dv = doc[key];
      return !arr.some((v) =>
        v instanceof ObjectId && dv instanceof ObjectId ? v.equals(dv) : v === dv
      );
    }
    if ("$exists" in cond) {
      const exists = key in doc && doc[key] !== undefined;
      return cond.$exists ? exists : !exists;
    }
    if ("$ne" in cond) {
      return doc[key] !== cond.$ne;
    }
  }
  if (val instanceof ObjectId && doc[key] instanceof ObjectId) {
    return val.equals(doc[key] as ObjectId);
  }
  return doc[key] === val;
}

function matches(doc: Doc, query: Doc): boolean {
  for (const [key, val] of Object.entries(query)) {
    if (key === "$or") {
      const clauses = val as Doc[];
      if (!clauses.some((c) => matches(doc, c))) return false;
      continue;
    }
    if (!matchClause(doc, key, val)) return false;
  }
  return true;
}

interface FakeDb extends Db {
  _data: Record<string, Doc[]>;
}

function makeFakeDb(seed: Record<string, Doc[]>): FakeDb {
  const collections: Record<string, Doc[]> = {};
  for (const [name, docs] of Object.entries(seed)) {
    collections[name] = docs.map((d) => ({ ...d }));
  }

  const makeCollection = (name: string) => {
    const docs = () => (collections[name] ??= []);
    return {
      find: (query: Doc = {}, _opts?: unknown) => {
        const cursor = {
          toArray: async () => docs().filter((d) => matches(d, query)),
          // `buildDEPartySlugToSeqId` resolves the ticket-split rate table's
          // slugs against the live roster with `.project()`, so the fake cursor
          // needs it. Projection shape is irrelevant here — the resolver reads
          // `name` and `sequentialId` off whatever comes back.
          project: (_projection?: unknown) => cursor,
        };
        return cursor;
      },
      findOne: async (query: Doc = {}) => docs().find((d) => matches(d, query)) ?? null,
      insertOne: async (doc: Doc) => {
        docs().push(doc);
        return { insertedId: doc._id };
      },
      insertMany: async (newDocs: Doc[]) => {
        for (const d of newDocs) docs().push(d);
        return { insertedCount: newDocs.length };
      },
      updateOne: async (query: Doc, update: { $set?: Doc }) => {
        const d = docs().find((dd) => matches(dd, query));
        if (!d) return { matchedCount: 0, modifiedCount: 0 };
        Object.assign(d, update.$set ?? {});
        return { matchedCount: 1, modifiedCount: 1 };
      },
      deleteMany: async (query: Doc) => {
        const keep = docs().filter((d) => !matches(d, query));
        const removed = docs().length - keep.length;
        collections[name] = keep;
        return { deletedCount: removed };
      },
      countDocuments: async (query: Doc = {}) => docs().filter((d) => matches(d, query)).length,
    };
  };

  return {
    _data: collections,
    collection: (name: string) => makeCollection(name),
  } as unknown as FakeDb;
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 1: aggregateDirectMandates
// ─────────────────────────────────────────────────────────────────────────────

describe("aggregateDirectMandates", () => {
  function off(party: string, state: string, seatsHeld: number, charId = oid()): ElectedOfficial {
    return {
      _id: oid(),
      countryId: "DE",
      officeType: "bundestag",
      state,
      party,
      seatsHeld,
      characterId: charId,
      characterName: "Rep " + party + state,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }

  it("sums seatsHeld per party and per (party, Land)", () => {
    const officials = [off("2", "BW", 30), off("2", "BY", 40), off("1", "BW", 12)];
    const result: DirectMandates = aggregateDirectMandates(officials);
    expect(result.byParty["2"]).toBe(70);
    expect(result.byParty["1"]).toBe(12);
    expect(result.byPartyLand["2"]["BW"]).toBe(30);
    expect(result.byPartyLand["2"]["BY"]).toBe(40);
    expect(result.totalDirect).toBe(82);
  });

  it("captures representative characterId per (party, Land) for dedupe", () => {
    const cId = oid();
    const result = aggregateDirectMandates([off("2", "BW", 30, cId)]);
    expect(result.repByPartyLand["2"]["BW"]?.equals(cId)).toBe(true);
  });

  it("ignores docs missing party or state", () => {
    const noState = { ...off("2", "BW", 5), state: undefined };
    const result = aggregateDirectMandates([noState as ElectedOfficial]);
    expect(result.totalDirect).toBe(0);
  });

  it("builds a per-party fallback holder, preferring an NPP-backed seat", () => {
    const playerSeat = off("2", "BW", 10); // player rep
    const nppId = oid();
    const nppSeat: ElectedOfficial = {
      ...off("2", "BY", 8),
      characterId: null,
      nppId,
      isNPP: true,
      characterName: "CDU NPP",
    };
    const result = aggregateDirectMandates([playerSeat, nppSeat]);
    expect(result.partyRep["2"].isNPP).toBe(true);
    expect(result.partyRep["2"].nppId?.equals(nppId)).toBe(true);
    expect(result.partyRep["2"].characterName).toBe("CDU NPP");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Phase 4: allocateListSeatsPerLand (aggregate)
// ─────────────────────────────────────────────────────────────────────────────

function mkDirect(byPartyLand: Record<string, Record<string, number>>): DirectMandates {
  const byParty: Record<string, number> = {};
  let totalDirect = 0;
  for (const [p, lands] of Object.entries(byPartyLand)) {
    for (const seats of Object.values(lands)) {
      byParty[p] = (byParty[p] ?? 0) + seats;
      totalDirect += seats;
    }
  }
  return { byParty, byPartyLand, repByPartyLand: {}, partyRep: {}, totalDirect };
}

describe("allocateListSeatsPerLand (aggregate)", () => {
  it("list seats = Land quota minus direct seats, no overhang", () => {
    const federal: FederalAllocation = { partySeats: { spd: 100 }, totalAllocated: 100 };
    const direct = mkDirect({ spd: { BW: 1, BY: 1, NW: 1 } });
    const zweitstimmen: ZweitstimmenByLand = {
      national: { spd: 90000 },
      perLand: { spd: { BW: 20000, BY: 30000, NW: 40000 } },
    };
    const result = allocateListSeatsPerLand(federal, direct, zweitstimmen);
    const total = result.reduce((s, r) => s + r.listSeatsAwarded, 0);
    // 100 federal − 3 direct = 97 list seats
    expect(total).toBe(97);
    for (const r of result) {
      expect(r.listSeatsAwarded).toBe(r.listQuotaRaw - r.directSeats);
      expect(r.listSeatsAwarded).toBeGreaterThanOrEqual(0);
    }
  });

  it("clamps overhang to zero (direct exceeds Land quota)", () => {
    const federal: FederalAllocation = { partySeats: { csu: 2 }, totalAllocated: 2 };
    const direct = mkDirect({ csu: { BY: 3 } }); // 3 direct in BY, only 2 federal
    const zweitstimmen: ZweitstimmenByLand = {
      national: { csu: 100000 },
      perLand: { csu: { BY: 100000 } },
    };
    const result = allocateListSeatsPerLand(federal, direct, zweitstimmen);
    const by = result.find((r) => r.landId === "BY")!;
    expect(by.listQuotaRaw).toBe(2);
    expect(by.directSeats).toBe(3);
    expect(by.listSeatsAwarded).toBe(0); // clamped, no dropping
  });

  it("skips parties with zero federal allocation", () => {
    const federal: FederalAllocation = { partySeats: {}, totalAllocated: 0 };
    const direct = mkDirect({ tiny: { HH: 1 } });
    const zweitstimmen: ZweitstimmenByLand = {
      national: { tiny: 5000 },
      perLand: { tiny: { HH: 5000 } },
    };
    expect(allocateListSeatsPerLand(federal, direct, zweitstimmen)).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Phase 5: assignListSeats
// ─────────────────────────────────────────────────────────────────────────────

describe("assignListSeats", () => {
  function rep(
    name: string,
    id = oid()
  ): { characterId: ObjectId; nppId: null; characterName: string; isNPP: false } {
    return { characterId: id, nppId: null, characterName: name, isNPP: false };
  }

  it("emits one named aggregate official per party+Land with seatSource list", () => {
    const repA = rep("Anna");
    const allocations: LandListAllocation[] = [
      { partyId: "2", landId: "BW", directSeats: 5, listQuotaRaw: 12, listSeatsAwarded: 7 },
    ];
    const candidatesByPartyLand = new Map([["2:BW", [repA]]]);
    const drafts: ListOfficialDraft[] = assignListSeats(
      allocations,
      candidatesByPartyLand,
      new Map(),
      {}
    );
    expect(drafts).toHaveLength(1);
    expect(drafts[0].seatsHeld).toBe(7);
    expect(drafts[0].seatSource).toBe("list");
    expect(drafts[0].party).toBe("2");
    expect(drafts[0].state).toBe("BW");
    expect(drafts[0].characterId?.equals(repA.characterId)).toBe(true);
    expect(drafts[0].characterName).toBe("Anna");
  });

  it("skips allocations with zero list seats", () => {
    const allocations: LandListAllocation[] = [
      { partyId: "2", landId: "BW", directSeats: 5, listQuotaRaw: 5, listSeatsAwarded: 0 },
    ];
    expect(assignListSeats(allocations, new Map(), new Map(), {})).toHaveLength(0);
  });

  it("picks a representative not already the direct rep when possible", () => {
    const directRepId = oid();
    const directRep = rep("Direct", directRepId);
    const listCandidate = rep("ListPerson");
    const allocations: LandListAllocation[] = [
      { partyId: "2", landId: "BW", directSeats: 1, listQuotaRaw: 3, listSeatsAwarded: 2 },
    ];
    const candidatesByPartyLand = new Map([["2:BW", [directRep, listCandidate]]]);
    const directReps = new Map<string, ObjectId | null>([["2:BW", directRepId]]);
    const drafts = assignListSeats(allocations, candidatesByPartyLand, directReps, {});
    expect(drafts[0].characterId?.equals(listCandidate.characterId)).toBe(true);
    expect(drafts[0].characterName).toBe("ListPerson");
  });

  it("falls back to the party rep (NPP) when no resident candidates exist", () => {
    const nppId = oid();
    const allocations: LandListAllocation[] = [
      { partyId: "9", landId: "HH", directSeats: 0, listQuotaRaw: 2, listSeatsAwarded: 2 },
    ];
    const partyRep = {
      "9": { characterId: null, nppId, characterName: "Party 9 NPP", isNPP: true },
    };
    const drafts = assignListSeats(allocations, new Map(), new Map(), partyRep);
    expect(drafts).toHaveLength(1);
    expect(drafts[0].characterId).toBeNull();
    expect(drafts[0].nppId?.equals(nppId)).toBe(true);
    expect(drafts[0].characterName).toBe("Party 9 NPP");
    expect(drafts[0].isNPP).toBe(true);
    expect(drafts[0].seatsHeld).toBe(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Orchestrator + persist + per-cycle guard (in-memory fake DB)
// ─────────────────────────────────────────────────────────────────────────────

describe("maybeReconcileBundestag (aggregate)", () => {
  it("fills list seats once and is guarded per cycle", async () => {
    const now = new Date();
    const elA = oid();
    const elB = oid();

    const db = makeFakeDb({
      gameState: [{ _id: "current", currentTurn: 10 }],
      elections: [
        {
          _id: elA,
          countryId: "DE",
          electionType: "bundestag",
          cycle: 1,
          status: "resolved",
          state: "BW",
          seatId: "DE-bundestag-BW",
          totalSeats: 30,
        },
        {
          _id: elB,
          countryId: "DE",
          electionType: "bundestag",
          cycle: 1,
          status: "resolved",
          state: "BY",
          seatId: "DE-bundestag-BY",
          totalSeats: 40,
        },
      ],
      electionVoteTallies: [
        {
          electionId: elA,
          totalVotes: { c1: 60000, c2: 40000 },
          candidateParties: { c1: "2", c2: "1" },
        },
        {
          electionId: elB,
          totalVotes: { c3: 70000, c4: 30000 },
          candidateParties: { c3: "2", c4: "1" },
        },
      ],
      electedOfficials: [
        {
          _id: oid(),
          countryId: "DE",
          officeType: "bundestag",
          state: "BW",
          party: "2",
          seatsHeld: 18,
          characterId: oid(),
          characterName: "CDU Rep BW",
          createdAt: now,
          updatedAt: now,
        },
        {
          _id: oid(),
          countryId: "DE",
          officeType: "bundestag",
          state: "BW",
          party: "1",
          seatsHeld: 12,
          characterId: oid(),
          characterName: "SPD Rep BW",
          createdAt: now,
          updatedAt: now,
        },
        {
          _id: oid(),
          countryId: "DE",
          officeType: "bundestag",
          state: "BY",
          party: "2",
          seatsHeld: 40,
          characterId: oid(),
          characterName: "CDU Rep BY",
          createdAt: now,
          updatedAt: now,
        },
      ],
      characters: [],
      landeslisten: [],
    });

    const result = await maybeReconcileBundestag(db, 1, now);
    expect(result).not.toBeNull();

    const listOfficials = (await db
      .collection("electedOfficials")
      .find({ countryId: "DE", officeType: "bundestag", seatSource: "list" })
      .toArray()) as unknown as ElectedOfficial[];
    const listSeats = listOfficials.reduce((s, o) => s + (o.seatsHeld ?? 0), 0);
    const directSeats = 18 + 12 + 40;
    expect(directSeats + listSeats).toBe(630);
    // Every list official must carry a characterName, else the members API drops
    // it and the seats stay invisible (the bug this fix addresses).
    expect(listOfficials.length).toBeGreaterThan(0);
    for (const o of listOfficials) {
      expect(o.characterName).toBeTruthy();
    }

    const gs = await db.collection("gameState").findOne({ _id: "current" } as never);
    expect((gs as { lastBundestagReconciledCycle?: number }).lastBundestagReconciledCycle).toBe(1);

    // Second invocation is a no-op (guarded by lastBundestagReconciledCycle).
    const again = await maybeReconcileBundestag(db, 1, now);
    expect(again).toBeNull();
  });

  it("sizes the federal chamber to the era's preset, not a hardcoded 630 (issue #3896)", async () => {
    // Same shape as the "fills list seats once" case above, but the world's
    // gameState carries `preset: "1953-default"` — DE's era-configured
    // Bundestag is 487 seats (COUNTRY_CONFIGS ERA_COUNTRY_CONFIG_OVERRIDES),
    // not the modern 630. Before the fix, allocateBundestag hardcoded
    // BUNDESTAG_SEATS = 630 regardless of era, over-seating a 1953 Bundestag
    // by 51% (630 held against a 251-seat direct-mandate founding cycle).
    const now = new Date();
    const elA = oid();
    const elB = oid();

    const db = makeFakeDb({
      gameState: [{ _id: "current", currentTurn: 10, preset: "1953-default" }],
      elections: [
        {
          _id: elA,
          countryId: "DE",
          electionType: "bundestag",
          cycle: 1,
          status: "resolved",
          state: "BW",
          seatId: "DE-bundestag-BW",
          totalSeats: 30,
        },
        {
          _id: elB,
          countryId: "DE",
          electionType: "bundestag",
          cycle: 1,
          status: "resolved",
          state: "BY",
          seatId: "DE-bundestag-BY",
          totalSeats: 40,
        },
      ],
      electionVoteTallies: [
        {
          electionId: elA,
          totalVotes: { c1: 60000, c2: 40000 },
          candidateParties: { c1: "2", c2: "1" },
        },
        {
          electionId: elB,
          totalVotes: { c3: 70000, c4: 30000 },
          candidateParties: { c3: "2", c4: "1" },
        },
      ],
      electedOfficials: [
        {
          _id: oid(),
          countryId: "DE",
          officeType: "bundestag",
          state: "BW",
          party: "2",
          seatsHeld: 18,
          characterId: oid(),
          characterName: "CDU Rep BW",
          createdAt: now,
          updatedAt: now,
        },
        {
          _id: oid(),
          countryId: "DE",
          officeType: "bundestag",
          state: "BW",
          party: "1",
          seatsHeld: 12,
          characterId: oid(),
          characterName: "SPD Rep BW",
          createdAt: now,
          updatedAt: now,
        },
        {
          _id: oid(),
          countryId: "DE",
          officeType: "bundestag",
          state: "BY",
          party: "2",
          seatsHeld: 40,
          characterId: oid(),
          characterName: "CDU Rep BY",
          createdAt: now,
          updatedAt: now,
        },
      ],
      characters: [],
      landeslisten: [],
    });

    const result = await maybeReconcileBundestag(db, 1, now);
    expect(result).not.toBeNull();

    const listOfficials = (await db
      .collection("electedOfficials")
      .find({ countryId: "DE", officeType: "bundestag", seatSource: "list" })
      .toArray()) as unknown as ElectedOfficial[];
    const listSeats = listOfficials.reduce((s, o) => s + (o.seatsHeld ?? 0), 0);
    const directSeats = 18 + 12 + 40;
    expect(directSeats + listSeats).toBe(487);
    expect(directSeats + listSeats).not.toBe(630);
  });

  it("returns null while constituencies are still pending", async () => {
    const db = makeFakeDb({
      gameState: [{ _id: "current", currentTurn: 5 }],
      elections: [
        {
          _id: oid(),
          countryId: "DE",
          electionType: "bundestag",
          cycle: 2,
          status: "active",
          state: "BW",
        },
      ],
    });
    expect(await maybeReconcileBundestag(db, 2, new Date())).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// persistBundestagResult: concurrency safety (issue #2957)
// ─────────────────────────────────────────────────────────────────────────────

describe("persistBundestagResult (duplicate-key tolerance)", () => {
  function resultWithOneBloc(): BundestagElectionResult {
    const listOfficials: BundestagElectionResult["listOfficials"] = [
      {
        countryId: "DE",
        officeType: "bundestag",
        state: "BW",
        party: "2",
        seatsHeld: 10,
        seatSource: "list",
        characterId: oid(),
        characterName: "CDU Rep BW",
        isNPP: false,
        isAppointment: false,
        electedAt: new Date(),
      },
    ];
    return {
      cycle: 1,
      direct: { byParty: {}, byPartyLand: {}, repByPartyLand: {}, partyRep: {}, totalDirect: 0 },
      zweitstimmen: { national: {}, perLand: {} },
      federalAllocation: { partySeats: {}, totalAllocated: 0 },
      landAllocations: [],
      listOfficials,
    };
  }

  /** Minimal collection stub whose insertMany throws a chosen error. */
  function dbThrowingOnInsert(err: unknown) {
    let deleteCalled = false;
    let insertCalled = false;
    const db = {
      collection: () => ({
        deleteMany: async () => {
          deleteCalled = true;
          return { deletedCount: 0 };
        },
        insertMany: async () => {
          insertCalled = true;
          throw err;
        },
      }),
    } as unknown as import("mongodb").Db;
    return { db, called: () => ({ deleteCalled, insertCalled }) };
  }

  it("swallows a duplicate-key error from a concurrent racer (E11000)", async () => {
    const e11000 = Object.assign(new Error("E11000 duplicate key"), { code: 11000 });
    const { db, called } = dbThrowingOnInsert(e11000);
    await expect(persistBundestagResult(db, resultWithOneBloc())).resolves.toBeUndefined();
    expect(called().insertCalled).toBe(true);
  });

  it("swallows a bulk-write duplicate-key error (writeErrors all 11000)", async () => {
    const bulkErr = Object.assign(new Error("bulk write error"), {
      writeErrors: [{ code: 11000 }],
    });
    const { db } = dbThrowingOnInsert(bulkErr);
    await expect(persistBundestagResult(db, resultWithOneBloc())).resolves.toBeUndefined();
  });

  it("rethrows any non-duplicate insert error", async () => {
    const other = Object.assign(new Error("disk full"), { code: 14031 });
    const { db } = dbThrowingOnInsert(other);
    await expect(persistBundestagResult(db, resultWithOneBloc())).rejects.toThrow("disk full");
  });
});
