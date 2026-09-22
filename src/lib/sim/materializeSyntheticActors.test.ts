import { describe, expect, it } from "vitest";
import { ObjectId, type Db } from "mongodb";
import type { CentralBank } from "@/lib/db/types/centralBank";
import { COUNTRY_CONFIGS } from "@/lib/constants/countries";
import { CEO_INITIAL_SHARES } from "@/lib/constants/corporations";
import {
  SIM_SANDBOX_DB_PREFIX,
  assertSandboxDb,
  materializeSyntheticActors,
  readActorPopulation,
  syntheticCorporateSequentialId,
  syntheticTicker,
} from "./materializeSyntheticActors";
import { SYNTHETIC_ACTOR_ROLES } from "./actorCoverage";
import { SIM_ACTOR_USERNAME_PREFIX, buildSyntheticActorPlan } from "./syntheticActors";
import {
  IPO_PROBE_FLOAT_PCT,
  IPO_PROBE_PRICE_PER_SHARE,
  PRIVATE_PROBE_FOUNDING_CAPITAL,
  probeFedChair1953,
} from "./actorProbes";
import { computeIpoIssuance } from "@/lib/corporations/ipoIssuance";

/* Minimal in-memory Db stub: enough of the driver surface for the seeder and
 * the population reader (bulkWrite upserts, countDocuments with the exact
 * filter shapes those functions use, find+toArray, findOne). */

type Doc = Record<string, unknown>;

function idKey(id: unknown): string {
  return id instanceof ObjectId ? id.toHexString() : String(id);
}

function objectIdsEqual(a: unknown, b: unknown): boolean {
  if (a instanceof ObjectId && b instanceof ObjectId) return a.equals(b);
  return a === b;
}

function matches(doc: Doc, filter: Record<string, any>): boolean {
  for (const [key, cond] of Object.entries(filter)) {
    const value = doc[key];
    if (cond !== null && typeof cond === "object" && !(cond instanceof ObjectId)) {
      if ("$regex" in cond) {
        if (typeof value !== "string" || !new RegExp(cond.$regex as string).test(value)) {
          return false;
        }
        continue;
      }
      if ("$in" in cond) {
        const list = cond.$in as unknown[];
        if (Array.isArray(value)) {
          if (!value.some((v) => list.some((item) => objectIdsEqual(v, item)))) return false;
        } else if (!list.some((item) => objectIdsEqual(value, item))) {
          return false;
        }
        continue;
      }
      if ("$exists" in cond || "$ne" in cond) {
        const exists = value !== undefined;
        if ("$exists" in cond && Boolean(cond.$exists) !== exists) return false;
        if ("$ne" in cond) {
          const banned = cond.$ne as unknown;
          if (Array.isArray(banned) && Array.isArray(value)) {
            if (value.length !== (banned as unknown[]).length) continue;
            return false;
          }
          if (objectIdsEqual(value, banned)) return false;
        }
        continue;
      }
      return false;
    }
    if (!objectIdsEqual(value, cond)) return false;
  }
  return true;
}

class FakeDb {
  databaseName: string;
  store = new Map<string, Map<string, Doc>>();

  constructor(databaseName = "ahd_sim_probe", gameConfig: Doc | null = null) {
    this.databaseName = databaseName;
    const config: Doc =
      gameConfig ?? ({ _id: "default", simSandbox: true, ledgerShadow: true } as Doc);
    this.store.set("gameConfig", new Map([[idKey(config._id), config]]));
  }

  collection(name: string) {
    const table = (): Map<string, Doc> => {
      let map = this.store.get(name);
      if (!map) {
        map = new Map();
        this.store.set(name, map);
      }
      return map;
    };
    return {
      findOne: async (filter: any) => {
        for (const doc of table().values()) if (matches(doc, filter)) return { ...doc };
        return null;
      },

      countDocuments: async (filter: any = {}) =>
        [...table().values()].filter((d) => matches(d, filter)).length,

      find: (filter: any = {}, opts?: { projection?: Record<string, number> }) => ({
        toArray: async () => {
          const rows = [...table().values()].filter((d) => matches(d, filter));
          if (!opts?.projection) return rows.map((d) => ({ ...d }));
          return rows.map((d) => {
            const out: Doc = {};
            for (const [k, v] of Object.entries(opts.projection as Record<string, number>)) {
              if (v && k in d) out[k] = d[k];
            }
            return out;
          });
        },
      }),

      bulkWrite: async (ops: any[]) => {
        for (const op of ops) {
          const { filter, update, upsert } = op.updateOne;
          const map = table();
          const key = idKey(filter._id);
          const existing = map.get(key);
          if (existing) map.set(key, { ...existing, ...update.$set });
          else if (upsert) map.set(key, { ...update.$set });
        }
        return { acknowledged: true };
      },
    };
  }

  docCount(collection: string): number {
    return this.store.get(collection)?.size ?? 0;
  }
}

const SEED = "materialize-seed-1";
const NOW = new Date("1953-01-01T00:00:00.000Z");

function fakeDb(): Db {
  return new FakeDb() as unknown as Db;
}

/** Plant one real persisted org (plus its party row) for the seeder to target. */
function plantRealOrg(db: Db): void {
  const fake = db as unknown as FakeDb;
  fake.store.set(
    "politicalParties",
    new Map([["party-1", { _id: "party-1", countryId: "US", sequentialId: 1 }]])
  );
  fake.store.set(
    "statePartyOrg",
    new Map([
      [
        "CA_1",
        {
          _id: "CA_1",
          countryId: "US",
          stateId: "CA",
          partyId: "1",
          chairId: null,
          viceChairId: null,
          treasurerId: null,
        },
      ],
    ])
  );
}

describe("assertSandboxDb (no-live-DB guard)", () => {
  it("accepts a marked sandbox sim database", async () => {
    await expect(assertSandboxDb(fakeDb())).resolves.toBeUndefined();
  });

  it("refuses a live-looking database name even with the sandbox flag", async () => {
    const db = new FakeDb("a-house-divided") as unknown as Db;
    await expect(assertSandboxDb(db)).rejects.toThrow("not a sandbox sim database");
  });

  it("refuses a sim-named database without the sandbox marker", async () => {
    const db = new FakeDb("ahd_sim_probe", { _id: "default" }) as unknown as Db;
    await expect(assertSandboxDb(db)).rejects.toThrow("simSandbox");
  });

  it("pins the sandbox prefix the harness uses for every world", () => {
    expect(SIM_SANDBOX_DB_PREFIX).toBe("ahd_sim_");
    expect("ahd_sim_probe".startsWith(SIM_SANDBOX_DB_PREFIX)).toBe(true);
  });
});

describe("materializeSyntheticActors", () => {
  it("creates seven valid simulation-only users and characters", async () => {
    const db = fakeDb();
    const result = await materializeSyntheticActors(db, {
      seed: SEED,
      runId: "run-1",
      turn: 0,
      now: NOW,
    });
    expect(result.users).toBe(SYNTHETIC_ACTOR_ROLES.length);
    expect(result.characters).toBe(SYNTHETIC_ACTOR_ROLES.length);
    const plan = buildSyntheticActorPlan(SEED);
    for (const actor of plan.actors) {
      const user = await db.collection("users").findOne({ _id: new ObjectId(actor.userIdHex) });
      expect(user?.username).toBe(actor.username);
      expect((user?.username as string).startsWith(SIM_ACTOR_USERNAME_PREFIX)).toBe(true);
      expect(user?.activeCharacterId).toEqual(new ObjectId(actor.characterIdHex));
      const character = await db
        .collection("characters")
        .findOne({ _id: new ObjectId(actor.characterIdHex) });
      expect(character?.isSynthetic).toBe(true);
      expect(character?.syntheticRunId).toBe("run-1");
      expect(character?.userId).toEqual(new ObjectId(actor.userIdHex));
    }
  });

  it("is deterministic by seed and idempotent on retry", async () => {
    const first = fakeDb();
    await materializeSyntheticActors(first, { seed: SEED, runId: "run-1", turn: 0, now: NOW });
    const second = fakeDb();
    await materializeSyntheticActors(second, { seed: SEED, runId: "run-1", turn: 0, now: NOW });
    for (const collection of [
      "users",
      "characters",
      "electedOfficials",
      "cabinetMembers",
      "statePartyElections",
      "statePartyCandidates",
      "corporations",
      "corporateSectors",
    ]) {
      expect((second as unknown as FakeDb).docCount(collection)).toBe(
        (first as unknown as FakeDb).docCount(collection)
      );
    }
    // Retry into the SAME database changes nothing (upserts by _id).
    await materializeSyntheticActors(first, { seed: SEED, runId: "run-1", turn: 0, now: NOW });
    expect((first as unknown as FakeDb).docCount("characters")).toBe(SYNTHETIC_ACTOR_ROLES.length);
    expect((first as unknown as FakeDb).docCount("users")).toBe(SYNTHETIC_ACTOR_ROLES.length);
    // A different seed yields a disjoint population (no id reuse across seeds).
    const other = fakeDb();
    await materializeSyntheticActors(other, {
      seed: "other-seed",
      runId: "run-2",
      turn: 0,
      now: NOW,
    });
    const otherIds = await other.collection("characters").find({ isSynthetic: true }).toArray();
    const firstIds = await first.collection("characters").find({ isSynthetic: true }).toArray();
    const overlap = (otherIds as Doc[]).filter((o) =>
      (firstIds as Doc[]).some((f) => objectIdsEqual(f._id, o._id))
    );
    expect(overlap).toHaveLength(0);
  });

  it("seats the US president through the electedOfficials presidential row", async () => {
    const db = fakeDb();
    await materializeSyntheticActors(db, { seed: SEED, runId: "run-1", turn: 0, now: NOW });
    const plan = buildSyntheticActorPlan(SEED);
    const official = await db
      .collection("electedOfficials")
      .findOne({ officeType: "president", countryId: "US" });
    expect(official?.characterId).toEqual(new ObjectId(plan.actors[0].characterIdHex));
    expect(official?.isNPP).toBe(false);
  });

  it("mirrors the presidency onto the character doc like a production inauguration", async () => {
    const db = fakeDb();
    await materializeSyntheticActors(db, { seed: SEED, runId: "run-1", turn: 0, now: NOW });
    const plan = buildSyntheticActorPlan(SEED);
    const president = await db
      .collection("characters")
      .findOne({ _id: new ObjectId(plan.actors[0].characterIdHex) });
    // deriveCharacterRoles keys headOfState off currentOffice.type; the US
    // config has no isHeadOfState office type, so without this mirror the
    // seated president resolves as a private citizen.
    expect((president?.currentOffice as { type?: string } | undefined)?.type).toBe("president");
  });

  it("seats the DD finance minister under the issuer gate's own lookup key", async () => {
    const db = fakeDb();
    await materializeSyntheticActors(db, { seed: SEED, runId: "run-1", turn: 0, now: NOW });
    const plan = buildSyntheticActorPlan(SEED);
    const seat = COUNTRY_CONFIGS.DD?.financeMinisterCabinetId;
    expect(seat).toBeTruthy();
    const member = await db
      .collection("cabinetMembers")
      .findOne({ countryId: "DD", positionId: seat });
    expect(member?.characterId).toEqual(new ObjectId(plan.actors[6].characterIdHex));
  });

  it("declares one candidacy plus one self-vote per office against the real org", async () => {
    const db = fakeDb();
    plantRealOrg(db);
    const result = await materializeSyntheticActors(db, {
      seed: SEED,
      runId: "run-1",
      turn: 0,
      now: NOW,
    });
    expect(result.statePartyVotes).toBe(3);
    const plan = buildSyntheticActorPlan(SEED);
    expect(await db.collection("statePartyCandidates").countDocuments({})).toBe(3);
    expect(await db.collection("statePartyElections").countDocuments({})).toBe(3);
    expect(await db.collection("statePartyVotes").countDocuments({})).toBe(3);
    for (const position of ["chair", "viceChair", "treasurer"]) {
      const election = await db.collection("statePartyElections").findOne({ position });
      // Real persisted org keys, never a synthetic partyId.
      expect(election?.stateId).toBe("CA");
      expect(election?.partyId).toBe("1");
      expect(election?.status).toBe("voting");
      const candidacy = await db.collection("statePartyCandidates").findOne({ position });
      expect(candidacy?.characterId).toEqual(new ObjectId(plan.actors[2].characterIdHex));
      expect(candidacy?.electionId).toEqual(election?._id);
      expect(candidacy?.status).toBe("active");
      const votes = await db
        .collection("statePartyVotes")
        .find({ electionId: election?._id })
        .toArray();
      expect(votes).toHaveLength(1);
      expect(votes[0]?.candidateId).toEqual(new ObjectId(plan.actors[2].characterIdHex));
    }
  });

  it("skips state-party seating when no persisted org exists", async () => {
    const db = fakeDb();
    const result = await materializeSyntheticActors(db, {
      seed: SEED,
      runId: "run-1",
      turn: 0,
      now: NOW,
    });
    expect(result.statePartyElections).toBe(0);
    expect(result.statePartyCandidates).toBe(0);
    expect(result.statePartyVotes).toBe(0);
  });

  it("founds a private corp and a founding IPO with deterministic tickers", async () => {
    const db = fakeDb();
    await materializeSyntheticActors(db, { seed: SEED, runId: "run-1", turn: 0, now: NOW });
    const plan = buildSyntheticActorPlan(SEED);
    const expected = computeIpoIssuance({
      existingShares: CEO_INITIAL_SHARES,
      pricePerShare: IPO_PROBE_PRICE_PER_SHARE,
      floatPct: IPO_PROBE_FLOAT_PCT,
    });
    const priv = await db
      .collection("corporations")
      .findOne({ ceoId: new ObjectId(plan.actors[3].characterIdHex) });
    expect(priv?.ceoType).toBe("character");
    expect(priv?.isPrivate).toBe(true);
    expect(priv?.liquidCapital).toBe(PRIVATE_PROBE_FOUNDING_CAPITAL);
    expect(priv?.totalShares).toBe(CEO_INITIAL_SHARES);
    const ipo = await db
      .collection("corporations")
      .findOne({ ceoId: new ObjectId(plan.actors[4].characterIdHex) });
    expect(ipo?.ceoType).toBe("character");
    expect(ipo?.isPrivate).toBe(false);
    expect(ipo?.publicFloat).toBe(expected.newShares);
    expect(ipo?.liquidCapital).toBe(PRIVATE_PROBE_FOUNDING_CAPITAL + expected.proceeds);
    expect(ipo?.tickerSymbol).toMatch(/^S[A-Z]{4}$/);
    expect(priv?.tickerSymbol).toMatch(/^S[A-Z]{4}$/);
    expect(ipo?.tickerSymbol).not.toBe(priv?.tickerSymbol);
    expect(await db.collection("corporateSectors").countDocuments({})).toBe(2);
  });

  it("derives tickers deterministically without leaking hex case", () => {
    expect(syntheticTicker(SEED, "us-founder-ipo")).toBe(syntheticTicker(SEED, "us-founder-ipo"));
    expect(syntheticTicker(SEED, "us-founder-ipo")).toMatch(/^S[A-Z]{4}$/);
  });

  it("retries state-party seeding without duplicating candidates or votes", async () => {
    const db = fakeDb();
    plantRealOrg(db);
    const first = await materializeSyntheticActors(db, {
      seed: SEED,
      runId: "run-1",
      turn: 0,
      now: NOW,
    });
    const second = await materializeSyntheticActors(db, {
      seed: SEED,
      runId: "run-1",
      turn: 0,
      now: NOW,
    });
    // The retry attaches to the same live voting elections (nothing new to
    // create) and upserts the same deterministic candidate/vote ids, so
    // counts never grow.
    expect(first.statePartyElections).toBe(3);
    expect(second.statePartyElections).toBe(0);
    expect(await db.collection("statePartyElections").countDocuments({})).toBe(3);
    expect(await db.collection("statePartyCandidates").countDocuments({})).toBe(3);
    expect(await db.collection("statePartyVotes").countDocuments({})).toBe(3);
  });

  it("queues the Fed nomination once and never on retry (idempotent accept pool)", async () => {
    const db = fakeDb();
    (db as unknown as FakeDb).store.set(
      "centralBanks",
      new Map([
        [
          "US",
          {
            _id: "US",
            chairCharacterId: null,
            chairTermExpiresAtTurn: null,
            nominations: [],
          },
        ],
      ])
    );
    const first = await materializeSyntheticActors(db, {
      seed: SEED,
      runId: "run-1",
      turn: 0,
      now: NOW,
    });
    expect(first.fedNominations).toBe(1);
    const second = await materializeSyntheticActors(db, {
      seed: SEED,
      runId: "run-1",
      turn: 0,
      now: NOW,
    });
    expect(second.fedNominations).toBe(0);
    const bank = await db.collection<CentralBank>("centralBanks").findOne({ _id: "US" });
    expect((bank?.nominations ?? []) as unknown[]).toHaveLength(1);
  });

  it("refuses to overwrite a real user row at a deterministic id (clone-mode restore)", async () => {
    const db = fakeDb();
    const plan = buildSyntheticActorPlan(SEED);
    // A --clone-mode live restore carries real users without isSynthetic
    // markers; seeding must fail loudly instead of hijacking the row.
    (db as unknown as FakeDb).store.set(
      "users",
      new Map([
        [
          plan.actors[0].userIdHex,
          {
            _id: new ObjectId(plan.actors[0].userIdHex),
            email: "real-player@example.com",
            username: "realplayer",
          },
        ],
      ])
    );
    await expect(
      materializeSyntheticActors(db, { seed: SEED, runId: "run-1", turn: 0, now: NOW })
    ).rejects.toThrow('non-synthetic document(s) already own _id(s) in "users"');
    // Refusal happens before any write: the sandbox is untouched.
    expect((db as unknown as FakeDb).docCount("characters")).toBe(0);
  });

  it("refuses a real corporation holding a seeded ticker", async () => {
    const db = fakeDb();
    (db as unknown as FakeDb).store.set(
      "corporations",
      new Map([
        [
          "real-corp",
          {
            _id: new ObjectId(),
            tickerSymbol: syntheticTicker(SEED, "us-founder-private"),
            sequentialId: 42,
            name: "Real Corp",
          },
        ],
      ])
    );
    await expect(
      materializeSyntheticActors(db, { seed: SEED, runId: "run-1", turn: 0, now: NOW })
    ).rejects.toThrow("already own a seeded ticker/sequentialId");
  });

  it("refuses a real corporation holding a seeded sequential id", async () => {
    const db = fakeDb();
    (db as unknown as FakeDb).store.set(
      "corporations",
      new Map([
        [
          "real-corp",
          {
            _id: new ObjectId(),
            tickerSymbol: "REAL",
            sequentialId: syntheticCorporateSequentialId(SEED, 0),
            name: "Real Corp",
          },
        ],
      ])
    );
    await expect(
      materializeSyntheticActors(db, { seed: SEED, runId: "run-1", turn: 0, now: NOW })
    ).rejects.toThrow("already own a seeded ticker/sequentialId");
  });
});

describe("readActorPopulation (persisted manifest input)", () => {
  it("reads zeros on a fresh actorless sandbox (pure-NPP preservation)", async () => {
    const snapshot = await readActorPopulation(fakeDb(), {
      mode: "pure-npp",
      preset: "1953-default",
    });
    expect(snapshot).toMatchObject({
      mode: "pure-npp",
      preset: "1953-default",
      characters: 0,
      users: 0,
      syntheticCharacters: 0,
      syntheticUsers: 0,
      statePartyCandidates: 0,
      crisisDecidedInteractions: 0,
      wealthListRows: 0,
      playerFoundedCorps: 0,
    });
  });

  it("reads the materialized population back after seeding (never the plan)", async () => {
    const db = fakeDb();
    plantRealOrg(db);
    await materializeSyntheticActors(db, { seed: SEED, runId: "run-1", turn: 0, now: NOW });
    const snapshot = await readActorPopulation(db, { mode: "synthetic", preset: "1953-default" });
    expect(snapshot.characters).toBe(SYNTHETIC_ACTOR_ROLES.length);
    expect(snapshot.syntheticCharacters).toBe(SYNTHETIC_ACTOR_ROLES.length);
    expect(snapshot.syntheticUsers).toBe(SYNTHETIC_ACTOR_ROLES.length);
    expect(snapshot.statePartyCandidates).toBe(3);
    expect(snapshot.playerFoundedCorps).toBe(2);
    expect(snapshot.crisisDecidedInteractions).toBe(0);
    expect(snapshot.wealthListRows).toBe(0);
  });

  it("agrees with the probes on the same seed (seeder to report path)", async () => {
    const db = fakeDb();
    await materializeSyntheticActors(db, { seed: SEED, runId: "run-1", turn: 0, now: NOW });
    const persisted = await db.collection("characters").find({ isSynthetic: true }).toArray();
    const persistedHex = (persisted as Doc[]).map((d) => (d._id as ObjectId).toHexString()).sort();
    const planHex = buildSyntheticActorPlan(SEED)
      .actors.map((a) => a.characterIdHex)
      .sort();
    expect(persistedHex).toEqual(planHex);
    // The Fed-chair probe seats exactly the persisted nominee and executive.
    const probe = probeFedChair1953("synthetic", SEED);
    expect(persistedHex).toContain(probe.seated?.chairCharacterIdHex);
    expect(persistedHex).toContain(probe.seated?.nominatedByCharacterIdHex);
  });
});
