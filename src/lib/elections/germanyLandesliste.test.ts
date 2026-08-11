import { describe, it, expect } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import type { Character, Landesliste } from "@/lib/db/types";
import {
  autoGenerateLandesliste,
  reorderLandesliste,
  lockLandesliste,
  getLandesliste,
  generateLandeslistenForCycle,
} from "./germanyLandesliste";

// ─────────────────────────────────────────────────────────────────────────────
// Lightweight in-memory Mongo-like stub — just enough to test Landesliste logic
// without booting mongodb-memory-server.
// ─────────────────────────────────────────────────────────────────────────────

type Doc = Record<string, unknown>;

function matches(doc: Doc, query: Doc): boolean {
  for (const [key, val] of Object.entries(query)) {
    if (val && typeof val === "object" && "$in" in val) {
      const arr = (val as { $in: unknown[] }).$in;
      const docVal = doc[key];
      const hit = arr.some((v) => {
        if (v instanceof ObjectId && docVal instanceof ObjectId) return v.equals(docVal);
        return v === docVal;
      });
      if (!hit) return false;
    } else if (val instanceof ObjectId && doc[key] instanceof ObjectId) {
      if (!val.equals(doc[key] as ObjectId)) return false;
    } else if (doc[key] !== val) {
      return false;
    }
  }
  return true;
}

function makeFakeDb(seed: { characters?: Character[]; landeslisten?: Landesliste[] }): Db {
  const collections: Record<string, Doc[]> = {
    characters: (seed.characters ?? []).map((c) => ({ ...c })),
    landeslisten: (seed.landeslisten ?? []).map((l) => ({ ...l })),
  };

  const makeCollection = (name: string) => {
    const docs = () => (collections[name] ??= []);
    return {
      find: (query: Doc = {}, _opts?: unknown) => ({
        toArray: async () => docs().filter((d) => matches(d, query)),
      }),
      findOne: async (query: Doc = {}) => {
        return docs().find((d) => matches(d, query)) ?? null;
      },
      insertOne: async (doc: Doc) => {
        docs().push(doc);
        return { insertedId: doc._id };
      },
      updateOne: async (query: Doc, update: { $set?: Doc }) => {
        const d = docs().find((d) => matches(d, query));
        if (!d) return { matchedCount: 0, modifiedCount: 0 };
        Object.assign(d, update.$set ?? {});
        return { matchedCount: 1, modifiedCount: 1 };
      },
    };
  };

  return {
    collection: (name: string) => makeCollection(name),
  } as unknown as Db;
}

function mkChar(params: {
  _id?: ObjectId;
  party: string;
  homeState: string;
  nationalInfluence?: number;
}): Character {
  return {
    _id: params._id ?? new ObjectId(),
    userId: new ObjectId(),
    countryId: "DE",
    name: "Test",
    homeState: params.homeState,
    party: params.party,
    politicalInfluence: 0,
    nationalInfluence: params.nationalInfluence,
    favorability: 50,
    infamy: 0,
    funds: 0,
    actions: 0,
    donorBaseLevel: 0,
    policies: {} as never,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as unknown as Character;
}

describe("generateLandeslistenForCycle", () => {
  it("creates one list per (party, Land) that has resident members", async () => {
    const db = makeFakeDb({
      characters: [
        mkChar({ party: "2", homeState: "BW", nationalInfluence: 10 }),
        mkChar({ party: "2", homeState: "BY", nationalInfluence: 5 }),
        mkChar({ party: "1", homeState: "BW", nationalInfluence: 8 }),
      ],
    });

    await generateLandeslistenForCycle(db, 3);

    const lists = await db
      .collection<Landesliste>("landeslisten")
      .find({ countryId: "DE", cycle: 3 })
      .toArray();
    expect(lists).toHaveLength(3);
    const keys = lists.map((l) => `${l.partyId}:${l.landId}`).sort();
    expect(keys).toEqual(["1:BW", "2:BW", "2:BY"]);
  });

  it("is idempotent and preserves an existing locked list", async () => {
    const existingCand = new ObjectId();
    const db = makeFakeDb({
      characters: [mkChar({ party: "2", homeState: "BW", nationalInfluence: 10 })],
      landeslisten: [
        {
          _id: new ObjectId(),
          countryId: "DE",
          partyId: "2",
          landId: "BW",
          cycle: 3,
          candidates: [existingCand],
          lockedAt: new Date(),
          createdAt: new Date(),
          updatedAt: new Date(),
        } as Landesliste,
      ],
    });

    await generateLandeslistenForCycle(db, 3);

    const lists = await db
      .collection<Landesliste>("landeslisten")
      .find({ countryId: "DE", cycle: 3 })
      .toArray();
    expect(lists).toHaveLength(1);
    expect(lists[0].candidates[0].equals(existingCand)).toBe(true); // locked list untouched
  });
});

describe("autoGenerateLandesliste", () => {
  it("orders candidates by nationalInfluence descending", async () => {
    const topCharId = new ObjectId();
    const midCharId = new ObjectId();
    const bottomCharId = new ObjectId();

    const db = makeFakeDb({
      characters: [
        mkChar({ _id: midCharId, party: "spd", homeState: "BW", nationalInfluence: 50 }),
        mkChar({ _id: topCharId, party: "spd", homeState: "BW", nationalInfluence: 100 }),
        mkChar({ _id: bottomCharId, party: "spd", homeState: "BW", nationalInfluence: 10 }),
      ],
    });

    const list = await autoGenerateLandesliste(db, {
      partyId: "spd",
      landId: "BW",
      cycle: 1,
    });

    expect(list.candidates).toHaveLength(3);
    expect(list.candidates[0].equals(topCharId)).toBe(true);
    expect(list.candidates[1].equals(midCharId)).toBe(true);
    expect(list.candidates[2].equals(bottomCharId)).toBe(true);
  });

  it("excludes characters from other parties or other states", async () => {
    const spdBw = new ObjectId();
    const db = makeFakeDb({
      characters: [
        mkChar({ _id: spdBw, party: "spd", homeState: "BW", nationalInfluence: 100 }),
        mkChar({ party: "cdu", homeState: "BW", nationalInfluence: 999 }), // Wrong party
        mkChar({ party: "spd", homeState: "BY", nationalInfluence: 999 }), // Wrong Land
      ],
    });

    const list = await autoGenerateLandesliste(db, {
      partyId: "spd",
      landId: "BW",
      cycle: 1,
    });

    expect(list.candidates).toHaveLength(1);
    expect(list.candidates[0].equals(spdBw)).toBe(true);
  });

  it("is idempotent and preserves locked lists", async () => {
    const existingCandidate = new ObjectId();
    const newMember = new ObjectId();
    const lockedAt = new Date("2026-01-01");
    const existingList: Landesliste = {
      _id: new ObjectId(),
      countryId: "DE",
      partyId: "spd",
      landId: "BW",
      cycle: 1,
      candidates: [existingCandidate],
      lockedAt,
      createdAt: new Date("2025-12-01"),
      updatedAt: new Date("2025-12-01"),
    };

    const db = makeFakeDb({
      characters: [
        mkChar({ _id: newMember, party: "spd", homeState: "BW", nationalInfluence: 999 }),
      ],
      landeslisten: [existingList],
    });

    const list = await autoGenerateLandesliste(db, {
      partyId: "spd",
      landId: "BW",
      cycle: 1,
    });

    // Locked list is untouched despite a higher-NPI member existing
    expect(list.candidates).toHaveLength(1);
    expect(list.candidates[0].equals(existingCandidate)).toBe(true);
    expect(list.lockedAt).toEqual(lockedAt);
  });

  it("preserves an unlocked existing list when preserveExisting=true", async () => {
    const manuallyOrdered = [new ObjectId(), new ObjectId()];
    const existingList: Landesliste = {
      _id: new ObjectId(),
      countryId: "DE",
      partyId: "spd",
      landId: "BW",
      cycle: 1,
      candidates: manuallyOrdered,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const db = makeFakeDb({
      characters: [mkChar({ party: "spd", homeState: "BW", nationalInfluence: 999 })],
      landeslisten: [existingList],
    });

    const list = await autoGenerateLandesliste(db, {
      partyId: "spd",
      landId: "BW",
      cycle: 1,
      preserveExisting: true,
    });

    expect(list.candidates).toEqual(manuallyOrdered);
  });
});

describe("reorderLandesliste", () => {
  it("reorders an unlocked list when all candidates are valid party members", async () => {
    const a = new ObjectId();
    const b = new ObjectId();
    const c = new ObjectId();
    const chair = new ObjectId();
    const db = makeFakeDb({
      characters: [
        mkChar({ _id: a, party: "spd", homeState: "BW" }),
        mkChar({ _id: b, party: "spd", homeState: "BW" }),
        mkChar({ _id: c, party: "spd", homeState: "BW" }),
      ],
      landeslisten: [
        {
          _id: new ObjectId(),
          countryId: "DE",
          partyId: "spd",
          landId: "BW",
          cycle: 1,
          candidates: [a, b, c],
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
    });

    const updated = await reorderLandesliste(db, {
      partyId: "spd",
      landId: "BW",
      cycle: 1,
      candidates: [c, a, b],
      authoredBy: chair,
    });

    expect(updated.candidates[0].equals(c)).toBe(true);
    expect(updated.candidates[1].equals(a)).toBe(true);
    expect(updated.candidates[2].equals(b)).toBe(true);
    expect(updated.authoredBy?.equals(chair)).toBe(true);
  });

  it("rejects reorder when the list is locked", async () => {
    const a = new ObjectId();
    const db = makeFakeDb({
      characters: [mkChar({ _id: a, party: "spd", homeState: "BW" })],
      landeslisten: [
        {
          _id: new ObjectId(),
          countryId: "DE",
          partyId: "spd",
          landId: "BW",
          cycle: 1,
          candidates: [a],
          lockedAt: new Date(),
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
    });

    await expect(
      reorderLandesliste(db, {
        partyId: "spd",
        landId: "BW",
        cycle: 1,
        candidates: [a],
      })
    ).rejects.toThrow(/locked/i);
  });

  it("rejects reorder when a candidate isn't a party member in the Land", async () => {
    const validMember = new ObjectId();
    const outsider = new ObjectId();
    const db = makeFakeDb({
      characters: [
        mkChar({ _id: validMember, party: "spd", homeState: "BW" }),
        mkChar({ _id: outsider, party: "cdu", homeState: "BW" }), // Wrong party
      ],
      landeslisten: [
        {
          _id: new ObjectId(),
          countryId: "DE",
          partyId: "spd",
          landId: "BW",
          cycle: 1,
          candidates: [validMember],
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
    });

    await expect(
      reorderLandesliste(db, {
        partyId: "spd",
        landId: "BW",
        cycle: 1,
        candidates: [validMember, outsider],
      })
    ).rejects.toThrow(/not a spd member/i);
  });

  it("rejects duplicate candidates", async () => {
    const a = new ObjectId();
    const db = makeFakeDb({
      characters: [mkChar({ _id: a, party: "spd", homeState: "BW" })],
      landeslisten: [
        {
          _id: new ObjectId(),
          countryId: "DE",
          partyId: "spd",
          landId: "BW",
          cycle: 1,
          candidates: [a],
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
    });

    await expect(
      reorderLandesliste(db, {
        partyId: "spd",
        landId: "BW",
        cycle: 1,
        candidates: [a, a],
      })
    ).rejects.toThrow(/duplicate/i);
  });
});

describe("lockLandesliste + getLandesliste", () => {
  it("locks an existing list and getLandesliste returns it", async () => {
    const a = new ObjectId();
    const db = makeFakeDb({
      landeslisten: [
        {
          _id: new ObjectId(),
          countryId: "DE",
          partyId: "spd",
          landId: "BW",
          cycle: 1,
          candidates: [a],
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
    });

    await lockLandesliste(db, { partyId: "spd", landId: "BW", cycle: 1 });
    const fetched = await getLandesliste(db, { partyId: "spd", landId: "BW", cycle: 1 });
    expect(fetched?.lockedAt).toBeInstanceOf(Date);
  });

  it("getLandesliste returns null when no list exists", async () => {
    const db = makeFakeDb({});
    const fetched = await getLandesliste(db, { partyId: "cdu", landId: "BY", cycle: 2 });
    expect(fetched).toBeNull();
  });
});
