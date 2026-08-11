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
  const warConflict = {
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
  const pending = {
    _id: new ObjectId(),
    declarerCountry: "US",
    targetCountry: "CN",
    theaterId: "afghan",
    declaredByCharacterId: "char_1",
    declaredTurn: 40,
    status: "pending",
  };
  const warConflict = {
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

  // Same forces, same seed (the declaration id and turn are fixed) — only supply
  // differs, so the whole delta is the territorial feedback. Note this asserts the
  // EFFECT, not an absolute win: the defender also holds terrain, which a supply
  // edge does not automatically overcome.
  it("gives the better-supplied attacker a better result than a starved one", async () => {
    const supplied = await marginWith(70, 30);
    const starved = await marginWith(30, 70);
    expect(supplied).toBeGreaterThan(starved);
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
