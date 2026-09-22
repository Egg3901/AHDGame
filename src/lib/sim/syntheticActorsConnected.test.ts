/**
 * Connected synthetic-actor tests (issue #1993).
 *
 * Where the sibling suites assert seeder/probe shapes against stubs, this
 * file runs the REAL production functions against seeded sandbox state:
 * - `processCompletedElections` (via a getDb mock backed by an in-memory
 *   FakeDb with aggregate support for the vote-tally pipeline) seats the
 *   synthetic state-party member through the representative path.
 * - `isNationalIssuer` / `resolveCharacterRoles` authorize the seeded DD
 *   minister and US president.
 * - `submitCrisisDecision`, `launchGovernmentProspect`, and
 *   `acceptCentralBankChairSelection` run unmocked (only the Discord
 *   announce side effect is stubbed) and `driveSyntheticActors` threads all
 *   three through its bounded, never-throwing per-turn pass.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import type { CentralBank } from "@/lib/db/types/centralBank";
import type { StatePartyOrg } from "@/lib/db/types/statePartyOrg";
import { getBankId } from "@/lib/centralBank/helpers";
import { materializeSyntheticActors } from "./materializeSyntheticActors";
import { buildSyntheticActorPlan } from "./syntheticActors";
import { processCompletedElections } from "@/lib/statePartyElections";
import { isNationalIssuer } from "@/lib/extraction/contractIssuerAuth";
import { resolveCharacterRoles, submitCrisisDecision } from "@/lib/crises/interactionEngine";
import { launchGovernmentProspect } from "@/lib/extraction/commands/launchGovernmentProspect";
import { acceptCentralBankChairSelection } from "@/lib/turn/centralBankChairSelection";
import { driveSyntheticActors } from "./driveSyntheticActors";

const dbHolder = vi.hoisted(() => ({ db: null as unknown as Db }));

vi.mock("@/lib/mongodb", async (importOriginal) => ({
  ...((await importOriginal()) as Record<string, unknown>),
  getDb: async () => dbHolder.db,
}));

// The chair-accept Discord announcement would hit the network; the surgeon's
// cut is at the notifier, never at the appointment seam under test.
vi.mock("@/lib/centralBankChairEvents", async (importOriginal) => ({
  ...((await importOriginal()) as Record<string, unknown>),
  notifyCbChairAcceptedDiscord: async () => {},
}));

/* In-memory Db stub with the driver surface the connected paths use:
 * find/findOne (dotted keys, $in/$nin/$ne/$exists/$lte/$gte/$regex),
 * project/sort cursor chaining, insertOne/insertMany, updateOne/updateMany
 * ($set/$inc/$mul/$push/$unset with dotted paths), bulkWrite upserts, and
 * the aggregate stages ($match/$sort/$group/$project) the vote tally needs.
 */

type Doc = Record<string, unknown>;

/** String-keyed centralBanks rows; tests plant partial bank docs. */
type BankDoc = { _id: string } & Record<string, unknown>;

function isUnsafeKey(key: string): boolean {
  return key === "__proto__" || key === "constructor" || key === "prototype";
}

function isOid(value: unknown): value is ObjectId {
  return value instanceof ObjectId;
}

function idKey(id: unknown): string {
  return isOid(id) ? id.toHexString() : String(id);
}

function getPath(doc: Doc, path: string): unknown {
  let current: unknown = doc;
  for (const part of path.split(".")) {
    if (current === null || typeof current !== "object") return undefined;
    current = (current as Doc)[part];
  }
  return current;
}

function setPath(doc: Doc, path: string, value: unknown): void {
  const parts = path.split(".");
  let current = doc;
  for (let i = 0; i < parts.length - 1; i++) {
    if (isUnsafeKey(parts[i])) return;
    const next = current[parts[i]];
    if (next === null || typeof next !== "object" || Array.isArray(next)) {
      current[parts[i]] = {};
    }
    current = current[parts[i]] as Doc;
  }
  const leaf = parts[parts.length - 1];
  if (isUnsafeKey(leaf)) return;
  current[leaf] = value;
}

function valuesEqual(a: unknown, b: unknown): boolean {
  if (isOid(a) && isOid(b)) return a.equals(b);
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  return a === b;
}

function compareValues(a: unknown, b: unknown): number {
  const key = (v: unknown): number | string => {
    if (isOid(v)) return v.toHexString();
    if (v instanceof Date) return v.getTime();
    if (typeof v === "number") return v;
    return String(v);
  };
  const ka = key(a);
  const kb = key(b);
  if (typeof ka === "number" && typeof kb === "number") return ka - kb;
  const sa = String(ka);
  const sb = String(kb);
  return sa < sb ? -1 : sa > sb ? 1 : 0;
}

function matchesCondition(value: unknown, cond: unknown): boolean {
  if (
    cond !== null &&
    typeof cond === "object" &&
    !isOid(cond) &&
    !(cond instanceof Date) &&
    !Array.isArray(cond)
  ) {
    for (const [op, arg] of Object.entries(cond as Record<string, unknown>)) {
      switch (op) {
        case "$in": {
          const list = arg as unknown[];
          if (Array.isArray(value)) {
            if (!value.some((v) => list.some((item) => valuesEqual(v, item)))) return false;
          } else if (!list.some((item) => valuesEqual(value, item))) return false;
          break;
        }
        case "$nin": {
          const list = arg as unknown[];
          if (Array.isArray(value)) {
            if (value.some((v) => list.some((item) => valuesEqual(v, item)))) return false;
          } else if (list.some((item) => valuesEqual(value, item))) return false;
          break;
        }
        case "$ne": {
          if (Array.isArray(arg) && Array.isArray(value)) {
            if (value.length === arg.length) return false;
          } else if (valuesEqual(value, arg)) return false;
          break;
        }
        case "$exists": {
          if (Boolean(arg) !== (value !== undefined)) return false;
          break;
        }
        case "$lte": {
          if (compareValues(value, arg) > 0) return false;
          break;
        }
        case "$lt": {
          if (compareValues(value, arg) >= 0) return false;
          break;
        }
        case "$gte": {
          if (compareValues(value, arg) < 0) return false;
          break;
        }
        case "$gt": {
          if (compareValues(value, arg) <= 0) return false;
          break;
        }
        case "$regex": {
          if (typeof value !== "string" || !new RegExp(arg as string).test(value)) return false;
          break;
        }
        default:
          return false;
      }
    }
    return true;
  }
  return valuesEqual(value, cond);
}

function matches(doc: Doc, filter: Record<string, unknown>): boolean {
  for (const [key, cond] of Object.entries(filter ?? {})) {
    const value = key.includes(".") ? getPath(doc, key) : doc[key];
    if (!matchesCondition(value, cond)) return false;
  }
  return true;
}

function applyProjection(doc: Doc, projection: Record<string, number>): Doc {
  const include = Object.entries(projection)
    .filter(([, v]) => v)
    .map(([k]) => k);
  if (include.length === 0) return { ...doc };
  const out: Doc = {};
  for (const key of include) {
    if (key in doc) out[key] = doc[key];
  }
  if (projection._id !== 0 && !("_id" in out) && "_id" in doc) out._id = doc._id;
  return out;
}

function applyUpdate(doc: Doc, update: Record<string, unknown>): void {
  for (const [op, fields] of Object.entries(update)) {
    const entries = Object.entries((fields ?? {}) as Record<string, unknown>);
    if (op === "$set") {
      for (const [k, v] of entries) setPath(doc, k, v);
    } else if (op === "$inc") {
      for (const [k, v] of entries) {
        const current = (getPath(doc, k) as number | undefined) ?? 0;
        setPath(doc, k, current + (v as number));
      }
    } else if (op === "$mul") {
      for (const [k, v] of entries) {
        const current = (getPath(doc, k) as number | undefined) ?? 0;
        setPath(doc, k, current * (v as number));
      }
    } else if (op === "$push") {
      for (const [k, v] of entries) {
        const current = getPath(doc, k);
        if (Array.isArray(current)) current.push(v);
        else setPath(doc, k, [v]);
      }
    } else if (op === "$unset") {
      for (const [k] of entries) {
        const parts = k.split(".");
        let target: unknown = doc;
        for (let i = 0; i < parts.length - 1; i++) {
          if (target === null || typeof target !== "object") break;
          target = (target as Doc)[parts[i]];
        }
        if (target !== null && typeof target === "object") {
          delete (target as Doc)[parts[parts.length - 1]];
        }
      }
    }
  }
}

function resolveRef(doc: Doc, ref: unknown): unknown {
  if (typeof ref === "string" && ref.startsWith("$")) return getPath(doc, ref.slice(1));
  return ref;
}

/** Group _id specs are objects of refs ({electionId: "$electionId"}); resolve recursively. */
function resolveRefDeep(doc: Doc, ref: unknown): unknown {
  if (typeof ref === "string") return ref.startsWith("$") ? getPath(doc, ref.slice(1)) : ref;
  if (
    ref !== null &&
    typeof ref === "object" &&
    !isOid(ref) &&
    !(ref instanceof Date) &&
    !Array.isArray(ref)
  ) {
    const out: Doc = {};
    for (const [k, v] of Object.entries(ref as Doc)) out[k] = resolveRefDeep(doc, v);
    return out;
  }
  return ref;
}

function encodeKey(value: unknown): string {
  if (isOid(value)) return `oid:${value.toHexString()}`;
  if (value instanceof Date) return `date:${value.toISOString()}`;
  if (value !== null && typeof value === "object") {
    const sorted = Object.keys(value as Doc)
      .sort()
      .map((k) => `${k}=${encodeKey((value as Doc)[k])}`)
      .join(",");
    return `{${sorted}}`;
  }
  return `raw:${String(value)}`;
}

function runAggregate(docs: Doc[], pipeline: Array<Record<string, unknown>>): Doc[] {
  let rows = docs.map((d) => ({ ...d }));
  for (const stage of pipeline) {
    if ("$match" in stage) {
      rows = rows.filter((d) => matches(d, stage.$match as Record<string, unknown>));
    } else if ("$sort" in stage) {
      const spec = Object.entries(stage.$sort as Record<string, number>);
      rows = [...rows].sort((a, b) => {
        for (const [k, dir] of spec) {
          const cmp = compareValues(a[k], b[k]);
          if (cmp !== 0) return dir === -1 ? -cmp : cmp;
        }
        return 0;
      });
    } else if ("$group" in stage) {
      const spec = stage.$group as Record<string, unknown>;
      const groups = new Map<string, { key: unknown; acc: Doc; first: Doc }>();
      for (const doc of rows) {
        const key = resolveRefDeep(doc, spec._id);
        const hex = encodeKey(key);
        let group = groups.get(hex);
        if (!group) {
          group = { key, acc: {}, first: doc };
          groups.set(hex, group);
        }
        for (const [field, expr] of Object.entries(spec)) {
          if (field === "_id") continue;
          const acc = expr as Record<string, unknown>;
          if ("$first" in acc && !(field in group.acc)) {
            group.acc[field] = resolveRef(group.first, acc.$first);
          } else if ("$sum" in acc) {
            const add = acc.$sum === 1 ? 1 : Number(resolveRef(doc, acc.$sum)) || 0;
            group.acc[field] = (Number(group.acc[field]) || 0) + add;
          }
        }
      }
      rows = [...groups.values()].map((g) => ({ _id: g.key, ...g.acc }));
    } else if ("$project" in stage) {
      const spec = stage.$project as Record<string, unknown>;
      rows = rows.map((doc) => {
        const out: Doc = {};
        for (const [k, v] of Object.entries(spec)) {
          if (v === 0) continue;
          if (v === 1) {
            if (k in doc) out[k] = doc[k];
          } else {
            out[k] = resolveRef(doc, v);
          }
        }
        return out;
      });
    }
  }
  return rows;
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
    const cursor = (rows: Doc[]) => {
      let projection: Record<string, number> | null = null;
      let sort: Record<string, number> | null = null;
      const api = {
        project(p: Record<string, number>) {
          projection = p;
          return api;
        },
        sort(s: Record<string, number>) {
          sort = s;
          return api;
        },
        toArray: async () => {
          let out = rows.map((d) => ({ ...d }));
          if (sort) {
            const spec = Object.entries(sort);
            out = [...out].sort((a, b) => {
              for (const [k, dir] of spec) {
                const cmp = compareValues(a[k], b[k]);
                if (cmp !== 0) return dir === -1 ? -cmp : cmp;
              }
              return 0;
            });
          }
          if (projection)
            out = out.map((d) => applyProjection(d, projection as Record<string, number>));
          return out;
        },
      };
      return api;
    };
    return {
      findOne: async (
        filter: Record<string, unknown>,
        opts?: { projection?: Record<string, number> }
      ) => {
        for (const doc of table().values()) {
          if (matches(doc, filter)) {
            return opts?.projection ? applyProjection({ ...doc }, opts.projection) : { ...doc };
          }
        }
        return null;
      },

      countDocuments: async (filter: Record<string, unknown> = {}) =>
        [...table().values()].filter((d) => matches(d, filter)).length,

      find: (
        filter: Record<string, unknown> = {},
        opts?: { projection?: Record<string, number> }
      ) => {
        const rows = [...table().values()].filter((d) => matches(d, filter));
        const base = cursor(
          opts?.projection
            ? rows.map((d) => applyProjection(d, opts.projection as Record<string, number>))
            : rows
        );
        return base;
      },

      insertOne: async (doc: Doc) => {
        const copy = { ...doc };
        if (copy._id === undefined || copy._id === null) copy._id = new ObjectId();
        table().set(idKey(copy._id), copy);
        return { acknowledged: true, insertedId: copy._id };
      },

      insertMany: async (docs: Doc[]) => {
        const insertedIds: Record<number, unknown> = {};
        docs.forEach((doc, i) => {
          const copy = { ...doc };
          if (copy._id === undefined || copy._id === null) copy._id = new ObjectId();
          table().set(idKey(copy._id), copy);
          insertedIds[i] = copy._id;
        });
        return { acknowledged: true, insertedCount: docs.length, insertedIds };
      },

      updateOne: async (
        filter: Record<string, unknown>,
        update: Record<string, unknown>,
        opts: { upsert?: boolean } = {}
      ) => {
        for (const doc of table().values()) {
          if (matches(doc, filter)) {
            applyUpdate(doc, update);
            return { acknowledged: true, matchedCount: 1, modifiedCount: 1 };
          }
        }
        if (opts.upsert) {
          const created: Doc = {};
          for (const [k, v] of Object.entries(filter)) {
            if (!k.includes(".") && (typeof v !== "object" || v === null || isOid(v))) {
              created[k] = v;
            }
          }
          applyUpdate(created, update);
          if (created._id === undefined) created._id = new ObjectId();
          table().set(idKey(created._id), created);
          return { acknowledged: true, matchedCount: 0, modifiedCount: 0, upsertedId: created._id };
        }
        return { acknowledged: true, matchedCount: 0, modifiedCount: 0 };
      },

      updateMany: async (filter: Record<string, unknown>, update: Record<string, unknown>) => {
        let matched = 0;
        for (const doc of table().values()) {
          if (matches(doc, filter)) {
            applyUpdate(doc, update);
            matched++;
          }
        }
        return { acknowledged: true, matchedCount: matched, modifiedCount: matched };
      },

      bulkWrite: async (
        ops: Array<{ updateOne: { filter: Doc; update: Doc; upsert?: boolean } }>
      ) => {
        for (const op of ops) {
          const { filter, update, upsert } = op.updateOne;
          const map = table();
          const key =
            "_id" in filter &&
            !Object.keys(filter).some((k) => k.includes(".")) &&
            idKey(filter._id) !== undefined
              ? idKey(filter._id)
              : null;
          const byId = key !== null ? map.get(key) : undefined;
          if (byId && matches(byId, filter as Record<string, unknown>)) {
            applyUpdate(byId, update as Record<string, unknown>);
          } else {
            let target: Doc | undefined;
            for (const doc of map.values()) {
              if (matches(doc, filter as Record<string, unknown>)) {
                target = doc;
                break;
              }
            }
            if (target) applyUpdate(target, update as Record<string, unknown>);
            else if (upsert) {
              const created: Doc = {};
              for (const [k, v] of Object.entries(filter)) {
                if (!k.includes(".") && (typeof v !== "object" || v === null || isOid(v))) {
                  created[k] = v;
                }
              }
              applyUpdate(created, update as Record<string, unknown>);
              if (created._id === undefined) created._id = new ObjectId();
              map.set(idKey(created._id), created);
            }
          }
        }
        return { acknowledged: true };
      },

      aggregate: (pipeline: Array<Record<string, unknown>>) => ({
        toArray: async () => runAggregate([...table().values()], pipeline),
      }),
    };
  }
}

const SEED = "connected-seed-1";
const NOW = new Date("1953-01-01T00:00:00.000Z");

function fakeDb(): Db {
  const db = new FakeDb() as unknown as Db;
  dbHolder.db = db;
  return db;
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

function roleIds(seed: string, role: string): { characterId: ObjectId; userId: ObjectId } {
  const actor = buildSyntheticActorPlan(seed).actors.find((a) => a.role === role);
  if (!actor) throw new Error(`test plan missing role "${role}"`);
  return { characterId: new ObjectId(actor.characterIdHex), userId: new ObjectId(actor.userIdHex) };
}

beforeEach(() => {
  dbHolder.db = null as unknown as Db;
});

describe("connected state-party resolution (real processCompletedElections)", () => {
  it("seats the synthetic member in every office through the representative path", async () => {
    const db = fakeDb();
    plantRealOrg(db);
    await materializeSyntheticActors(db, { seed: SEED, runId: "run-1", turn: 0, now: NOW });
    const member = roleIds(SEED, "us-state-party-member");

    // Seeded elections run to turn 24; resolving AT the end turn exercises
    // the real tally (candidates + self-votes), not the no-candidate branch.
    const resolved = await processCompletedElections(24, NOW);
    expect(resolved).toBe(3);

    for (const position of ["chair", "viceChair", "treasurer"] as const) {
      const election = await db.collection("statePartyElections").findOne({ position });
      expect(election?.status).toBe("completed");
      expect(election?.winnerId).toEqual(member.characterId);
    }
    const org = await db.collection<StatePartyOrg>("statePartyOrg").findOne({ _id: "CA_1" });
    expect(org?.chairId).toEqual(member.characterId);
    expect(org?.viceChairId).toEqual(member.characterId);
    expect(org?.treasurerId).toEqual(member.characterId);
    // Candidacies terminalize so the next cycle can declare again.
    expect(
      await db.collection("statePartyCandidates").countDocuments({ status: "completed" })
    ).toBe(3);
  });

  it("leaves the org vacant when the tally is empty (honest no-candidate branch)", async () => {
    const db = fakeDb();
    plantRealOrg(db);
    await materializeSyntheticActors(db, { seed: SEED, runId: "run-1", turn: 0, now: NOW });
    // Remove every vote: the real resolver must take the no-candidate branch
    // and keep the incumbent (null) rather than seating anyone.
    (db as unknown as FakeDb).store.set("statePartyVotes", new Map());
    const resolved = await processCompletedElections(24, NOW);
    expect(resolved).toBe(3);
    const org = await db.collection<StatePartyOrg>("statePartyOrg").findOne({ _id: "CA_1" });
    expect(org?.chairId).toBeNull();
    expect(org?.viceChairId).toBeNull();
    expect(org?.treasurerId).toBeNull();
  });
});

describe("connected authorization (real isNationalIssuer / resolveCharacterRoles)", () => {
  it("authorizes the seeded DD finance minister as national issuer", async () => {
    const db = fakeDb();
    await materializeSyntheticActors(db, { seed: SEED, runId: "run-1", turn: 0, now: NOW });
    const minister = roleIds(SEED, "dd-finance-minister");
    await expect(isNationalIssuer(db, "DD", minister.characterId)).resolves.toBe(true);
  });

  it("refuses a bystander with no seat as national issuer", async () => {
    const db = fakeDb();
    await materializeSyntheticActors(db, { seed: SEED, runId: "run-1", turn: 0, now: NOW });
    const founder = roleIds(SEED, "us-founder-private");
    await expect(isNationalIssuer(db, "DD", founder.characterId)).resolves.toBe(false);
  });

  it("resolves head-of-state roles for the seated president, plain roles otherwise", async () => {
    const db = fakeDb();
    await materializeSyntheticActors(db, { seed: SEED, runId: "run-1", turn: 0, now: NOW });
    const president = roleIds(SEED, "us-president");
    const presidentDoc = await db.collection("characters").findOne({ _id: president.characterId });
    const presidentRoles = await resolveCharacterRoles(db, {
      _id: president.characterId,
      currentOffice: (presidentDoc?.currentOffice ?? null) as { type?: string } | null,
      countryId: "US",
    });
    expect(presidentRoles).toContain("headOfState");

    const founder = roleIds(SEED, "us-founder-private");
    const founderRoles = await resolveCharacterRoles(db, {
      _id: founder.characterId,
      currentOffice: null,
      countryId: "US",
    });
    expect(founderRoles).not.toContain("headOfState");
  });
});

async function plantChoiceCrisis(db: Db, count: number): Promise<ObjectId[]> {
  const crisisId = new ObjectId();
  await db.collection("crises").insertOne({ _id: crisisId, countryId: "US", scope: "national" });
  const ids: ObjectId[] = [];
  for (let i = 0; i < count; i++) {
    const id = new ObjectId();
    await db.collection("crisisInteractions").insertOne({
      _id: id,
      crisisId,
      decisionTree: [
        {
          nodeId: "n1",
          type: "choice",
          requiredRoles: ["headOfState"],
          options: [{ optionId: "opt-a", label: "Hold the line", effects: [] }],
        },
      ],
      currentNodeId: "n1",
      resolutionPath: [],
      resolvedAt: null,
      leaderResponses: [],
      contributors: [],
      collectiveCurrent: 0,
    });
    ids.push(id);
  }
  return ids;
}

async function plantSurveyWorld(db: Db): Promise<void> {
  await db.collection("stateResourceCapacity").insertOne({
    stateId: "BE",
    countryId: "DD",
    resources: { coal: 100 },
  });
  await db.collection("federalBudget").insertOne({
    countryId: "DD",
    treasuryBalance: 1_000_000,
    gdp: 5_000_000,
  });
}

async function plantPendingChair(db: Db, seed: string): Promise<void> {
  const nominee = roleIds(seed, "us-fed-nominee");
  const executive = roleIds(seed, "us-president");
  await db.collection<BankDoc>("centralBanks").insertOne({
    _id: getBankId("US"),
    chairCharacterId: null,
    chairSelectionPending: {
      characterId: nominee.characterId,
      characterName: "Sim Nominee",
      pool: "political",
      proposedAt: NOW,
      proposedAtTurn: 0,
      appointedByExecutiveId: executive.characterId,
      declinedCharacterIds: [],
    },
    nominations: [],
    fomcBoard: [],
  });
}

describe("connected crisis seam (real submitCrisisDecision)", () => {
  it("decides a head-of-state node through the production path", async () => {
    const db = fakeDb();
    await materializeSyntheticActors(db, { seed: SEED, runId: "run-1", turn: 0, now: NOW });
    const [interactionId] = await plantChoiceCrisis(db, 1);
    const president = roleIds(SEED, "us-president");
    const presidentDoc = await db.collection("characters").findOne({ _id: president.characterId });
    const roles = await resolveCharacterRoles(db, {
      _id: president.characterId,
      currentOffice: (presidentDoc?.currentOffice ?? null) as { type?: string } | null,
      countryId: "US",
    });

    const { interaction } = await submitCrisisDecision(
      db,
      interactionId,
      "opt-a",
      president.characterId,
      "US",
      roles
    );
    expect(interaction.resolutionPath).toEqual(["opt-a"]);
    expect(interaction.resolvedAt).toBeInstanceOf(Date);

    // The manifest's turn-derived evidence counter sees the decision.
    expect(
      await db
        .collection("crisisInteractions")
        .countDocuments({ resolutionPath: { $exists: true, $ne: [] } })
    ).toBe(1);
  });
});

describe("connected survey seam (real launchGovernmentProspect)", () => {
  it("funds a DD national survey for the seated minister and moves the treasury", async () => {
    const db = fakeDb();
    await materializeSyntheticActors(db, { seed: SEED, runId: "run-1", turn: 0, now: NOW });
    await plantSurveyWorld(db);
    const minister = roleIds(SEED, "dd-finance-minister");

    const result = await launchGovernmentProspect(
      db,
      { countryId: "DD", stateId: "BE", resource: "coal" as never, level: "national" },
      { characterId: minister.characterId, userId: minister.userId.toString(), isAdmin: false },
      0,
      NOW
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.status).toBe(200);
    expect(result.survey.initiatorType).toBe("national_government");
    expect(await db.collection("prospectingSurveys").countDocuments({ status: "active" })).toBe(1);
    const budget = await db.collection("federalBudget").findOne({ countryId: "DD" });
    expect(budget?.treasuryBalance).toBe(1_000_000 - result.costs.costLocal);
  });

  it("refuses the same survey to an unauthorized bystander (403, nothing written)", async () => {
    const db = fakeDb();
    await materializeSyntheticActors(db, { seed: SEED, runId: "run-1", turn: 0, now: NOW });
    await plantSurveyWorld(db);
    const founder = roleIds(SEED, "us-founder-private");

    const result = await launchGovernmentProspect(
      db,
      { countryId: "DD", stateId: "BE", resource: "coal" as never, level: "national" },
      { characterId: founder.characterId, userId: founder.userId.toString(), isAdmin: false },
      0,
      NOW
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(403);
    expect(await db.collection("prospectingSurveys").countDocuments({})).toBe(0);
  });
});

describe("connected chair seam (real acceptCentralBankChairSelection)", () => {
  it("seats the pending synthetic nominee and clears the appointment", async () => {
    const db = fakeDb();
    await materializeSyntheticActors(db, { seed: SEED, runId: "run-1", turn: 0, now: NOW });
    await plantPendingChair(db, SEED);
    const nominee = roleIds(SEED, "us-fed-nominee");

    const result = await acceptCentralBankChairSelection(db, "US", nominee.characterId, NOW, 0);
    expect(result.ok).toBe(true);

    const bank = await db.collection<CentralBank>("centralBanks").findOne({ _id: getBankId("US") });
    expect(bank?.chairCharacterId).toEqual(nominee.characterId);
    expect(bank?.chairSelectionPending).toBeNull();
    expect(bank?.chairMode).toBe("character");
  });

  it("rejects an acceptance with no pending appointment", async () => {
    const db = fakeDb();
    await materializeSyntheticActors(db, { seed: SEED, runId: "run-1", turn: 0, now: NOW });
    await db.collection<BankDoc>("centralBanks").insertOne({ _id: getBankId("US") });
    const nominee = roleIds(SEED, "us-fed-nominee");

    const result = await acceptCentralBankChairSelection(db, "US", nominee.characterId, NOW, 0);
    expect(result.ok).toBe(false);
  });
});

describe("bounded per-turn driver (real driveSyntheticActors)", () => {
  it("drives crisis, survey, and chair acceptance end to end in one pass", async () => {
    const db = fakeDb();
    plantRealOrg(db);
    await materializeSyntheticActors(db, { seed: SEED, runId: "run-1", turn: 0, now: NOW });
    await plantChoiceCrisis(db, 1);
    await plantSurveyWorld(db);
    await plantPendingChair(db, SEED);

    const out = await driveSyntheticActors(db, { seed: SEED, turn: 0, now: NOW });
    expect(out).toMatchObject({
      crisisDecided: true,
      surveyOk: true,
      surveyStatus: 200,
      chairAccepted: true,
    });
    expect(
      await db
        .collection("crisisInteractions")
        .countDocuments({ resolutionPath: { $exists: true, $ne: [] } })
    ).toBe(1);
    expect(await db.collection("prospectingSurveys").countDocuments({ status: "active" })).toBe(1);
    const bank = await db.collection<CentralBank>("centralBanks").findOne({ _id: getBankId("US") });
    expect(bank?.chairSelectionPending).toBeNull();
  });

  it("decides at most one crisis per turn (first success wins)", async () => {
    const db = fakeDb();
    await materializeSyntheticActors(db, { seed: SEED, runId: "run-1", turn: 0, now: NOW });
    await plantChoiceCrisis(db, 6);

    const out = await driveSyntheticActors(db, { seed: SEED, turn: 0, now: NOW });
    expect(out.crisisDecided).toBe(true);
    expect(
      await db.collection("crisisInteractions").countDocuments({ resolvedAt: { $ne: null } })
    ).toBe(1);
    expect(await db.collection("crisisInteractions").countDocuments({})).toBe(6);
  });

  it("stops surveying after the first acceptance", async () => {
    const db = fakeDb();
    await materializeSyntheticActors(db, { seed: SEED, runId: "run-1", turn: 0, now: NOW });
    await db.collection("stateResourceCapacity").insertOne({
      stateId: "BE",
      countryId: "DD",
      resources: { coal: 10, oil: 10, gas: 10, iron: 10, copper: 10 },
    });
    await db.collection("federalBudget").insertOne({
      countryId: "DD",
      treasuryBalance: 10_000_000,
      gdp: 50_000_000,
    });

    const out = await driveSyntheticActors(db, { seed: SEED, turn: 0, now: NOW });
    expect(out.surveyOk).toBe(true);
    expect(await db.collection("prospectingSurveys").countDocuments({})).toBe(1);
  });

  it("is a quiet no-op on an empty world (never throws, all flags false)", async () => {
    const db = fakeDb();
    await expect(
      driveSyntheticActors(db, { seed: SEED, turn: 0, now: NOW })
    ).resolves.toMatchObject({
      crisisDecided: false,
      surveyOk: false,
      surveyStatus: null,
      chairAccepted: false,
    });
  });
});
