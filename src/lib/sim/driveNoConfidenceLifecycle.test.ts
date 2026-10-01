/**
 * Identity-level UK no-confidence lifecycle test (issue #2103).
 *
 * Runs the synthetic opposition motion through the REAL production seams —
 * propose, query, vote, turn resolution — against a small in-memory sandbox
 * fixture (never a live database). The fixture seeds a formed UK government,
 * a 5-seat fixed-ballot chamber, and the deterministic ballot identities;
 * every lifecycle transition below executes production code, while the fake
 * only stores documents and applies the update operators production emits.
 *
 * Proven here: stable vote identity, activeVoteId linkage on every
 * in-flight turn, query visibility through closesOnTurn, deterministic
 * ballot identities/totals, exactly-once failed resolution with the sitting
 * PM retained, cabinet intact, formation formed, cooldown enforced, and a
 * loud MotionLostError when the motion leaves its query surface early.
 */

import { describe, expect, it, beforeEach, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/time/gameTime", () => ({ getGameTime: vi.fn() }));
vi.mock("@/lib/notifications", () => ({
  createNotification: vi.fn().mockResolvedValue(undefined),
  createNotifications: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/discordWebhooks", () => ({
  sendCountryGameEvent: vi.fn().mockResolvedValue(undefined),
  DISCORD_COLORS: { govCollapsed: 0, govFormed: 0 },
}));

import { getGameTime } from "@/lib/time/gameTime";
import { getLowerChamberOfficeType } from "@/lib/legislature/chamberOfficeType";
import {
  MotionLostError,
  MotionNotDueError,
  castPlannedBallot,
  probeNoConfidenceCooldown,
  proposeNoConfidenceMotion,
  resolveNoConfidenceMotion,
  snapshotNoConfidenceMotion,
} from "./driveNoConfidenceLifecycle";
import {
  buildNoConfidenceBallotPlan,
  buildNoConfidenceLifecycleReport,
  checkMotionRetention,
  checkTerminalResolution,
  noConfidenceClosesOnTurn,
  type NoConfidenceSnapshot,
} from "./noConfidenceLifecycle";

const SEED = "vonc-lifecycle-seed";
const PROPOSE_TURN = 100;
const EFFECTIVE_NOW = new Date("2026-01-01T00:00:00.000Z");

// ─── Minimal in-memory fixture ─────────────────────────────────────────────
// Stores documents by collection and applies the update operators production
// emits (plain $set/$inc/$unset with dotted paths, plus the $set pipeline
// `buildEmbeddedVoteTallyUpdate` produces). Only what the VONC path reads.

type Doc = Record<string, unknown>;

function isObjectId(value: unknown): value is ObjectId {
  return value instanceof ObjectId;
}

function valuesEqual(a: unknown, b: unknown): boolean {
  if (isObjectId(a) && isObjectId(b)) return a.equals(b);
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  return a === b;
}

function getPath(doc: Doc, path: string): unknown {
  const parts = path.split(".");
  let current: unknown = doc;
  for (const part of parts) {
    if (current == null || typeof current !== "object") return undefined;
    current = (current as Doc)[part];
  }
  return current;
}

function setPath(doc: Doc, path: string, value: unknown): void {
  const parts = path.split(".");
  let current: Doc = doc;
  for (let i = 0; i < parts.length - 1; i++) {
    const existing = current[parts[i]];
    if (existing == null || typeof existing !== "object" || Array.isArray(existing)) {
      current[parts[i]] = {};
    }
    current = current[parts[i]] as Doc;
  }
  current[parts[parts.length - 1]] = value;
}

function deletePath(doc: Doc, path: string): void {
  const parts = path.split(".");
  let current: Doc = doc;
  for (let i = 0; i < parts.length - 1; i++) {
    const next = current[parts[i]];
    if (next == null || typeof next !== "object") return;
    current = next as Doc;
  }
  delete current[parts[parts.length - 1]];
}

function matchesFilter(doc: Doc, filter: Doc): boolean {
  for (const [key, condition] of Object.entries(filter)) {
    if (key === "$or") {
      const clauses = condition as Doc[];
      if (!clauses.some((clause) => matchesFilter(doc, clause))) return false;
      continue;
    }
    const actual = getPath(doc, key);
    if (
      condition != null &&
      typeof condition === "object" &&
      !isObjectId(condition) &&
      !(condition instanceof Date) &&
      !Array.isArray(condition)
    ) {
      const ops = condition as Doc;
      for (const [op, operand] of Object.entries(ops)) {
        if (op === "$in") {
          const list = operand as unknown[];
          if (!list.some((item) => valuesEqual(actual, item))) return false;
        } else if (op === "$ne") {
          if (valuesEqual(actual, operand)) return false;
        } else if (op === "$exists") {
          if ((actual !== undefined) !== Boolean(operand)) return false;
        } else {
          return false;
        }
      }
      continue;
    }
    if (condition === null) {
      if (actual !== null && actual !== undefined) return false;
      continue;
    }
    if (!valuesEqual(actual, condition)) return false;
  }
  return true;
}

function evalPipelineExpr(expr: unknown, doc: Doc): unknown {
  if (expr == null || typeof expr !== "object" || expr instanceof Date || isObjectId(expr)) {
    if (typeof expr === "string" && expr.startsWith("$")) return getPath(doc, expr.slice(1));
    return expr;
  }
  if (Array.isArray(expr)) return expr.map((item) => evalPipelineExpr(item, doc));
  const record = expr as Doc;
  if ("$mergeObjects" in record) {
    const merged: Doc = {};
    for (const part of record["$mergeObjects"] as unknown[]) {
      Object.assign(merged, evalPipelineExpr(part, doc) as Doc);
    }
    return merged;
  }
  if ("$ifNull" in record) {
    const [value, fallback] = record["$ifNull"] as unknown[];
    const resolved = evalPipelineExpr(value, doc);
    return resolved === null || resolved === undefined ? evalPipelineExpr(fallback, doc) : resolved;
  }
  if ("$getField" in record) {
    const { field, input } = record["$getField"] as { field: string; input: unknown };
    const source = evalPipelineExpr(input, doc) as Doc | null | undefined;
    return source == null ? null : (source[field] ?? null);
  }
  if ("$add" in record) {
    return (record["$add"] as unknown[]).reduce<number>(
      (sum, item) => sum + Number(evalPipelineExpr(item, doc)),
      0
    );
  }
  if ("$cond" in record) {
    const [cond, then, otherwise] = record["$cond"] as unknown[];
    return evalPipelineExpr(cond, doc)
      ? evalPipelineExpr(then, doc)
      : evalPipelineExpr(otherwise, doc);
  }
  if ("$eq" in record) {
    const [a, b] = record["$eq"] as unknown[];
    return valuesEqual(evalPipelineExpr(a, doc), evalPipelineExpr(b, doc));
  }
  const out: Doc = {};
  for (const [key, value] of Object.entries(record)) out[key] = evalPipelineExpr(value, doc);
  return out;
}

function applyPlainUpdate(doc: Doc, update: Doc): void {
  if (update.$set) {
    for (const [path, value] of Object.entries(update.$set as Doc)) setPath(doc, path, value);
  }
  if (update.$inc) {
    for (const [path, amount] of Object.entries(update.$inc as Doc)) {
      setPath(doc, path, Number(getPath(doc, path) ?? 0) + Number(amount));
    }
  }
  if (update.$unset) {
    for (const path of Object.keys(update.$unset as Doc)) deletePath(doc, path);
  }
}

function applyUpdate(doc: Doc, update: Doc | Doc[]): void {
  if (Array.isArray(update)) {
    // One $set stage evaluates every expression against the stage's INPUT
    // document (production aggregation semantics): a later expression must
    // not observe a sibling field written earlier in the same stage (the
    // vote-tally pipeline reads the pre-write vote map to decide its
    // increment, so sequential application would wrongly net every vote
    // to zero).
    for (const stage of update) {
      if (stage.$set) {
        const evaluated: Array<[string, unknown]> = [];
        for (const [path, expr] of Object.entries(stage.$set as Doc)) {
          evaluated.push([path, evalPipelineExpr(expr, doc)]);
        }
        for (const [path, value] of evaluated) setPath(doc, path, value);
      } else {
        throw new Error(`fixture: unsupported pipeline stage ${Object.keys(stage).join(",")}`);
      }
    }
    return;
  }
  applyPlainUpdate(doc, update);
}

interface Cursor {
  sort(spec: Doc): Cursor;
  limit(n: number): Cursor;
  project(spec: Doc): Cursor;
  toArray(): Promise<Doc[]>;
}

function makeDb(initial: Record<string, Doc[]>, databaseName: string): Db {
  const store: Record<string, Doc[]> = Object.fromEntries(
    Object.entries(initial).map(([name, docs]) => [name, [...docs]])
  );
  const keyOf = (id: unknown) => String(id);
  const collection = (name: string) => {
    const docs = () => (store[name] ??= []);
    const api = {
      findOne: async (filter: Doc = {}) => docs().find((d) => matchesFilter(d, filter)) ?? null,
      find: (filter: Doc = {}) => {
        let rows = docs().filter((d) => matchesFilter(d, filter));
        const cursor: Cursor = {
          sort: (spec: Doc) => {
            const [[field, dir]] = Object.entries(spec);
            rows = [...rows].sort((a, b) => {
              const av = getPath(a, field) as number;
              const bv = getPath(b, field) as number;
              return (av < bv ? -1 : av > bv ? 1 : 0) * Number(dir);
            });
            return cursor;
          },
          limit: (n: number) => {
            rows = rows.slice(0, n);
            return cursor;
          },
          project: () => cursor,
          toArray: async () => rows,
        };
        return cursor;
      },
      insertOne: async (doc: Doc) => {
        docs().push(doc);
        return { insertedId: doc._id };
      },
      updateOne: async (filter: Doc, update: Doc | Doc[]) => {
        const doc = docs().find((d) => matchesFilter(d, filter));
        if (!doc) return { matchedCount: 0, modifiedCount: 0 };
        applyUpdate(doc, update);
        return { matchedCount: 1, modifiedCount: 1 };
      },
      updateMany: async (filter: Doc, update: Doc | Doc[]) => {
        let count = 0;
        for (const doc of docs().filter((d) => matchesFilter(d, filter))) {
          applyUpdate(doc, update);
          count++;
        }
        return { matchedCount: count, modifiedCount: count };
      },
      findOneAndUpdate: async (filter: Doc, update: Doc | Doc[]) => {
        const doc = docs().find((d) => matchesFilter(d, filter));
        if (!doc) return null;
        applyUpdate(doc, update);
        return doc;
      },
      deleteOne: async (filter: Doc) => {
        const rows = docs();
        const index = rows.findIndex((d) => matchesFilter(d, filter));
        if (index < 0) return { deletedCount: 0 };
        rows.splice(index, 1);
        return { deletedCount: 1 };
      },
      deleteMany: async (filter: Doc) => {
        const rows = docs();
        const kept = rows.filter((d) => !matchesFilter(d, filter));
        const deleted = rows.length - kept.length;
        store[name] = kept;
        return { deletedCount: deleted };
      },
      countDocuments: async (filter: Doc = {}) =>
        docs().filter((d) => matchesFilter(d, filter)).length,
    };
    return api;
  };
  void keyOf;
  return { databaseName, collection } as unknown as Db;
}

const plan = buildNoConfidenceBallotPlan(SEED);
const pmId = new ObjectId("111111111111111111111111");
const chamberKey = getLowerChamberOfficeType("UK", "1979-default");

function voterChar(index: number, party: string): Doc {
  return {
    _id: new ObjectId(plan.voters[index].characterIdHex),
    name: `VONC Voter ${index}`,
    userId: new ObjectId(plan.voters[index].characterIdHex),
    countryId: "UK",
    party,
  };
}

function seedFixture(): Record<string, Doc[]> {
  return {
    gameConfig: [{ _id: "default", simSandbox: true }],
    gameState: [{ _id: "current", currentTurn: PROPOSE_TURN, preset: "1979-default" }],
    characters: [
      {
        _id: pmId,
        name: "Test PM",
        userId: new ObjectId("222222222222222222222222"),
        countryId: "UK",
        party: "1",
      },
      voterChar(0, "2"),
      voterChar(1, "2"),
      voterChar(2, "2"),
      voterChar(3, "1"),
      voterChar(4, "1"),
    ],
    electedOfficials: [0, 1, 2, 3, 4].map((index) => ({
      _id: new ObjectId(`33333333333333333333333${index}`),
      characterId: new ObjectId(plan.voters[index].characterIdHex),
      countryId: "UK",
      officeType: chamberKey,
      party: index < 3 ? "2" : "1",
      seatsHeld: 1,
    })),
    politicalParties: [
      { countryId: "UK", sequentialId: 1, name: "Government Party" },
      { countryId: "UK", sequentialId: 2, name: "Opposition Party" },
    ],
    governmentFormations: [
      {
        _id: "UK",
        countryId: "UK",
        status: "formed",
        formationType: "majority",
        pmCharacterId: pmId,
        pmName: "Test PM",
        governingPartyId: "1",
        coalitionId: null,
        coalitionPartyIds: null,
        majorityThreshold: 6,
        totalSeats: 10,
        seatsByParty: { "1": 2, "2": 3 },
        activeVoteId: null,
      },
    ],
    cabinetMembers: [0, 1, 2, 3].map((index) => ({
      _id: new ObjectId(`44444444444444444444444${index}`),
      countryId: "UK",
      positionId: `cabinet-seat-${index}`,
      characterId: pmId,
    })),
    noConfidenceVotes: [],
    pmAppointmentVotes: [],
    billWhips: [],
  };
}

let db: Db;

beforeEach(async () => {
  db = makeDb(seedFixture(), "ahd_sim_2103");
  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue(db);
  vi.mocked(getGameTime).mockResolvedValue({
    currentTurn: PROPOSE_TURN,
    lastTurnProcessed: EFFECTIVE_NOW,
    isActive: true,
    pausedAt: null,
    effectiveNow: EFFECTIVE_NOW,
    startingYear: 1979,
  });
  vi.clearAllMocks();
});

describe("UK no-confidence lifecycle through the real seams", () => {
  it("retains one stable identity through closesOnTurn into exactly-once failed resolution", async () => {
    // Proposal through the real command: stable id, deadline, linkage.
    const proposal = await proposeNoConfidenceMotion(db, SEED);
    expect(proposal.turnProposed).toBe(PROPOSE_TURN);
    expect(proposal.closesOnTurn).toBe(noConfidenceClosesOnTurn(PROPOSE_TURN));
    expect(proposal.targetPmName).toBe("Test PM");
    expect(proposal.proposerCharacterIdHex).toBe(plan.proposer.characterIdHex);

    // Fixed ballot through the real vote seam, in ballot order.
    const ballot = await castPlannedBallot(db, SEED, proposal.voteId);
    expect(ballot.receipts.map((r) => r.choice)).toEqual(["aye", "aye", "aye", "nay", "nay"]);
    expect(ballot.receipts.map((r) => r.characterIdHex)).toEqual(
      plan.voters.map((v) => v.characterIdHex)
    );
    expect([ballot.votesFor, ballot.votesAgainst]).toEqual([3, 2]);

    // In-flight snapshots: same identity, still active, still linked.
    const snapshots: NoConfidenceSnapshot[] = [];
    for (const turn of [PROPOSE_TURN, 110, 123]) {
      const snap = await snapshotNoConfidenceMotion(db, proposal.voteId, turn);
      expect(snap.voteId).toBe(proposal.voteId);
      expect(snap.status).toBe("active");
      expect(snap.activeVoteId).toBe(proposal.voteId);
      expect(snap.votesFor).toBe(3);
      expect(snap.votesAgainst).toBe(2);
      snapshots.push(snap);
    }
    expect(checkMotionRetention(proposal.voteId, proposal.closesOnTurn, snapshots).ok).toBe(true);

    // The deadline holds: resolution before closesOnTurn refuses.
    await expect(
      resolveNoConfidenceMotion(db, proposal.voteId, EFFECTIVE_NOW, 123)
    ).rejects.toBeInstanceOf(MotionNotDueError);

    // Resolution through the real turn entry point: exactly one failed transition.
    const terminal = await resolveNoConfidenceMotion(
      db,
      proposal.voteId,
      EFFECTIVE_NOW,
      proposal.closesOnTurn
    );
    expect(terminal.status).toBe("failed");
    expect(terminal.votesFor).toBe(3);
    expect(terminal.votesAgainst).toBe(2);
    expect(terminal.closedAt).not.toBeNull();
    expect(terminal.government.formationStatus).toBe("formed");
    expect(terminal.government.pmCharacterId).toBe(pmId.toString());
    expect(terminal.government.pmName).toBe("Test PM");
    expect(terminal.government.cabinetMembers).toBe(4);
    expect(terminal.government.activeVoteId).toBeNull();
    expect(terminal.government.cooldownRemainingTurns).toBe(24);

    // One extra turn: the terminal record is retained (not deleted) and the
    // repeat resolution pass changes nothing — exactly once.
    const repeat = await resolveNoConfidenceMotion(
      db,
      proposal.voteId,
      EFFECTIVE_NOW,
      proposal.closesOnTurn + 1
    );
    expect(repeat.status).toBe("failed");
    expect(repeat.closedAt).toBe(terminal.closedAt);
    const terminalCheck = checkTerminalResolution({
      voteId: proposal.voteId,
      expectedOutcome: "failed",
      expectedVotesFor: 3,
      expectedVotesAgainst: 2,
      statusBeforeResolve: "active",
      statusAfterResolve: terminal.status,
      statusAfterExtraTurn: repeat.status,
      closedAt: terminal.closedAt,
      votesFor: terminal.votesFor,
      votesAgainst: terminal.votesAgainst,
      repeatPassNoop:
        repeat.closedAt === terminal.closedAt &&
        repeat.votesFor === terminal.votesFor &&
        repeat.votesAgainst === terminal.votesAgainst,
    });
    expect(terminalCheck.ok).toBe(true);

    // Cooldown holds from the resolving turn: re-proposal is rejected.
    const cooldown = await probeNoConfidenceCooldown(
      db,
      SEED,
      proposal.turnProposed,
      proposal.closesOnTurn
    );
    expect(cooldown.rejected).toBe(true);
    expect(cooldown.remainingTurns).toBe(24);
    expect(cooldown.message).toContain("more turn");

    // Pinned report distinguishes the three phases.
    const report = buildNoConfidenceLifecycleReport({
      voteId: proposal.voteId,
      seed: SEED,
      turnProposed: proposal.turnProposed,
      closesOnTurn: proposal.closesOnTurn,
      proposerCharacterIdHex: proposal.proposerCharacterIdHex,
      targetPmName: proposal.targetPmName,
      retention: checkMotionRetention(proposal.voteId, proposal.closesOnTurn, snapshots),
      terminal: terminalCheck,
      government: terminal.government,
      runUuid: "test-run",
      sourceCommit: "test-commit",
    });
    expect(report.proposalLines.join("\n")).toContain(proposal.voteId);
    expect(report.retentionLines.join("\n")).toContain("RETAINED");
    expect(report.terminalLines.join("\n")).toContain("RESOLVED");
  });

  it("fails loudly when the motion leaves its query surface before the deadline", async () => {
    const proposal = await proposeNoConfidenceMotion(db, SEED);
    await castPlannedBallot(db, SEED, proposal.voteId);
    await snapshotNoConfidenceMotion(db, proposal.voteId, PROPOSE_TURN);
    await db.collection("noConfidenceVotes").deleteOne({ _id: new ObjectId(proposal.voteId) });
    await expect(snapshotNoConfidenceMotion(db, proposal.voteId, 101)).rejects.toBeInstanceOf(
      MotionLostError
    );
  });

  it("refuses to seed the motion outside a sandbox world", async () => {
    const live = makeDb(seedFixture(), "ahd_live_game");
    await expect(proposeNoConfidenceMotion(live, SEED)).rejects.toThrow(
      "not a sandbox sim database"
    );
  });
});
