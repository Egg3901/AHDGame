import { ObjectId, type Db } from "mongodb";
import { describe, expect, it, vi } from "vitest";
import { reconcileUKDevolution } from "./service";
import { initialUKDevolutionState, type UKDevolutionState } from "./rules";

function fixture(stored: UKDevolutionState | null, policy: object | null, legacyRegion?: string) {
  const writes: Array<{ collection: string; filter: unknown; update: unknown }> = [];
  const characterId = new ObjectId();
  const nppId = new ObjectId();
  const db = {
    collection: (name: string) => ({
      findOne: vi.fn(async () =>
        name === "ukDevolution" ? stored : name === "statePolicies" ? policy : null
      ),
      find: () => ({
        toArray: async () =>
          name === "electedOfficials" ? [{ characterId, nppId, state: legacyRegion }] : [],
      }),
      updateMany: async (filter: unknown, update: unknown) => {
        writes.push({ collection: name, filter, update });
      },
      updateOne: async (filter: unknown, update: unknown) => {
        writes.push({ collection: name, filter, update });
      },
    }),
  } as unknown as Db;
  return { db, writes, characterId, nppId };
}

describe("UK devolution reconciliation", () => {
  it("preserves already seated leaders as an alternate-history institution", async () => {
    const { db, writes } = fixture(null, null, "SCO");
    const state = await reconcileUKDevolution(db, 1991, [], new Date());
    expect(state.regions.SCO.active).toBe(true);
    expect(state.regions.WAL.active).toBe(false);
    const cleanup = writes.find((w) => w.collection === "electedOfficials");
    expect(cleanup?.filter).toMatchObject({ state: { $in: ["WAL", "NIR", "LON"] } });
  });

  it("ignores seeded policy preferences as authority to found an office", async () => {
    const state = initialUKDevolutionState(1991);
    const { db, writes } = fixture(state, { policyOptionIndex: 3, enactedTurn: 1 });
    expect(await reconcileUKDevolution(db, 1991, [], new Date())).toBe(state);
    expect(writes).toEqual([]);
  });

  it("founds offices only from an enacted parliamentary bill", async () => {
    const bill = new ObjectId();
    const { db, writes } = fixture(initialUKDevolutionState(1991), {
      policyOptionIndex: 3,
      enactedTurn: 100,
      enactedBy: { kind: "bill", id: bill },
    });
    const state = await reconcileUKDevolution(db, 1991, [{ state: "SCO", cycle: 2 }], new Date());
    expect(state.lastPolicyBillId).toBe(String(bill));
    expect(state.regions.SCO.active).toBe(true);
    expect(state.regions.SCO.firstCycle).toBe(3);
    expect(writes.map((w) => w.collection)).toEqual(["ukDevolution"]);
  });

  it("does not allow an executive order to create the settlement", async () => {
    const state = initialUKDevolutionState(1991);
    const { db, writes } = fixture(state, {
      policyOptionIndex: 3,
      enactedTurn: 100,
      enactedBy: { kind: "order", id: new ObjectId() },
    });
    expect(await reconcileUKDevolution(db, 1991, [], new Date())).toBe(state);
    expect(writes).toEqual([]);
  });

  it("abolishes executive access and unfinished races while retaining historical records", async () => {
    const { db, writes, characterId, nppId } = fixture(initialUKDevolutionState(2019), {
      policyOptionIndex: 6,
      enactedTurn: 100,
      enactedByBillId: new ObjectId(),
    });
    const state = await reconcileUKDevolution(db, 2019, [], new Date());
    expect(Object.values(state.regions).every((r) => !r.active)).toBe(true);
    expect(writes.find((w) => w.collection === "elections")?.filter).toMatchObject({
      countryId: "UK",
      status: { $in: ["active", "upcoming"] },
    });
    expect(writes.find((w) => w.collection === "characters")?.filter).toEqual({
      _id: { $in: [characterId] },
      currentOffice: "governor",
    });
    expect(writes.find((w) => w.collection === "npps")?.filter).toEqual({
      _id: { $in: [nppId] },
      currentOffice: "governor",
    });
    expect(writes.at(-1)?.collection).toBe("ukDevolution");
  });
});
