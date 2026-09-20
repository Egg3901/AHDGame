import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { BUILD_ORG_BASE_PS_COST } from "@/lib/turn/politicalStrength/strengthConstants";
import { clearOrgBuildSizeCache } from "@/lib/politicalStrength/orgBuildStateSize";
import type { CountryId } from "@/lib/constants/countries";

vi.mock("@/lib/turn/partyOrg/presence", () => ({ checkPartyPresence: vi.fn() }));
vi.mock("@/lib/parties/commands/spendPoliticalStrength", () => ({
  spendPoliticalStrength: vi.fn(),
}));
vi.mock("@/lib/parties/commands/chargeOrgBuildFunds", () => ({
  chargeOrgBuildFunds: vi.fn(),
}));

const countryId = "US" as CountryId;
const STATES = ["CA", "TX"];
const PARTIES = [1, 2, 3];
// Party 3 is a default with a seated human chair; parties 1-2 are plain.
const CHAIR_ID = new ObjectId();
const CHAIR_USER_ID = new ObjectId();
const POPS: Record<string, number> = { CA: 39_000_000, TX: 30_000_000 };

function orgFor(state: string, party: number): number {
  // Saturated states: pool nearly empty so gain must come through poaches.
  if (party === 1) return 5;
  return state === "CA" ? 45 : 40;
}

interface Fixture {
  db: MockDb;
  actorNppId: ObjectId;
}

function seedDb(): Fixture {
  const db = createMockDb();
  const actorNppId = new ObjectId();

  const rows = STATES.flatMap((stateId) =>
    PARTIES.map((seq) => ({
      _id: `${stateId}_${seq}`,
      stateId,
      partyId: String(seq),
      countryId,
      organization: orgFor(stateId, seq),
      politicalStrength: 50,
      treasury: 10_000_000,
      hasPresence: true,
    }))
  );
  const rowsById = new Map(rows.map((r) => [r._id, r]));
  const spo = db.collection("statePartyOrg");
  spo.findOne.mockImplementation(async (filter: Record<string, unknown>) => {
    if (filter?._id) return rowsById.get(String(filter._id)) ?? null;
    return (
      rows.find(
        (r) =>
          (!filter?.countryId || r.countryId === filter.countryId) &&
          (!filter?.stateId || r.stateId === filter.stateId) &&
          (!filter?.partyId || r.partyId === filter.partyId)
      ) ?? null
    );
  });
  spo.find.mockImplementation(
    (filter: Record<string, unknown> = {}) =>
      ({
        toArray: async () =>
          rows.filter(
            (r) =>
              (!filter?.countryId || r.countryId === filter.countryId) &&
              (!filter?.stateId || r.stateId === filter.stateId)
          ),
      }) as never
  );

  const parties = PARTIES.map((seq) => ({
    _id: new ObjectId(),
    sequentialId: seq,
    countryId,
    name: `Party ${seq}`,
    politicalStrength: 40,
    isDefault: seq === 3,
    chairId: seq === 3 ? CHAIR_ID : null,
  }));
  function matchCountry(p: (typeof parties)[number], country: unknown): boolean {
    if (country === undefined) return true;
    if (typeof country === "object" && country !== null && "$in" in country) {
      return (country as { $in: unknown[] }).$in.includes(p.countryId);
    }
    return p.countryId === country;
  }
  const pp = db.collection("politicalParties");
  pp.findOne.mockImplementation(
    async (filter: Record<string, unknown>) =>
      parties.find(
        (p) =>
          matchCountry(p, filter?.countryId) &&
          (filter?.sequentialId === undefined || p.sequentialId === filter.sequentialId)
      ) ?? null
  );
  pp.find.mockImplementation(
    (filter: Record<string, unknown> = {}) =>
      ({
        toArray: async () => {
          const inList = (filter?.sequentialId as { $in?: number[] } | undefined)?.$in;
          return parties.filter(
            (p) =>
              matchCountry(p, filter?.countryId) && (!inList || inList.includes(p.sequentialId))
          );
        },
      }) as never
  );

  const chairDoc = { _id: CHAIR_ID, userId: CHAIR_USER_ID };
  const userDoc = { _id: CHAIR_USER_ID };
  db.collection("characters").findOne.mockResolvedValue(chairDoc);
  db.collection("users").findOne.mockResolvedValue(userDoc);
  db.collection("characters").find.mockImplementation(
    (filter: Record<string, unknown> = {}) =>
      ({
        toArray: async () => {
          const inList = (filter?._id as { $in?: unknown[] } | undefined)?.$in?.map(String);
          return inList && !inList.includes(String(CHAIR_ID)) ? [] : [chairDoc];
        },
      }) as never
  );
  db.collection("users").find.mockImplementation(
    (filter: Record<string, unknown> = {}) =>
      ({
        toArray: async () => {
          const inList = (filter?._id as { $in?: unknown[] } | undefined)?.$in?.map(String);
          const bannedOk = (filter as { isBanned?: unknown }).isBanned !== undefined;
          return inList && !inList.includes(String(CHAIR_USER_ID)) ? [] : bannedOk ? [userDoc] : [];
        },
      }) as never
  );
  db.collection("partyStrengthPressure").findOne.mockResolvedValue({ value: 0 });

  const states = db.collection("states");
  states.find.mockImplementation(
    () =>
      ({
        toArray: async () =>
          Object.entries(POPS).map(([id, population]) => ({ _id: id, countryId, population })),
      }) as never
  );
  states.findOne.mockImplementation(async (filter: Record<string, unknown>) =>
    filter?._id && POPS[String(filter._id)] != null
      ? { _id: String(filter._id), countryId, population: POPS[String(filter._id)] }
      : null
  );

  return { db, actorNppId };
}

async function mocks() {
  const { checkPartyPresence } = await import("@/lib/turn/partyOrg/presence");
  const { spendPoliticalStrength } = await import("@/lib/parties/commands/spendPoliticalStrength");
  const { chargeOrgBuildFunds } = await import("@/lib/parties/commands/chargeOrgBuildFunds");
  return {
    checkPartyPresence: vi.mocked(checkPartyPresence),
    spendPoliticalStrength: vi.mocked(spendPoliticalStrength),
    chargeOrgBuildFunds: vi.mocked(chargeOrgBuildFunds),
  };
}

function mockSuccess(m: Awaited<ReturnType<typeof mocks>>) {
  m.checkPartyPresence.mockResolvedValue(true);
  m.spendPoliticalStrength.mockResolvedValue({
    ok: true,
    effectiveCost: BUILD_ORG_BASE_PS_COST,
    newPoliticalStrength: 50 - BUILD_ORG_BASE_PS_COST,
    newPressure: 1,
  });
  m.chargeOrgBuildFunds.mockImplementation(async (input) => ({ charged: input.amount }));
}

function counts(db: MockDb, collection: string, method: string): number {
  const col = db.collectionMocks[collection];
  const fn = col?.[method as keyof typeof col] as unknown as { mock: { calls: unknown[] } };
  return fn?.mock?.calls?.length ?? 0;
}

/** Strip volatile fields so two runs' effects can be compared exactly. */
function ledgerSignature(db: MockDb): unknown[] {
  const many = db.collectionMocks["orgRegLedger"]!.insertMany.mock.calls as unknown[][];
  const one = db.collectionMocks["orgRegLedger"]!.insertOne.mock.calls as unknown[][];
  const docs = [...one.map((c) => c[0]), ...many.flatMap((c) => c[0] as unknown[])] as Record<
    string,
    unknown
  >[];
  return docs.map(({ _id, createdAt, actorId, ...rest }) => rest);
}

describe("nppBuildPartyOrg command profile", { timeout: 60000 }, () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearOrgBuildSizeCache();
  });

  it("fires poaches in the fixture (precondition for the batching tests)", async () => {
    const { db, actorNppId } = seedDb();
    mockSuccess(await mocks());
    const { nppBuildPartyOrg } = await import("./nppBuildOrg");
    const result = await nppBuildPartyOrg(db as unknown as Db, actorNppId, countryId, "CA", 1, 100);
    expect(result.ok).toBe(true);
    const sig = ledgerSignature(db);
    const poaches = sig.filter((d) => (d as { source: string }).source === "poach");
    expect(poaches.length).toBeGreaterThan(0);
    console.log(
      `MEASURE ledgerDocs=${sig.length} insertOne=${counts(db, "orgRegLedger", "insertOne")} insertMany=${counts(db, "orgRegLedger", "insertMany")}`
    );
  });

  it("pins the uncached sweep read profile (6 actions, 2 states x 3 parties)", async () => {
    const { db, actorNppId } = seedDb();
    mockSuccess(await mocks());
    const { nppBuildPartyOrg } = await import("./nppBuildOrg");
    for (const state of STATES) {
      for (const party of PARTIES) {
        await nppBuildPartyOrg(db as unknown as Db, actorNppId, countryId, state, party, 100);
      }
    }
    const profile = {
      partiesFindOne: counts(db, "politicalParties", "findOne"),
      partiesFind: counts(db, "politicalParties", "find"),
      charactersFindOne: counts(db, "characters", "findOne"),
      usersFindOne: counts(db, "users", "findOne"),
      statesFind: counts(db, "states", "find"),
      statesFindOne: counts(db, "states", "findOne"),
      pressureFindOne: counts(db, "partyStrengthPressure", "findOne"),
      ledgerInsertOne: counts(db, "orgRegLedger", "insertOne"),
      ledgerInsertMany: counts(db, "orgRegLedger", "insertMany"),
    };
    console.log(`MEASURE-UNCACHED sweep ${JSON.stringify(profile)}`);
    expect(profile.partiesFindOne).toBe(6);
  });

  it("batches ledger receipts into one insertMany with identical effects", async () => {
    const { db, actorNppId } = seedDb();
    mockSuccess(await mocks());
    const { nppBuildPartyOrg } = await import("./nppBuildOrg");
    const result = await nppBuildPartyOrg(db as unknown as Db, actorNppId, countryId, "CA", 1, 100);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");

    expect(counts(db, "orgRegLedger", "insertOne")).toBe(0);
    const batches = db.collectionMocks["orgRegLedger"]!.insertMany.mock.calls as unknown[][];
    expect(batches).toHaveLength(1);
    const docs = batches[0][0] as Record<string, unknown>[];
    // Same poaches-then-own order the old per-write inserts used.
    expect(docs.length).toBeGreaterThan(1);
    expect(docs.slice(0, -1).every((d) => d.source === "poach")).toBe(true);
    expect(docs[docs.length - 1]!.source).toBe("action");
    const own = docs.find((d) => d.source === "action")!;
    expect(own.delta).toBe(result.orgGain);
    expect(own.value).toBe(result.newOrg);
    const poachLoss = docs
      .filter((d) => d.source === "poach")
      .reduce((s, d) => s + (d.delta as number), 0);
    expect((own.delta as number) + poachLoss).toBeGreaterThan(0);
    console.log(`MEASURE-AFTER ledgerDocs=${docs.length} insertOne=0 insertMany=1`);
  });

  it("cached sweep matches uncached effects exactly with fewer commands", async () => {
    const m = await mocks();
    const { nppBuildPartyOrg, preloadNppBuildOrgSweepCache } = await import("./nppBuildOrg");

    async function runSweep(useCache: boolean) {
      const { db, actorNppId } = seedDb();
      mockSuccess(m);
      // Count everything from the preload onward: the preload is sweep cost.
      vi.clearAllMocks();
      mockSuccess(m);
      const cache = useCache
        ? await preloadNppBuildOrgSweepCache(db as unknown as Db, [countryId])
        : undefined;
      const results = [];
      for (const state of STATES) {
        for (const party of PARTIES) {
          results.push(
            await nppBuildPartyOrg(
              db as unknown as Db,
              actorNppId,
              countryId,
              state,
              party,
              100,
              cache
            )
          );
        }
      }
      const profile = {
        partiesFindOne: counts(db, "politicalParties", "findOne"),
        partiesFind: counts(db, "politicalParties", "find"),
        characters: counts(db, "characters", "findOne") + counts(db, "characters", "find"),
        users: counts(db, "users", "findOne") + counts(db, "users", "find"),
        statesFind: counts(db, "states", "find"),
        statesFindOne: counts(db, "states", "findOne"),
        pressureFindOne: counts(db, "partyStrengthPressure", "findOne"),
        ledgerInsertOne: counts(db, "orgRegLedger", "insertOne"),
        ledgerInsertMany: counts(db, "orgRegLedger", "insertMany"),
      };
      return { results, sig: ledgerSignature(db), profile };
    }

    const plain = await runSweep(false);
    clearOrgBuildSizeCache();
    const cached = await runSweep(true);

    expect(cached.results).toEqual(plain.results);
    expect(cached.sig).toEqual(plain.sig);
    // Mutable gates stay live per action in both modes.
    expect(cached.profile.pressureFindOne).toBe(plain.profile.pressureFindOne);
    // Immutable lookups collapse to the preload.
    expect(cached.profile.partiesFindOne).toBe(0);
    expect(cached.profile.statesFindOne).toBe(0);
    expect(cached.profile.ledgerInsertOne).toBe(0);
    const total = (p: typeof plain.profile) =>
      p.partiesFindOne +
      p.partiesFind +
      p.characters +
      p.users +
      p.statesFind +
      p.statesFindOne +
      p.pressureFindOne +
      p.ledgerInsertOne +
      p.ledgerInsertMany;
    expect(total(cached.profile)).toBeLessThan(total(plain.profile));
    console.log(
      `MEASURE-AFTER sweep ${JSON.stringify(cached.profile)} total ${total(cached.profile)} < ${total(plain.profile)}`
    );
  });

  it("flushes completed receipts when a rival write fails mid-poach", async () => {
    const m = await mocks();
    const { nppBuildPartyOrg } = await import("./nppBuildOrg");
    for (const useCache of [false, true]) {
      const { db, actorNppId } = seedDb();
      mockSuccess(m);
      const cache = useCache
        ? await import("./nppBuildOrg").then((mod) =>
            mod.preloadNppBuildOrgSweepCache(db as unknown as Db, [countryId])
          )
        : undefined;
      let calls = 0;
      db.collectionMocks["statePartyOrg"]!.updateOne.mockImplementation(async () => {
        calls += 1;
        // Own update (1st) plus first poach (2nd) succeed; 2nd poach throws.
        if (calls === 3) throw new Error("boom");
        return { modifiedCount: 1, matchedCount: 1 };
      });
      await expect(
        nppBuildPartyOrg(db as unknown as Db, actorNppId, countryId, "CA", 1, 100, cache)
      ).rejects.toThrow("boom");
      // The one completed poach receipt still persists, via a single flush.
      expect(counts(db, "orgRegLedger", "insertOne")).toBe(0);
      const batches = db.collectionMocks["orgRegLedger"]!.insertMany.mock.calls as unknown[][];
      expect(batches).toHaveLength(1);
      expect(batches[0][0] as unknown[]).toHaveLength(1);
    }
  });

  it("writes no receipts when the PS spend fails, cached or not", async () => {
    const m = await mocks();
    const { nppBuildPartyOrg, preloadNppBuildOrgSweepCache } = await import("./nppBuildOrg");
    for (const useCache of [false, true]) {
      const { db, actorNppId } = seedDb();
      mockSuccess(m);
      m.spendPoliticalStrength.mockResolvedValue({
        ok: false,
        reason: "insufficient-ps",
        effectiveCost: BUILD_ORG_BASE_PS_COST,
        currentPoliticalStrength: 0,
      });
      const cache = useCache
        ? await preloadNppBuildOrgSweepCache(db as unknown as Db, [countryId])
        : undefined;
      const result = await nppBuildPartyOrg(
        db as unknown as Db,
        actorNppId,
        countryId,
        "CA",
        1,
        100,
        cache
      );
      expect(result).toEqual({ ok: false, reason: "Insufficient PS." });
      expect(counts(db, "orgRegLedger", "insertOne")).toBe(0);
      expect(counts(db, "orgRegLedger", "insertMany")).toBe(0);
      expect(counts(db, "statePartyOrg", "updateOne")).toBe(0);
    }
  });

  it("falls back to live reads on cache miss with identical results", async () => {
    const m = await mocks();
    const { nppBuildPartyOrg, preloadNppBuildOrgSweepCache } = await import("./nppBuildOrg");
    const first = seedDb();
    mockSuccess(m);
    const plainResult = await nppBuildPartyOrg(
      first.db as unknown as Db,
      first.actorNppId,
      countryId,
      "CA",
      1,
      100
    );
    const second = seedDb();
    mockSuccess(m);
    // Empty-scope preload: every lookup misses and falls back to live reads.
    const emptyCache = await preloadNppBuildOrgSweepCache(second.db as unknown as Db, []);
    const fallbackResult = await nppBuildPartyOrg(
      second.db as unknown as Db,
      second.actorNppId,
      countryId,
      "CA",
      1,
      100,
      emptyCache
    );
    expect(fallbackResult).toEqual(plainResult);
    expect(ledgerSignature(second.db)).toEqual(ledgerSignature(first.db));

    // Unknown party short-circuits identically in both modes.
    mockSuccess(m);
    const missing = await nppBuildPartyOrg(
      second.db as unknown as Db,
      second.actorNppId,
      countryId,
      "CA",
      99,
      100,
      emptyCache
    );
    expect(missing).toEqual({ ok: false, reason: "Party not found." });
  });
});
