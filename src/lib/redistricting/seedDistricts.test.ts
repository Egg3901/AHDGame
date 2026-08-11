import { describe, it, expect } from "vitest";
import type { Db } from "mongodb";
import { seedCongressionalDistricts } from "./seedDistricts";

/** Minimal in-memory fake of the Mongo surface this seeder uses. */
function makeFakeDb(seed: Record<string, unknown[]>): { db: Db; store: Record<string, unknown[]> } {
  const store: Record<string, unknown[]> = { ...seed, congressionalDistricts: [] };
  const db = {
    collection(name: string) {
      store[name] = store[name] ?? [];
      const rows = store[name];
      const upsertOne = (filter: { _id: string }, update: { $set: Record<string, unknown> }) => {
        const idx = rows.findIndex((r) => (r as { _id: string })._id === filter._id);
        const doc = { ...(update.$set as object), _id: filter._id };
        if (idx >= 0) rows[idx] = doc;
        else rows.push(doc);
      };
      return {
        find: () => ({ toArray: async () => rows }),
        async updateOne(filter: { _id: string }, update: { $set: Record<string, unknown> }) {
          upsertOne(filter, update);
          return { acknowledged: true };
        },
        // Storage fake: applying the ops in order is exactly what an ordered
        // bulkWrite does, so the idempotency assertion still means what it did.
        async bulkWrite(
          ops: Array<{
            updateOne: { filter: { _id: string }; update: { $set: Record<string, unknown> } };
          }>
        ) {
          for (const op of ops) upsertOne(op.updateOne.filter, op.updateOne.update);
          return { acknowledged: true, upsertedCount: 0, modifiedCount: ops.length };
        },
        async createIndex() {
          return "idx";
        },
      };
    },
  } as unknown as Db;
  return { db, store };
}

describe("seedCongressionalDistricts", () => {
  it("seeds one doc per house district, conserving squares per state", async () => {
    // MULTIPARTY fixture: sequentialId 1=DEM(left), 2=GOP(right), 7=Green(left).
    // partyId on statePartyOrg = String(sequentialId), matching reality.
    const { db, store } = makeFakeDb({
      states: [
        { _id: "CA", countryId: "US", houseDistricts: 4 },
        { _id: "WY", countryId: "US", houseDistricts: 1 },
      ],
      politicalParties: [
        { _id: "p1", sequentialId: 1, abbreviation: "DEM", countryId: "US", economicPosition: -2 },
        { _id: "p2", sequentialId: 2, abbreviation: "GOP", countryId: "US", economicPosition: 2 },
        { _id: "p7", sequentialId: 7, abbreviation: "GRN", countryId: "US", economicPosition: -4 },
      ],
      statePartyOrg: [
        { _id: "CA_1", countryId: "US", stateId: "CA", partyId: "1", registration: 40 },
        { _id: "CA_7", countryId: "US", stateId: "CA", partyId: "7", registration: 10 }, // Green → left
        { _id: "CA_2", countryId: "US", stateId: "CA", partyId: "2", registration: 30 },
        { _id: "WY_1", countryId: "US", stateId: "WY", partyId: "1", registration: 26 },
        { _id: "WY_2", countryId: "US", stateId: "WY", partyId: "2", registration: 62 },
      ],
      stateRegistrationPool: [
        { _id: "US_CA", countryId: "US", stateId: "CA", independent: 16, unregistered: 4 },
      ],
    });

    const result = await seedCongressionalDistricts(db, { now: new Date("2026-01-01") });

    expect(result.seeded).toBe(5); // 4 CA + 1 WY
    const docs = store.congressionalDistricts as {
      _id: string;
      stateId: string;
      squares: { left: number; right: number; grey: number };
    }[];
    const ca = docs.filter((d) => d.stateId === "CA");
    expect(ca).toHaveLength(4);
    const sumLeft = ca.reduce((a, d) => a + d.squares.left, 0);
    const sumRight = ca.reduce((a, d) => a + d.squares.right, 0);
    const sumGrey = ca.reduce((a, d) => a + d.squares.grey, 0);
    // CA pools: left = DEM 40 + Green 10 = 50, right = GOP 30, grey = ind 16 + unreg 4 = 20.
    // Of 64 squares → 32 / 19 / 13 (rounded, conserved). Green proves multiparty pooling.
    expect(sumLeft + sumRight + sumGrey).toBe(64);
    expect(sumLeft).toBe(32);
    expect(sumRight).toBe(19);
    ca.forEach((d) => expect(d.squares.left + d.squares.right + d.squares.grey).toBe(16));
  });

  it("is idempotent — re-running does not duplicate docs", async () => {
    const { db, store } = makeFakeDb({
      states: [{ _id: "WY", countryId: "US", houseDistricts: 1 }],
      politicalParties: [
        { _id: "p1", sequentialId: 1, abbreviation: "DEM", countryId: "US", economicPosition: -2 },
        { _id: "p2", sequentialId: 2, abbreviation: "GOP", countryId: "US", economicPosition: 2 },
      ],
      statePartyOrg: [
        { _id: "WY_2", countryId: "US", stateId: "WY", partyId: "2", registration: 62 },
      ],
      stateRegistrationPool: [],
    });
    await seedCongressionalDistricts(db, { now: new Date("2026-01-01") });
    await seedCongressionalDistricts(db, { now: new Date("2026-01-02") });
    expect((store.congressionalDistricts as unknown[]).length).toBe(1);
  });
});
