import { describe, it, expect, beforeEach } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import type { ConflictDoc } from "@/lib/db/types/conflict";
import { joinSide } from "../joinSide";

function conflict(over: Partial<ConflictDoc> = {}): ConflictDoc {
  return {
    _id: "war_us_ru_10",
    conflictId: 1,
    name: "Test War",
    hostCountry: "RU",
    region: "eeu",
    type: "interstate",
    sideA: { label: "US", countries: ["US"], kind: "state" },
    sideB: { label: "RU", countries: ["RU"], kind: "state" },
    bloc: "contested",
    terrain: "plains",
    severity: "MEDIUM",
    baseStrength: 320,
    supplyA: 80,
    supplyB: 80,
    terr: 1,
    infra: 50,
    enemyMix: [],
    intensity: 40,
    control: 100,
    controlStart: 100,
    status: "active",
    createdBy: "player",
    startTurn: 10,
    ...over,
  } as ConflictDoc;
}

let db: MockDb;

beforeEach(() => {
  db = createMockDb();
});

describe("joinSide", () => {
  it("enrols a country on the roster it fought for", async () => {
    const live = conflict();
    await joinSide(db as unknown as Db, live, "UK", "A", 42);
    expect(live.sideA.countries).toContain("UK");
  });

  /**
   * The exhaustion clock and the war-effort baseline are both per-country.
   * `treatyEntries` only covers allies pulled in by a treaty, so a country that
   * declares into an existing war has no entry record there — it would bill
   * from `conflict.startTurn` for a war it just walked into.
   */
  it("records the turn the country entered", async () => {
    const live = conflict();
    await joinSide(db as unknown as Db, live, "UK", "A", 42);
    expect(live.joinTurns).toEqual([{ countryId: "UK", turn: 42, control: 100 }]);
  });

  it("records where the front stood on entry, so a late joiner starts from neutral", async () => {
    const live = conflict({ control: 60 });
    await joinSide(db as unknown as Db, live, "UK", "A", 900);
    expect(live.joinTurns?.[0]).toEqual({ countryId: "UK", turn: 900, control: 60 });
  });

  it("persists the roster enrolment", async () => {
    const live = conflict();
    await joinSide(db as unknown as Db, live, "UK", "A", 42);
    const calls = db.collectionMocks["conflicts"]!.updateOne.mock.calls;
    expect(calls.some((c) => c[1]?.$addToSet?.["sideA.countries"] === "UK")).toBe(true);
  });

  /**
   * `$addToSet` compares whole objects, so it cannot dedupe an entry that
   * differs only by turn or control. Two callers enrolling the same country in
   * one turn from separately loaded copies of the conflict would each pass the
   * in-memory roster check and write a second stamp. The entry write is guarded
   * by a filter on the country instead, so the database enforces one stamp.
   */
  it("guards the entry write so a country can only ever be stamped once", async () => {
    const live = conflict();
    await joinSide(db as unknown as Db, live, "UK", "A", 42);
    const entryWrite = db.collectionMocks["conflicts"]!.updateOne.mock.calls.find(
      (c) => c[1]?.$push?.joinTurns
    );
    expect(entryWrite).toBeDefined();
    expect(entryWrite![0]).toMatchObject({ "joinTurns.countryId": { $ne: "UK" } });
    expect(entryWrite![1].$push.joinTurns).toEqual({ countryId: "UK", turn: 42, control: 100 });
  });

  it("does not re-stamp a country already on the roster", async () => {
    const live = conflict({ joinTurns: [{ countryId: "US", turn: 10, control: 100 }] });
    await joinSide(db as unknown as Db, live, "US", "A", 500);
    expect(live.joinTurns).toEqual([{ countryId: "US", turn: 10, control: 100 }]);
    // The early return means the conflicts collection is never even opened.
    expect(db.collectionMocks["conflicts"]?.updateOne.mock.calls ?? []).toHaveLength(0);
  });
});
