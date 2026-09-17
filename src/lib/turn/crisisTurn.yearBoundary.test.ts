import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import type { Mock } from "vitest";
import type { Crisis } from "@/lib/db/types/crisis";
import { processCrisisTurn } from "./crisisTurn";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/wireEvent", () => ({ logWireEvent: vi.fn().mockResolvedValue(undefined) }));

type Row = Record<string, unknown>;

function getPath(row: Row, path: string): unknown {
  return path.split(".").reduce<unknown>((current, key) => {
    if (!current || typeof current !== "object") return undefined;
    return (current as Row)[key];
  }, row);
}

function equalValue(left: unknown, right: unknown): boolean {
  if (left instanceof ObjectId && right instanceof ObjectId) return left.equals(right);
  return left === right;
}

function matchesCondition(actual: unknown, cond: unknown): boolean {
  if (cond !== null && typeof cond === "object" && !(cond instanceof ObjectId)) {
    const ops = cond as Row;
    if ("$exists" in ops) return (actual !== undefined) === (ops.$exists as boolean);
    if ("$in" in ops) return ((ops.$in as unknown[]) ?? []).some((v) => equalValue(actual, v));
    if ("$ne" in ops) return !equalValue(actual, ops.$ne);
    return false;
  }
  return equalValue(actual, cond);
}

function matches(row: Row, query: Row): boolean {
  return Object.entries(query ?? {}).every(([key, cond]) => {
    if (key === "$or" && Array.isArray(cond))
      return (cond as Row[]).some((sub) => matches(row, sub));
    return matchesCondition(getPath(row, key), cond);
  });
}

/**
 * Give a mock collection a minimal in-memory store so living-conflict state
 * persists across turns within one test: the replay guard
 * (`lastProcessedTurn === turn`) only holds when the save is visible again.
 */
function makeStateful(name: string, db: MockDb): Row[] {
  const rows: Row[] = [];
  const mock = db.collection(name) as unknown as {
    find: Mock;
    findOne: Mock;
    insertOne: Mock;
    updateOne: Mock;
    updateMany: Mock;
  };
  mock.find.mockImplementation((query: Row = {}) => {
    const matched = () => rows.filter((row) => matches(row, query));
    return {
      project: () => ({ toArray: async () => matched() }),
      toArray: async () => matched(),
    };
  });
  mock.findOne.mockImplementation(
    async (query: Row = {}) => rows.find((row) => matches(row, query)) ?? null
  );
  mock.insertOne.mockImplementation(async (doc: Row) => {
    const stored = { ...doc, _id: doc._id ?? new ObjectId() };
    rows.push(stored);
    return { insertedId: stored._id };
  });
  mock.updateOne.mockImplementation(
    async (filter: Row = {}, update: { $set?: Row } = {}, options?: { upsert?: boolean }) => {
      let row = rows.find((candidate) => matches(candidate, filter));
      if (!row && options?.upsert) {
        row = { ...filter };
        rows.push(row);
      }
      if (!row) return { modifiedCount: 0 };
      Object.assign(row, update.$set ?? {});
      return { modifiedCount: 1 };
    }
  );
  mock.updateMany.mockImplementation(async (filter: Row = {}, update: { $set?: Row } = {}) => {
    const hit = rows.filter((row) => matches(row, filter));
    for (const row of hit) Object.assign(row, update.$set ?? {});
    return { modifiedCount: hit.length };
  });
  return rows;
}

/** Persisted gameState as the turn loop leaves it mid-turn: year stamped last turn. */
function seedStaleGameState(db: MockDb, persistedYear: number): void {
  db.collection("gameState");
  db.collectionMocks.gameState.findOne.mockResolvedValue({
    _id: "current",
    currentYear: persistedYear,
    livingConflictsEnabled: true,
    conflictsEnabled: false,
    crisisInteractionEnabled: true,
    crisisAidBillsEnabled: false,
  });
}

async function setupWorld(
  persistedYear: number
): Promise<{ db: MockDb; crises: Row[]; conflicts: Row[] }> {
  const db = createMockDb();
  seedStaleGameState(db, persistedYear);
  const crises = makeStateful("crises", db);
  const conflicts = makeStateful("livingConflicts", db);
  const { getDb } = await import("@/lib/mongodb");
  (getDb as Mock).mockResolvedValue(db as unknown as Db);
  return { db, crises, conflicts };
}

function conflictState(conflicts: Row[], defKey: string): Row | undefined {
  return conflicts.find((row) => row.defKey === defKey);
}

function eventIds(crises: Row[]): Array<string | undefined> {
  return crises.map((row) => (row as unknown as Crisis).livingConflictEventId);
}

const SUEZ_ENTRY = "suez_aftermath:canal_settlement:193:canal_settlement_entry";
const OIL_ENTRY = "oil_disruption:shipping_shock:193:shipping_shock_entry";

describe("processCrisisTurn year boundary (#2059)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("leaves 1956-gated conflicts closed on the last 1955 turn", async () => {
    const { db, conflicts } = await setupWorld(1955);

    await processCrisisTurn(db as unknown as Db, 192, 1955);

    expect(conflictState(conflicts, "suez_aftermath")).toBeUndefined();
    expect(conflictState(conflicts, "oil_disruption")).toBeUndefined();
  });

  it("opens Suez and oil disruption on the first 1956 turn while persisted year is still 1955", async () => {
    const { db, crises, conflicts } = await setupWorld(1955);

    await processCrisisTurn(db as unknown as Db, 192, 1955);
    await processCrisisTurn(db as unknown as Db, 193, 1956);

    for (const defKey of ["suez_aftermath", "oil_disruption"]) {
      const state = conflictState(conflicts, defKey);
      expect(state?.hasOpened).toBe(true);
      expect(state?.openedYear).toBe(1956);
      expect(state?.lastProcessedTurn).toBe(193);
    }
    const ids = eventIds(crises);
    expect(ids).toContain(SUEZ_ENTRY);
    expect(ids).toContain(OIL_ENTRY);
    for (const crisis of crises as unknown as Crisis[]) {
      if (
        crisis.livingConflictEventId === SUEZ_ENTRY ||
        crisis.livingConflictEventId === OIL_ENTRY
      ) {
        expect(crisis.startTurn).toBe(193);
      }
    }
  });

  it("does not double-open on replay or the following turn", async () => {
    const { db, crises, conflicts } = await setupWorld(1955);

    await processCrisisTurn(db as unknown as Db, 192, 1955);
    await processCrisisTurn(db as unknown as Db, 193, 1956);
    const opened = eventIds(crises).filter((id) => id === SUEZ_ENTRY || id === OIL_ENTRY);
    expect(opened).toHaveLength(2);

    // Replay the boundary turn, then advance with the stamped year.
    await processCrisisTurn(db as unknown as Db, 193, 1956);
    seedStaleGameState(db, 1956);
    const { getDb } = await import("@/lib/mongodb");
    (getDb as Mock).mockResolvedValue(db as unknown as Db);
    await processCrisisTurn(db as unknown as Db, 194, 1956);

    const after = eventIds(crises).filter((id) => id === SUEZ_ENTRY || id === OIL_ENTRY);
    expect(after).toHaveLength(2);
    for (const defKey of ["suez_aftermath", "oil_disruption"]) {
      expect(conflictState(conflicts, defKey)?.lastProcessedTurn).toBe(194);
    }
  });

  it("opens Vietnam on the first 1955 turn", async () => {
    const { db, crises, conflicts } = await setupWorld(1954);

    await processCrisisTurn(db as unknown as Db, 144, 1954);
    expect(conflictState(conflicts, "vietnam")).toBeUndefined();

    await processCrisisTurn(db as unknown as Db, 145, 1955);

    const state = conflictState(conflicts, "vietnam");
    expect(state?.hasOpened).toBe(true);
    expect(state?.lastProcessedTurn).toBe(145);
    const ids = eventIds(crises);
    expect(ids).toContain("vietnam:advisors:145:advisors_entry");

    // Replay is idempotent: no second entry crisis.
    await processCrisisTurn(db as unknown as Db, 145, 1955);
    expect(
      eventIds(crises).filter((id) => id === "vietnam:advisors:145:advisors_entry")
    ).toHaveLength(1);
  });

  it("falls back to the persisted year when no authoritative year is passed", async () => {
    const { db, conflicts } = await setupWorld(1955);

    await processCrisisTurn(db as unknown as Db, 193);

    expect(conflictState(conflicts, "suez_aftermath")).toBeUndefined();
    expect(conflictState(conflicts, "oil_disruption")).toBeUndefined();
  });
});
