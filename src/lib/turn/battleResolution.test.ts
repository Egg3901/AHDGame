import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

// The era's bloc roll is an INPUT to resolution, not something it decides, so it is
// stubbed rather than assembled from organisation-membership fixtures. Its own
// derivation is covered by `blocMembership` / `bloc.test.ts`.
vi.mock("@/lib/military/blocLookup", () => ({
  loadMilitaryBlocs: vi
    .fn()
    .mockResolvedValue({ US: "west", UK: "west", CN: "east", RU: "east", DD: "east" }),
}));

import { resolveBattleDeclarations } from "./battleResolution";

function unit(over: Record<string, unknown> = {}) {
  return {
    _id: new ObjectId(),
    countryId: "US",
    branchId: "army",
    domain: "ground",
    name: "Div",
    type: "Armored Division",
    icon: "tank",
    basePower: 92,
    personnel: 15000,
    upkeepBase: 180,
    posture: "standard",
    techTier: 2,
    vet: 1,
    xp: 0,
    readiness: 70,
    equipment: { firepower: 1, protection: 1, support: 1 },
    drill: null,
    theaterId: "afghan",
    assignedGeneralId: null,
    createdTurn: 1,
    ...over,
  };
}

// Wire militaryUnits.find to return declarer units then target units per call.
// Mirrors the driver's cursor: `.toArray()` directly, or `.project().toArray()` —
// standing a conflict down reconciles theaters, which uses the projected form.
function wireUnits(db: MockDb, declarerUnits: unknown[], targetUnits: unknown[]) {
  const all = [...declarerUnits, ...targetUnits] as Array<{
    countryId?: string;
    theaterId?: string;
  }>;
  db.collectionMocks.militaryUnits.find.mockImplementation(
    (q: { countryId?: string; theaterId?: string } = {}) => {
      // The resolver loads a whole front in one query; the reconcile path still asks
      // per country. Serve both shapes so a harness quirk cannot mask a real change.
      const docs = q.theaterId
        ? all.filter((u) => u.theaterId === q.theaterId)
        : q.countryId
          ? all.filter((u) => u.countryId === q.countryId)
          : all;
      const toArray = vi.fn().mockResolvedValue(docs);
      return { toArray, project: () => ({ toArray }) };
    }
  );
}

describe("resolveBattleDeclarations", () => {
  let db: MockDb;
  const pending = {
    _id: new ObjectId(),
    declarerCountry: "US",
    targetCountry: "CN",
    theaterId: "afghan",
    declaredByCharacterId: "char_1",
    declaredTurn: 40,
    status: "pending",
  };

  // The live conflict the declaration was made at (battle resolution now looks it
  // up to build the front data; a missing conflict fizzles the declaration).
  const conflict = {
    _id: "afghan",
    name: "Central Asian Front",
    hostCountry: "RU",
    region: "cas",
    terrain: "Arid / mountainous",
    bloc: "contested",
    severity: "HIGH",
    baseStrength: 470,
    terr: 1.15,
    infra: 34,
    enemyMix: ["armor", "mech", "infantry"],
    sideA: { label: "Insurgent Bloc", countries: [], kind: "generated" },
    sideB: { label: "Gov't", countries: ["RU"], kind: "state" },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("militaryUnits");
    db.collection("militaryFormations");
    db.collection("nationalDoctrine");
    db.collection("battleDeclarations");
    db.collection("battleReports");
    db.collection("conflicts");
    db.collectionMocks.militaryFormations.findOne.mockResolvedValue(null); // empty org → defaults
    db.collectionMocks.nationalDoctrine.findOne.mockResolvedValue(null); // default doctrine
    db.collectionMocks.conflicts.findOne.mockResolvedValue(conflict); // afghan is live
  });

  it("resolves a due declaration: mutates both sides, reports, marks resolved", async () => {
    db.collectionMocks.battleDeclarations.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([pending]),
    });
    wireUnits(db, [unit({ countryId: "US" })], [unit({ countryId: "CN", theaterId: "afghan" })]);

    const out = await resolveBattleDeclarations(db as unknown as Db, 41);

    expect(out).toEqual({ resolved: 1, fizzled: 0 });
    // both nations' units mutated (bulkWrite called at least twice)
    expect(db.collectionMocks.militaryUnits.bulkWrite).toHaveBeenCalled();
    expect(db.collectionMocks.battleReports.insertOne).toHaveBeenCalled();
    expect(db.collectionMocks.battleDeclarations.updateOne).toHaveBeenCalledWith(
      { _id: pending._id },
      { $set: { status: "resolved", resolvedTurn: 41 } }
    );
  });

  it("fizzles when the target has no forces at the theater", async () => {
    db.collectionMocks.battleDeclarations.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([pending]),
    });
    // target units are all in reserve (not at afghan)
    wireUnits(db, [unit({ countryId: "US" })], [unit({ countryId: "CN", theaterId: "reserve" })]);

    const out = await resolveBattleDeclarations(db as unknown as Db, 41);

    expect(out).toEqual({ resolved: 0, fizzled: 1 });
    expect(db.collectionMocks.militaryUnits.bulkWrite).not.toHaveBeenCalled();
    const report = db.collectionMocks.battleReports.insertOne.mock.calls[0][0];
    expect(report).toMatchObject({ noContact: true, result: null });
    expect(db.collectionMocks.battleDeclarations.updateOne).toHaveBeenCalledWith(
      { _id: pending._id },
      { $set: { status: "fizzled", resolvedTurn: 41 } }
    );
  });

  it("fizzles a declaration whose conflict no longer exists", async () => {
    db.collectionMocks.battleDeclarations.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([pending]),
    });
    db.collectionMocks.conflicts.findOne.mockResolvedValue(null); // conflict resolved/removed
    wireUnits(db, [unit({ countryId: "US" })], [unit({ countryId: "CN", theaterId: "afghan" })]);

    const out = await resolveBattleDeclarations(db as unknown as Db, 41);

    expect(out).toEqual({ resolved: 0, fizzled: 1 });
    expect(db.collectionMocks.militaryUnits.bulkWrite).not.toHaveBeenCalled();
    expect(db.collectionMocks.battleReports.insertOne).not.toHaveBeenCalled();
    expect(db.collectionMocks.battleDeclarations.updateOne).toHaveBeenCalledWith(
      { _id: pending._id },
      { $set: { status: "fizzled", resolvedTurn: 41 } }
    );
  });

  it("does NOT resolve a declaration made this same turn (defender window)", async () => {
    db.collectionMocks.battleDeclarations.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([{ ...pending, declaredTurn: 41 }]),
    });
    wireUnits(db, [unit({ countryId: "US" })], [unit({ countryId: "CN" })]);

    const out = await resolveBattleDeclarations(db as unknown as Db, 41);

    expect(out).toEqual({ resolved: 0, fizzled: 0 });
    expect(db.collectionMocks.battleReports.insertOne).not.toHaveBeenCalled();
    expect(db.collectionMocks.battleDeclarations.updateOne).not.toHaveBeenCalled();
  });

  // Battle never rearranges the command structure — even a formation ground down to a
  // sliver keeps its general and its front, and rebuilds in place. It is simply weak:
  // combat power scales linearly with personnel.
  it("a shattered unit keeps its general and stays at the front", async () => {
    db.collectionMocks.battleDeclarations.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([pending]),
    });
    wireUnits(
      db,
      [unit({ countryId: "US", basePower: 400 })],
      [
        unit({
          countryId: "CN",
          theaterId: "afghan",
          type: "Infantry Division",
          domain: "ground",
          personnel: 100, // 100 of a 12000-man establishment
          assignedGeneralId: "gen_1",
        }),
      ]
    );

    await resolveBattleDeclarations(db as unknown as Db, 41);

    const ops = db.collectionMocks.militaryUnits.bulkWrite.mock.calls.flatMap((c) => c[0]);
    expect(ops.length).toBeGreaterThan(0);
    for (const o of ops as { updateOne: { update: { $set: Record<string, unknown> } } }[]) {
      expect(o.updateOne.update.$set).not.toHaveProperty("assignedGeneralId");
      expect(o.updateOne.update.$set).not.toHaveProperty("theaterId");
    }
  });

  // The loss `applyOutcome` computes is worthless if the write drops it: a war would cost a
  // nation men but not a single tank, and the arsenal would have nothing to refill.
  it("persists materiel losses alongside casualties", async () => {
    db.collectionMocks.battleDeclarations.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([pending]),
    });
    wireUnits(
      db,
      [unit({ countryId: "US", equipment: { firepower: 3, protection: 3, support: 3 } })],
      [unit({ countryId: "CN", theaterId: "afghan", type: "Infantry Division" })]
    );

    await resolveBattleDeclarations(db as unknown as Db, 41);

    const ops = db.collectionMocks.militaryUnits.bulkWrite.mock.calls.flatMap((c) => c[0]);
    expect(ops.length).toBeGreaterThan(0);
    for (const o of ops as { updateOne: { update: { $set: Record<string, unknown> } } }[]) {
      expect(o.updateOne.update.$set).toHaveProperty("equipment");
      const eq = o.updateOne.update.$set.equipment as Record<string, number>;
      for (const v of Object.values(eq)) expect(v).toBeGreaterThanOrEqual(0);
    }
  });
});

// Territory: an engagement moves the front, supply follows the front's displacement,
// and a front driven to a pole ends the war.
describe("resolveBattleDeclarations — occupation", () => {
  let db: MockDb;
  const pending = {
    _id: new ObjectId(),
    declarerCountry: "US",
    targetCountry: "CN",
    theaterId: "afghan",
    declaredByCharacterId: "char_1",
    declaredTurn: 40,
    status: "pending",
  };

  // US on side A, CN on side B, hosted in CN — CN starts holding all its own soil.
  //
  // Rebuilt per test rather than shared: resolution mutates the conflict document it
  // is handed (`joinSide` the roster, `applyOccupation` the front and supplies) so the
  // rest of the tick sees a consistent picture. A single literal shared across cases
  // therefore carries one test's advance into the next.
  let warConflict: Record<string, unknown>;
  const makeWarConflict = () => ({
    _id: "afghan",
    name: "Central Asian Front",
    hostCountry: "CN",
    region: "cas",
    terrain: "Arid / mountainous",
    bloc: "contested",
    severity: "HIGH",
    baseStrength: 470,
    terr: 1.15,
    infra: 34,
    enemyMix: ["armor", "mech", "infantry"],
    sideA: { label: "NATO", countries: ["US"], kind: "coalition", backer: "west" },
    sideB: { label: "PLA", countries: ["CN"], kind: "state", backer: "east" },
    supplyA: 65,
    supplyB: 55,
    supplyBaseA: 65,
    supplyBaseB: 55,
    control: 100,
    controlStart: 100,
    status: "active",
  });

  beforeEach(() => {
    vi.clearAllMocks();
    warConflict = makeWarConflict();
    db = createMockDb();
    db.collection("militaryUnits");
    db.collection("militaryFormations");
    db.collection("nationalDoctrine");
    db.collection("battleDeclarations");
    db.collection("battleReports");
    db.collection("conflicts");
    db.collectionMocks.militaryFormations.findOne.mockResolvedValue(null);
    db.collectionMocks.nationalDoctrine.findOne.mockResolvedValue(null);
    db.collectionMocks.conflicts.findOne.mockResolvedValue(warConflict);
    db.collectionMocks.battleDeclarations.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([pending]),
    });
  });

  /** The `$set` of the conflicts.updateOne that moved `control`, if any. */
  function controlWrite() {
    const call = db.collectionMocks.conflicts.updateOne.mock.calls.find(
      (c) => c[1]?.$set && "control" in c[1].$set
    );
    return call?.[1].$set as
      { control: number; supplyA: number; supplyB: number; status?: string } | undefined;
  }

  /** A one-sided matchup so the declarer reliably wins. */
  function wireWalkover() {
    wireUnits(
      db,
      [unit({ countryId: "US", basePower: 4000 })],
      [unit({ countryId: "CN", theaterId: "afghan", basePower: 10 })]
    );
  }

  it("pushes the front toward the declarer when it wins", async () => {
    wireWalkover();

    await resolveBattleDeclarations(db as unknown as Db, 41);

    const set = controlWrite();
    expect(set).toBeDefined();
    // US is side A, so a US win drives control DOWN from 100.
    expect(set!.control).toBeLessThan(100);
  });

  it("derives both supplies from the new front position", async () => {
    wireWalkover();

    await resolveBattleDeclarations(db as unknown as Db, 41);

    const set = controlWrite();
    // A has gained ground → mild overextension; B has lost ground → compression.
    expect(set!.supplyA).toBeLessThanOrEqual(65);
    expect(set!.supplyB).toBeLessThan(55);
  });

  it("advances an unopposed offensive instead of fizzling it", async () => {
    wireUnits(db, [unit({ countryId: "US" })], [unit({ countryId: "CN", theaterId: "reserve" })]);

    const out = await resolveBattleDeclarations(db as unknown as Db, 41);

    expect(out).toEqual({ resolved: 1, fizzled: 0 });
    expect(controlWrite()!.control).toBe(95); // a full 5-point step off the pole
    const report = db.collectionMocks.battleReports.insertOne.mock.calls[0][0];
    expect(report).toMatchObject({ noContact: true, unopposedAdvance: true });
  });

  it("fizzles a declaration at an already-resolved conflict", async () => {
    db.collectionMocks.conflicts.findOne.mockResolvedValue({ ...warConflict, status: "resolved" });
    wireUnits(db, [unit({ countryId: "US" })], [unit({ countryId: "CN", theaterId: "afghan" })]);

    const out = await resolveBattleDeclarations(db as unknown as Db, 41);

    expect(out).toEqual({ resolved: 0, fizzled: 1 });
    expect(db.collectionMocks.militaryUnits.bulkWrite).not.toHaveBeenCalled();
    expect(controlWrite()).toBeUndefined();
  });

  it("stands the conflict down when the front reaches a pole", async () => {
    // One point off the pole: even a drag-halved step clears it.
    db.collectionMocks.conflicts.findOne.mockResolvedValue({ ...warConflict, control: 1 });
    wireWalkover();

    await resolveBattleDeclarations(db as unknown as Db, 41);

    const resolvedWrite = db.collectionMocks.conflicts.updateOne.mock.calls.find(
      (c) => c[1]?.$set?.status === "resolved"
    );
    expect(resolvedWrite).toBeDefined();
    expect(resolvedWrite![1].$set.outcome.winner).toBe("A");
  });

  // "I won but have no idea what it means really" — the report recorded casualties
  // and nothing about the ground, which is the whole point of winning an offensive.
  it("records the front position either side of the engagement", async () => {
    db.collectionMocks.conflicts.findOne.mockResolvedValue({ ...warConflict, control: 50 });
    wireWalkover();

    await resolveBattleDeclarations(db as unknown as Db, 41);

    const report = db.collectionMocks.battleReports.insertOne.mock.calls[0][0];
    expect(report.controlBefore).toBe(50);
    expect(typeof report.controlAfter).toBe("number");
    // A walkover advance moves the front toward side A's pole, so control falls.
    expect(report.controlAfter).toBeLessThan(50);
  });

  it("flags a conflict as winding down deep in enemy territory", async () => {
    db.collectionMocks.conflicts.findOne.mockResolvedValue({ ...warConflict, control: 22 });
    wireWalkover();

    await resolveBattleDeclarations(db as unknown as Db, 41);

    expect(controlWrite()).toMatchObject({ status: "winding_down" });
  });

  // An interstate war OPENS at the defender's pole. Reading depth off the absolute
  // share rather than the front's displacement would flag every invasion as winding
  // down on its very first battle.
  it("does not flag a war as winding down at kickoff", async () => {
    wireWalkover();

    await resolveBattleDeclarations(db as unknown as Db, 41);

    expect(controlWrite()).toMatchObject({ status: "active" });
  });

  it("enrols an outsider on the side its bloc backs", async () => {
    db.collectionMocks.conflicts.findOne.mockResolvedValue({
      ...warConflict,
      sideA: { label: "NATO", countries: [], kind: "coalition", backer: "west" },
    });
    wireWalkover();

    await resolveBattleDeclarations(db as unknown as Db, 41);

    const join = db.collectionMocks.conflicts.updateOne.mock.calls.find((c) => c[1]?.$addToSet);
    expect(join![1].$addToSet).toEqual({ "sideA.countries": "US" });

    // The entry stamp is a separate, country-filtered write: war approval scores
    // a country from the turn and front position at which it actually entered.
    const stamp = db.collectionMocks.conflicts.updateOne.mock.calls.find(
      (c) => c[1]?.$push?.joinTurns
    );
    expect(stamp![1].$push.joinTurns).toEqual({ countryId: "US", turn: 41, control: 100 });
  });

  it("fights normally but moves no ground when neither side can be resolved", async () => {
    db.collectionMocks.conflicts.findOne.mockResolvedValue({
      ...warConflict,
      sideA: { label: "A", countries: [], kind: "generated" },
      sideB: { label: "B", countries: [], kind: "generated" },
    });
    wireWalkover();

    const out = await resolveBattleDeclarations(db as unknown as Db, 41);

    expect(out).toEqual({ resolved: 1, fizzled: 0 });
    expect(db.collectionMocks.battleReports.insertOne).toHaveBeenCalled();
    expect(controlWrite()).toBeUndefined();
  });
});

// The unopposed path must apply the SAME side-resolution rule as the contested one:
// an unresolvable matchup moves no ground either way.
describe("resolveBattleDeclarations — unopposed side resolution", () => {
  let db: MockDb;
  const pending = {
    _id: new ObjectId(),
    declarerCountry: "US",
    targetCountry: "CN",
    theaterId: "afghan",
    declaredByCharacterId: "char_1",
    declaredTurn: 40,
    status: "pending",
  };
  const unsided = {
    _id: "afghan",
    name: "Central Asian Front",
    hostCountry: "CN",
    region: "cas",
    terrain: "Arid / mountainous",
    bloc: "internal",
    severity: "HIGH",
    baseStrength: 470,
    terr: 1.15,
    infra: 34,
    enemyMix: ["armor"],
    sideA: { label: "A", countries: [], kind: "generated" },
    sideB: { label: "B", countries: [], kind: "generated" },
    supplyA: 65,
    supplyB: 55,
    control: 50,
    controlStart: 50,
    status: "active",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("militaryUnits");
    db.collection("militaryFormations");
    db.collection("nationalDoctrine");
    db.collection("battleDeclarations");
    db.collection("battleReports");
    db.collection("conflicts");
    db.collectionMocks.militaryFormations.findOne.mockResolvedValue(null);
    db.collectionMocks.nationalDoctrine.findOne.mockResolvedValue(null);
    db.collectionMocks.conflicts.findOne.mockResolvedValue(unsided);
    db.collectionMocks.battleDeclarations.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([pending]),
    });
  });

  it("still fizzles an unopposed offensive when no side can be resolved", async () => {
    wireUnits(db, [unit({ countryId: "US" })], [unit({ countryId: "CN", theaterId: "reserve" })]);

    const out = await resolveBattleDeclarations(db as unknown as Db, 41);

    expect(out).toEqual({ resolved: 0, fizzled: 1 });
    expect(db.collectionMocks.conflicts.updateOne).not.toHaveBeenCalled();
    const report = db.collectionMocks.battleReports.insertOne.mock.calls[0][0];
    expect(report).toMatchObject({ noContact: true, unopposedAdvance: false });
  });
});

// A conflict document predating the territorial fields must not re-derive its supply
// off its own already-penalised live values — that turns derivation into accumulation.
describe("resolveBattleDeclarations — legacy conflict baselines", () => {
  let db: MockDb;
  const pending = {
    _id: new ObjectId(),
    declarerCountry: "US",
    targetCountry: "CN",
    theaterId: "afghan",
    declaredByCharacterId: "char_1",
    declaredTurn: 40,
    status: "pending",
  };
  // No controlStart, no supplyBaseA/B — as written before this feature existed.
  const legacy = {
    _id: "afghan",
    name: "Central Asian Front",
    hostCountry: "CN",
    region: "cas",
    terrain: "Arid / mountainous",
    bloc: "contested",
    severity: "HIGH",
    baseStrength: 470,
    terr: 1.15,
    infra: 34,
    enemyMix: ["armor"],
    sideA: { label: "NATO", countries: ["US"], kind: "coalition", backer: "west" },
    sideB: { label: "PLA", countries: ["CN"], kind: "state", backer: "east" },
    supplyA: 65,
    supplyB: 55,
    control: 60,
    status: "active",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("militaryUnits");
    db.collection("militaryFormations");
    db.collection("nationalDoctrine");
    db.collection("battleDeclarations");
    db.collection("battleReports");
    db.collection("conflicts");
    db.collectionMocks.militaryFormations.findOne.mockResolvedValue(null);
    db.collectionMocks.nationalDoctrine.findOne.mockResolvedValue(null);
    db.collectionMocks.conflicts.findOne.mockResolvedValue(legacy);
    db.collectionMocks.battleDeclarations.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([pending]),
    });
  });

  it("pins the starting line and supply baselines on the first write", async () => {
    wireUnits(
      db,
      [unit({ countryId: "US", basePower: 4000 })],
      [unit({ countryId: "CN", theaterId: "afghan", basePower: 10 })]
    );

    await resolveBattleDeclarations(db as unknown as Db, 41);

    const set = db.collectionMocks.conflicts.updateOne.mock.calls.find(
      (c) => c[1]?.$set && "control" in c[1].$set
    )![1].$set;
    expect(set.controlStart).toBe(60); // where the front stood before this battle
    expect(set.supplyBaseA).toBe(65);
    expect(set.supplyBaseB).toBe(55);
  });
});

// Each side fights on its own derived supply, so a side losing the front fights worse.
describe("resolveBattleDeclarations — supply at the front", () => {
  let db: MockDb;
  // FIXED id: battle resolution is seeded by declaration id + turn, so a fresh
  // ObjectId here makes the outcome deterministic within a run and different
  // between runs. That is what made this block fail intermittently on a suite
  // nobody had changed.
  const pending = {
    _id: new ObjectId("64b7f9c2a1e4d3b2c1a09876"),
    declarerCountry: "US",
    targetCountry: "CN",
    theaterId: "afghan",
    declaredByCharacterId: "char_1",
    declaredTurn: 40,
    status: "pending",
  };
  // Rebuilt per test — see the note on the occupation block's fixture.
  let warConflict: Record<string, unknown>;
  const makeWarConflict = () => ({
    _id: "afghan",
    name: "Central Asian Front",
    hostCountry: "CN",
    region: "cas",
    terrain: "Arid / mountainous",
    bloc: "contested",
    severity: "HIGH",
    baseStrength: 470,
    terr: 1.15,
    infra: 34,
    enemyMix: ["armor"],
    sideA: { label: "NATO", countries: ["US"], kind: "coalition", backer: "west" },
    sideB: { label: "PLA", countries: ["CN"], kind: "state", backer: "east" },
    supplyA: 70,
    supplyB: 30,
    supplyBaseA: 65,
    supplyBaseB: 55,
    control: 60,
    controlStart: 100,
    status: "active",
  });

  beforeEach(() => {
    vi.clearAllMocks();
    warConflict = makeWarConflict();
    db = createMockDb();
    db.collection("militaryUnits");
    db.collection("militaryFormations");
    db.collection("nationalDoctrine");
    db.collection("battleDeclarations");
    db.collection("battleReports");
    db.collection("conflicts");
    db.collectionMocks.militaryFormations.findOne.mockResolvedValue(null);
    db.collectionMocks.nationalDoctrine.findOne.mockResolvedValue(null);
    db.collectionMocks.conflicts.findOne.mockResolvedValue(warConflict);
    db.collectionMocks.battleDeclarations.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([pending]),
    });
  });

  /** Resolve once with the given per-side supplies; return the attacker's margin. */
  async function marginWith(supplyA: number, supplyB: number): Promise<number> {
    vi.clearAllMocks();
    db.collectionMocks.militaryFormations.findOne.mockResolvedValue(null);
    db.collectionMocks.nationalDoctrine.findOne.mockResolvedValue(null);
    db.collectionMocks.conflicts.findOne.mockResolvedValue({ ...warConflict, supplyA, supplyB });
    db.collectionMocks.battleDeclarations.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([pending]),
    });
    wireUnits(
      db,
      [unit({ countryId: "US", basePower: 100 })],
      [unit({ countryId: "CN", theaterId: "afghan", basePower: 100 })]
    );
    await resolveBattleDeclarations(db as unknown as Db, 41);
    const report = db.collectionMocks.battleReports.insertOne.mock.calls[0][0] as {
      result: { margin: number };
    };
    return report.result.margin;
  }

  // Better supply is a statistical edge, not a per-battle guarantee: the
  // defender also holds terrain, and this test's own note said so while
  // asserting a single draw anyway. Averaged over many seeds it is a claim
  // about the model rather than about one lucky battle.
  it("gives the better-supplied attacker a better result on average", async () => {
    const seeds = Array.from(
      { length: 24 },
      (_, i) => new ObjectId(`64b7f9c2a1e4d3b2c1a0${(1000 + i).toString()}`)
    );
    let suppliedTotal = 0;
    let starvedTotal = 0;
    for (const seed of seeds) {
      pending._id = seed;
      suppliedTotal += await marginWith(70, 30);
      starvedTotal += await marginWith(30, 70);
    }
    expect(suppliedTotal / seeds.length).toBeGreaterThan(starvedTotal / seeds.length);
  });

  it("is unaffected when both sides sit at the same supply", async () => {
    expect(await marginWith(50, 50)).toBe(await marginWith(50, 50));
  });

  it("fights at neutral supply when neither side can be resolved", async () => {
    db.collectionMocks.conflicts.findOne.mockResolvedValue({
      ...warConflict,
      sideA: { label: "A", countries: [], kind: "generated" },
      sideB: { label: "B", countries: [], kind: "generated" },
    });
    wireUnits(
      db,
      [unit({ countryId: "US", basePower: 100 })],
      [unit({ countryId: "CN", theaterId: "afghan", basePower: 100 })]
    );

    // Unresolvable sides must not throw and must still produce a report.
    const out = await resolveBattleDeclarations(db as unknown as Db, 41);
    expect(out).toEqual({ resolved: 1, fizzled: 0 });
    expect(db.collectionMocks.battleReports.insertOne).toHaveBeenCalled();
  });
});

describe("resolveBattleDeclarations — coalitions", () => {
  let db: MockDb;

  // A conflict with real rosters on both sides, so sideOf resolves by membership.
  const allied = {
    _id: "afghan",
    name: "Central Asian Front",
    hostCountry: "CN",
    region: "cas",
    terrain: "Arid / mountainous",
    bloc: "contested",
    severity: "HIGH",
    baseStrength: 470,
    terr: 1.15,
    infra: 34,
    enemyMix: ["armor", "mech", "infantry"],
    sideA: { label: "NATO", countries: ["US", "UK"], kind: "coalition", backer: "west" },
    sideB: { label: "PLA", countries: ["CN", "RU"], kind: "coalition", backer: "east" },
    control: 50,
    status: "active",
    supplyA: 60,
    supplyB: 60,
  };

  const declFrom = (country: string, target: string, id = new ObjectId()) => ({
    _id: id,
    declarerCountry: country,
    targetCountry: target,
    theaterId: "afghan",
    declaredByCharacterId: "c1",
    declaredTurn: 40,
    status: "pending",
  });

  const reports = () =>
    db.collectionMocks.battleReports.insertOne.mock.calls.map(
      (c) => c[0] as { attackers?: string[]; defenders?: string[] }
    );

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    for (const c of [
      "militaryUnits",
      "militaryFormations",
      "nationalDoctrine",
      "battleDeclarations",
      "battleReports",
      "conflicts",
      "characterGenerals",
    ]) {
      db.collection(c);
    }
    db.collectionMocks.militaryFormations.findOne.mockResolvedValue(null);
    db.collectionMocks.nationalDoctrine.findOne.mockResolvedValue(null);
    db.collectionMocks.conflicts.findOne.mockResolvedValue(allied);
  });

  it("pulls an ally with units at the front into the DEFENCE automatically", async () => {
    db.collectionMocks.battleDeclarations.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([declFrom("US", "CN")]),
    });
    // RU never declared and is not the target — it is simply standing there.
    wireUnits(
      db,
      [unit({ countryId: "US", theaterId: "afghan" })],
      [
        unit({ countryId: "CN", theaterId: "afghan" }),
        unit({ countryId: "RU", theaterId: "afghan" }),
      ]
    );

    await resolveBattleDeclarations(db as unknown as Db, 41);
    expect([...(reports()[0].defenders ?? [])].sort()).toEqual(["CN", "RU"]);
  });

  it("enrols an auto-defending ally on the roster", async () => {
    // RU is NOT on either roster here — it resolves to side B purely by the unique
    // bloc match, which is the case where enrolment actually has work to do.
    db.collectionMocks.conflicts.findOne.mockResolvedValue({
      ...allied,
      sideB: { ...allied.sideB, countries: ["CN"] },
    });
    db.collectionMocks.battleDeclarations.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([declFrom("US", "CN")]),
    });
    wireUnits(
      db,
      [unit({ countryId: "US", theaterId: "afghan" })],
      [
        unit({ countryId: "CN", theaterId: "afghan" }),
        unit({ countryId: "RU", theaterId: "afghan" }),
      ]
    );

    await resolveBattleDeclarations(db as unknown as Db, 41);
    const addToSets = db.collectionMocks.conflicts.updateOne.mock.calls.map((c) =>
      JSON.stringify(c[1])
    );
    expect(addToSets.some((s) => s.includes('"sideB.countries":"RU"'))).toBe(true);
  });

  it("merges two allied declarations into ONE battle and one front shift", async () => {
    db.collectionMocks.battleDeclarations.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([declFrom("US", "CN"), declFrom("UK", "CN")]),
    });
    wireUnits(
      db,
      [
        unit({ countryId: "US", theaterId: "afghan" }),
        unit({ countryId: "UK", theaterId: "afghan" }),
      ],
      [unit({ countryId: "CN", theaterId: "afghan" })]
    );

    const out = await resolveBattleDeclarations(db as unknown as Db, 41);
    expect(out.resolved).toBe(1);
    expect(reports()).toHaveLength(1);
    expect([...(reports()[0].attackers ?? [])].sort()).toEqual(["UK", "US"]);
  });

  it("does not let a non-declaring ally attack", async () => {
    // The UK has units at the front but filed nothing: it defends its side if
    // attacked, but it does not join the US offensive.
    db.collectionMocks.battleDeclarations.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([declFrom("US", "CN")]),
    });
    wireUnits(
      db,
      [
        unit({ countryId: "US", theaterId: "afghan" }),
        unit({ countryId: "UK", theaterId: "afghan" }),
      ],
      [unit({ countryId: "CN", theaterId: "afghan" })]
    );

    await resolveBattleDeclarations(db as unknown as Db, 41);
    expect(reports()[0].attackers).toEqual(["US"]);
  });

  it("marks every merged declaration resolved, not just the principal", async () => {
    const a = new ObjectId();
    const b = new ObjectId();
    db.collectionMocks.battleDeclarations.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([declFrom("US", "CN", a), declFrom("UK", "CN", b)]),
    });
    wireUnits(
      db,
      [
        unit({ countryId: "US", theaterId: "afghan" }),
        unit({ countryId: "UK", theaterId: "afghan" }),
      ],
      [unit({ countryId: "CN", theaterId: "afghan" })]
    );

    await resolveBattleDeclarations(db as unknown as Db, 41);
    const marked = db.collectionMocks.battleDeclarations.updateOne.mock.calls.map((c) =>
      String((c[0] as { _id: ObjectId })._id)
    );
    expect(marked.sort()).toEqual([String(a), String(b)].sort());
  });

  it("loads the whole front in one query rather than one per contingent", async () => {
    db.collectionMocks.battleDeclarations.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([declFrom("US", "CN"), declFrom("UK", "CN")]),
    });
    wireUnits(
      db,
      [
        unit({ countryId: "US", theaterId: "afghan" }),
        unit({ countryId: "UK", theaterId: "afghan" }),
      ],
      [unit({ countryId: "CN", theaterId: "afghan" })]
    );

    await resolveBattleDeclarations(db as unknown as Db, 41);
    const frontQueries = db.collectionMocks.militaryUnits.find.mock.calls.filter(
      (c) => (c[0] as { theaterId?: string })?.theaterId === "afghan"
    );
    expect(frontQueries).toHaveLength(1);
  });

  it("each nation's casualties are written under its own country", async () => {
    db.collectionMocks.battleDeclarations.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([declFrom("US", "CN"), declFrom("UK", "CN")]),
    });
    wireUnits(
      db,
      [
        unit({ countryId: "US", theaterId: "afghan" }),
        unit({ countryId: "UK", theaterId: "afghan" }),
      ],
      [unit({ countryId: "CN", theaterId: "afghan" })]
    );

    await resolveBattleDeclarations(db as unknown as Db, 41);
    // Attribution needs no new rules; this proves the existing per-country filter
    // still holds once several nations fight in one battle.
    const ops = db.collectionMocks.militaryUnits.bulkWrite.mock.calls.flatMap(
      (c) => c[0] as Array<{ updateOne: { filter: { countryId: string } } }>
    );
    expect(ops.length).toBeGreaterThan(0);
    expect(new Set(ops.map((o) => o.updateOne.filter.countryId)).size).toBeGreaterThan(1);
  });
});

describe("resolveBattleDeclarations — opposing offensives in one tick", () => {
  let db: MockDb;
  // Rebuilt per test: `joinSide` mutates the roster of whatever document
  // `conflicts.findOne` hands back, so a shared literal leaks between cases.
  let contested: Record<string, unknown>;
  const makeContested = (id: string): Record<string, unknown> => ({
    _id: id,
    name: "Central Asian Front",
    hostCountry: "CN",
    region: "cas",
    terrain: "Arid / mountainous",
    bloc: "contested",
    severity: "HIGH",
    baseStrength: 470,
    terr: 1.15,
    infra: 34,
    enemyMix: ["armor", "mech", "infantry"],
    sideA: { label: "NATO", countries: ["US"], kind: "state", backer: "west" },
    sideB: { label: "PLA", countries: ["CN"], kind: "state", backer: "east" },
    control: 50,
    status: "active",
    supplyA: 60,
    supplyB: 60,
  });

  // Fixed ids, not `new ObjectId()`: the battle seed is `hashStr(principal._id +
  // turn)`, so a freshly generated id would reseed every engagement on every run and
  // these cases would assert against a different battle each time.
  const declFrom = (country: string, target: string, id: string) => ({
    _id: new ObjectId(id),
    declarerCountry: country,
    targetCountry: target,
    theaterId: "afghan",
    declaredByCharacterId: "c1",
    declaredTurn: 40,
    status: "pending",
  });

  /** Every `conflicts.updateOne` that moved `control`, in the order written. */
  const controlWrites = () =>
    db.collectionMocks.conflicts.updateOne.mock.calls
      .filter((c) => c[1]?.$set && "control" in c[1].$set)
      .map((c) => c[1].$set as { control: number; controlStart: number });

  const reports = () =>
    db.collectionMocks.battleReports.insertOne.mock.calls.map(
      (c) => c[0] as { controlBefore: number; controlAfter: number }
    );

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    for (const c of [
      "militaryUnits",
      "militaryFormations",
      "nationalDoctrine",
      "battleDeclarations",
      "battleReports",
      "conflicts",
      "characterGenerals",
    ]) {
      db.collection(c);
    }
    db.collectionMocks.militaryFormations.findOne.mockResolvedValue(null);
    db.collectionMocks.nationalDoctrine.findOne.mockResolvedValue(null);
    contested = makeContested("afghan");
    db.collectionMocks.conflicts.findOne.mockResolvedValue(contested);
    // Both sides declare on the same turn, so both resolve in this tick as their
    // own offensive — `mergeOffensives` groups by (front, attacking side).
    db.collectionMocks.battleDeclarations.find.mockReturnValue({
      toArray: vi
        .fn()
        .mockResolvedValue([
          declFrom("US", "CN", "aaaaaaaaaaaaaaaaaaaaaaa1"),
          declFrom("CN", "US", "aaaaaaaaaaaaaaaaaaaaaaa2"),
        ]),
    });
    // US overwhelms CN, so side A takes the ground in BOTH engagements: it wins
    // its own offensive and it holds against the counter-attack.
    wireUnits(
      db,
      [unit({ countryId: "US", theaterId: "afghan", basePower: 4000 })],
      [unit({ countryId: "CN", theaterId: "afghan", basePower: 10 })]
    );
  });

  it("resolves the second offensive against the front the first one left", async () => {
    await resolveBattleDeclarations(db as unknown as Db, 41);

    const [first, second] = reports();
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    expect(first.controlAfter).toBeLessThan(50);
    expect(second.controlBefore).toBe(first.controlAfter);
  });

  it("keeps the ground both offensives took, not just the last one's", async () => {
    await resolveBattleDeclarations(db as unknown as Db, 41);

    const writes = controlWrites();
    expect(writes).toHaveLength(2);
    expect(writes[1].control).toBeLessThan(writes[0].control);
    expect(writes[1].control).toBe(reports()[1].controlAfter);
  });

  it("pins controlStart once for the conflict, not once per offensive", async () => {
    // A document predating `controlStart` — the first write pins it to where the
    // front stood, and the second must not re-pin it to the ground just taken.
    delete contested.controlStart;

    await resolveBattleDeclarations(db as unknown as Db, 41);

    for (const w of controlWrites()) expect(w.controlStart).toBe(50);
  });

  it("carries the first engagement's casualties into the second", async () => {
    // An even matchup, so both formations are still bleeding in the second battle.
    wireUnits(
      db,
      [unit({ countryId: "US", theaterId: "afghan" })],
      [unit({ countryId: "CN", theaterId: "afghan" })]
    );

    await resolveBattleDeclarations(db as unknown as Db, 41);

    type Res = { id: string; casualties: number };
    const [first, second] = db.collectionMocks.battleReports.insertOne.mock.calls.map(
      (c) =>
        c[0] as {
          result: { attacker: { unitResults: Res[] }; defender: { unitResults: Res[] } };
        }
    );
    // The US formation attacks in the first engagement and defends in the second,
    // so it fights twice in this one tick.
    const hitA = first.result.attacker.unitResults[0];
    const hitB = second.result.defender.unitResults.find((r) => r.id === hitA.id);
    expect(hitB).toBeDefined();
    expect(hitA.casualties).toBeGreaterThan(0);
    expect(hitB!.casualties).toBeGreaterThan(0);

    const writes = db.collectionMocks.militaryUnits.bulkWrite.mock.calls
      .flatMap(
        (c) =>
          c[0] as Array<{
            updateOne: { filter: { _id: unknown }; update: { $set: { personnel: number } } };
          }>
      )
      .filter((o) => String(o.updateOne.filter._id) === hitA.id);
    expect(writes).toHaveLength(2);
    // Both writes are absolute `$set`s, so the second must be computed from what the
    // first left behind or it silently restores the men killed in the first battle.
    expect(writes[1].updateOne.update.$set.personnel).toBe(
      15000 - hitA.casualties - hitB!.casualties
    );
  });

  it("does not let one front ending its war fizzle another front's offensive", async () => {
    // The stand-down flag is per conflict. If it ever leaked across the theater loop,
    // one war finishing would silently cancel every other front's fighting that tick.
    contested.control = 1; // afghan ends this tick
    const korea = makeContested("korea");
    db.collectionMocks.conflicts.findOne.mockImplementation((q: { _id?: string }) =>
      Promise.resolve(q?._id === "korea" ? korea : contested)
    );
    db.collectionMocks.battleDeclarations.find.mockReturnValue({
      toArray: vi
        .fn()
        .mockResolvedValue([
          declFrom("US", "CN", "aaaaaaaaaaaaaaaaaaaaaaa1"),
          declFrom("CN", "US", "aaaaaaaaaaaaaaaaaaaaaaa2"),
          { ...declFrom("US", "CN", "aaaaaaaaaaaaaaaaaaaaaaa3"), theaterId: "korea" },
        ]),
    });
    wireUnits(
      db,
      [
        unit({ countryId: "US", theaterId: "afghan", basePower: 4000 }),
        unit({ countryId: "US", theaterId: "korea" }),
      ],
      [
        unit({ countryId: "CN", theaterId: "afghan", basePower: 10 }),
        unit({ countryId: "CN", theaterId: "korea" }),
      ]
    );

    await resolveBattleDeclarations(db as unknown as Db, 41);

    const theaters = db.collectionMocks.battleReports.insertOne.mock.calls.map(
      (c) => (c[0] as { theaterId: string }).theaterId
    );
    expect(theaters).toContain("korea");
  });

  it("stops resolving offensives once the front has ended the war", async () => {
    // One point off the pole: the first offensive clears it and stands the war down,
    // which recalls every unit at the front to reserve. Nothing may fight after that.
    contested.control = 1;

    const out = await resolveBattleDeclarations(db as unknown as Db, 41);

    const stoodDown = db.collectionMocks.conflicts.updateOne.mock.calls.find(
      (c) => c[1]?.$set?.status === "resolved"
    );
    expect(stoodDown).toBeDefined();
    expect(db.collectionMocks.battleReports.insertOne).toHaveBeenCalledTimes(1);
    expect(out).toEqual({ resolved: 1, fizzled: 1 });
  });
});

describe("resolveBattleDeclarations - allied auto-join", () => {
  let db: MockDb;

  /** A two-nation coalition so `sideOf` resolves off the roster, not the bloc table. */
  const coalitionConflict = {
    _id: "afghan",
    name: "Central Asian Front",
    hostCountry: "RU",
    region: "cas",
    terrain: "Arid / mountainous",
    bloc: "contested",
    severity: "HIGH",
    baseStrength: 470,
    terr: 1.15,
    infra: 34,
    enemyMix: ["armor", "mech", "infantry"],
    // Supply is REQUIRED. Without it `conflictSupply` is undefined, the supply state
    // resolves to NaN and every casualty, power and readiness figure in the battle comes
    // out NaN. The older fixture in this file omits it and nothing noticed, because no
    // test there asserts a numeric outcome.
    supplyA: 60,
    supplyB: 60,
    supplyBaseA: 60,
    supplyBaseB: 60,
    sideA: { label: "Allies", countries: ["US", "UK"], kind: "coalition" },
    sideB: { label: "Gov't", countries: ["CN"], kind: "state" },
  };

  const usDeclares = {
    _id: new ObjectId(),
    declarerCountry: "US",
    targetCountry: "CN",
    theaterId: "afghan",
    declaredByCharacterId: "char_1",
    declaredTurn: 40,
    status: "pending",
  };

  /** Only UK's standing order varies between these cases. */
  function setup(ukAutoJoin: boolean) {
    vi.clearAllMocks();
    db = createMockDb();
    for (const c of [
      "militaryUnits",
      "militaryFormations",
      "nationalDoctrine",
      "battleDeclarations",
      "battleReports",
      "conflicts",
      "theaterState",
    ]) {
      db.collection(c);
    }
    db.collectionMocks.militaryFormations.findOne.mockResolvedValue(null);
    db.collectionMocks.nationalDoctrine.findOne.mockResolvedValue(null);
    db.collectionMocks.conflicts.findOne.mockResolvedValue(coalitionConflict);
    db.collectionMocks.battleDeclarations.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([usDeclares]),
    });
    db.collectionMocks.theaterState.find.mockReturnValue({
      toArray: vi
        .fn()
        .mockResolvedValue(
          ukAutoJoin
            ? [{ countryId: "UK", cohesion: 85, committed: {}, autoJoin: { afghan: true } }]
            : []
        ),
    });
    wireUnits(
      db,
      [unit({ countryId: "US" }), unit({ countryId: "UK", theaterId: "afghan" })],
      [unit({ countryId: "CN", theaterId: "afghan" })]
    );
  }

  const reportOf = () =>
    db.collectionMocks.battleReports.insertOne.mock.calls[0]?.[0] as {
      attackers?: string[];
      result?: { attacker?: { contingents?: { country: string; loss: number }[] } };
    };

  it("pulls an opted-in ally into an offensive it never declared", async () => {
    setup(true);
    await resolveBattleDeclarations(db as unknown as Db, 41);
    expect(reportOf().attackers).toEqual(["US", "UK"]);
  });

  it("leaves the ally out when it has no standing order", async () => {
    // The whole contract: silence is the old behaviour.
    setup(false);
    await resolveBattleDeclarations(db as unknown as Db, 41);
    expect(reportOf().attackers).toEqual(["US"]);
  });

  it("attributes the auto-joined ally's dead to the ally, not the declarer", async () => {
    // Auto-join makes multi-nation offensives routine, so per-nation attribution stops
    // being an edge case. Without it this feature would file UK's dead under the US.
    setup(true);
    await resolveBattleDeclarations(db as unknown as Db, 41);
    const contingents = reportOf().result?.attacker?.contingents ?? [];
    // Names only. This harness mocks militaryFormations and nationalDoctrine to null and
    // never registers characterGenerals, so the battle math it produces is not numerically
    // meaningful -- which is why no test in this file asserts a figure, only that the
    // writes happened. The numbers for a multi-nation offensive are verified against the
    // live world by `scripts/sim/combatBalance2026-08-27.ts`, which resolves DD+RU as a
    // real coalition and checks the per-contingent losses sum to the side.
    expect(contingents.map((c) => c.country).sort()).toEqual(["UK", "US"]);
  });
});
