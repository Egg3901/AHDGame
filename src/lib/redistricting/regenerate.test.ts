import { describe, it, expect } from "vitest";
import type { Db } from "mongodb";
import { regenerateCongressionalDistricts } from "./regenerate";

function makeFakeDb(seed: Record<string, unknown[]>): {
  db: Db;
  store: Record<string, unknown[]>;
} {
  const store: Record<string, unknown[]> = {
    ...seed,
    congressionalDistricts: seed.congressionalDistricts ?? [],
  };
  const db = {
    collection(name: string) {
      store[name] = store[name] ?? [];
      const rows = store[name];
      return {
        find: (filter?: { _id?: { $in?: string[] } }) => ({
          toArray: async () =>
            filter?._id?.$in
              ? rows.filter((r) => filter._id!.$in!.includes((r as { _id: string })._id))
              : rows,
        }),
        async deleteMany(filter: { stateId?: { $in?: string[] } }) {
          const before = rows.length;
          store[name] = rows.filter(
            (r) => !filter.stateId?.$in?.includes((r as { stateId: string }).stateId)
          );
          return { deletedCount: before - store[name].length };
        },
        async insertOne(doc: unknown) {
          // Enforce _id uniqueness like Mongo, so a regression back to
          // insert-on-existing would throw here instead of silently passing.
          const id = (doc as { _id: string })._id;
          if (store[name].some((r) => (r as { _id: string })._id === id)) {
            throw new Error(`E11000 duplicate key error: ${id}`);
          }
          store[name].push(doc);
          return { acknowledged: true };
        },
        async updateOne(
          filter: { _id: string },
          update: { $set: Record<string, unknown> },
          options?: { upsert?: boolean }
        ) {
          const idx = store[name].findIndex((r) => (r as { _id: string })._id === filter._id);
          if (idx >= 0) {
            store[name][idx] = { ...update.$set, _id: filter._id };
            return { matchedCount: 1, upsertedCount: 0 };
          }
          if (options?.upsert) {
            store[name].push({ ...update.$set, _id: filter._id });
            return { matchedCount: 0, upsertedCount: 1 };
          }
          return { matchedCount: 0, upsertedCount: 0 };
        },
      };
    },
  } as unknown as Db;
  return { db, store };
}

describe("regenerateCongressionalDistricts", () => {
  it("deletes a state's old docs and rebuilds to its current houseDistricts", async () => {
    const { db, store } = makeFakeDb({
      states: [{ _id: "CA", countryId: "US", houseDistricts: 2 }],
      politicalParties: [
        { _id: "p1", sequentialId: 1, abbreviation: "DEM", economicPosition: -2 },
        { _id: "p2", sequentialId: 2, abbreviation: "GOP", economicPosition: 2 },
      ],
      statePartyOrg: [
        { _id: "CA_1", countryId: "US", stateId: "CA", partyId: "1", registration: 50 },
        { _id: "CA_2", countryId: "US", stateId: "CA", partyId: "2", registration: 30 },
      ],
      stateRegistrationPool: [],
      // Stale: 5 old districts (e.g. CA shrank from 5 → 2 seats).
      congressionalDistricts: [1, 2, 3, 4, 5].map((i) => ({
        _id: `US_CA_${i}`,
        countryId: "US",
        stateId: "CA",
        index: i,
      })),
    });

    const res = await regenerateCongressionalDistricts(db, {
      countryId: "US",
      stateIds: ["CA"],
      now: new Date("2026-01-01"),
    });

    expect(res.regenerated).toBe(2);
    const docs = store.congressionalDistricts as {
      stateId: string;
      index: number;
      lastRedrawnCensus: number | null;
    }[];
    expect(docs).toHaveLength(2); // orphans 3,4,5 gone
    expect(docs.map((d) => d.index).sort()).toEqual([1, 2]);
    expect(docs.every((d) => d.lastRedrawnCensus === null)).toBe(true); // neutral, redrawable
  });

  it("does not throw a duplicate-key error when a stale row survives the delete", async () => {
    // Simulate a row the delete can't match (countryId stored in a different case),
    // so it lingers with an _id a fresh build will reuse. Upsert must overwrite it
    // rather than insert-and-collide on the unique (countryId, stateId, index) index.
    const { db, store } = makeFakeDb({
      states: [{ _id: "NC", countryId: "US", houseDistricts: 3 }],
      politicalParties: [
        { _id: "p1", sequentialId: 1, abbreviation: "DEM", economicPosition: -2 },
        { _id: "p2", sequentialId: 2, abbreviation: "GOP", economicPosition: 2 },
      ],
      statePartyOrg: [
        { _id: "NC_1", countryId: "US", stateId: "NC", partyId: "1", organization: 40 },
        { _id: "NC_2", countryId: "US", stateId: "NC", partyId: "2", organization: 35 },
      ],
      stateRegistrationPool: [],
      congressionalDistricts: [{ _id: "US_NC_1", countryId: "US", stateId: "nc", index: 1 }],
    });

    const res = await regenerateCongressionalDistricts(db, {
      countryId: "US",
      stateIds: ["NC"],
      now: new Date("2026-01-01"),
    });

    expect(res.regenerated).toBe(3);
    const docs = store.congressionalDistricts as { _id: string }[];
    // The lingering US_NC_1 was overwritten, not duplicated.
    expect(docs.filter((d) => d._id === "US_NC_1")).toHaveLength(1);
    expect(docs).toHaveLength(3);
  });

  it("is a no-op for an empty state list", async () => {
    const { db } = makeFakeDb({ states: [] });
    const res = await regenerateCongressionalDistricts(db, {
      countryId: "US",
      stateIds: [],
      now: new Date(),
    });
    expect(res.regenerated).toBe(0);
  });
});
