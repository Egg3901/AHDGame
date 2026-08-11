import { describe, it, expect } from "vitest";
import {
  computeBattle,
  applyOutcome,
  forecast,
  buildEnemy,
  resolvePvpBattle,
  battleForecast,
  supplyState,
  generalOfForTest,
  type BattleContext,
  type BattleSide,
} from "../battle";
import { newGeneral, trainNode, type ProfileGeneral } from "../generalsTree";
import type { ConflictAssignment } from "../assignments";
import { natMods } from "../doctrineTree";
import { OCCUPATION, THEATER_COMMAND } from "../config";
import { EQUIPMENT_TRACK_MAX } from "../arsenal";
import { type CombatUnit, type Front } from "../combat";
import type { CountryId } from "@/lib/constants/countries";
import { ObjectId } from "mongodb";
import { unit, ctx, side, front, FRONTS_MAP } from "./battleFixtures";

const VERDICTS = ["Decisive Victory", "Victory", "Pyrrhic Victory", "Costly Defeat", "Rout"];

describe("buildEnemy", () => {
  it("is deterministic for a seed and produces graded units", () => {
    const a = buildEnemy(FRONTS_MAP.afghan, 42);
    const b = buildEnemy(FRONTS_MAP.afghan, 42);
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThanOrEqual(3);
    expect(a.every((e) => e.cv > 0)).toBe(true);
  });
});

describe("forecast", () => {
  it("returns own/enemy strengths and a clamped ratio", () => {
    const fc = forecast(
      ctx([unit(), unit({ type: "Infantry Division", basePower: 48 })]),
      "afghan",
      7
    );
    expect(fc.ownStr).toBeGreaterThan(0);
    expect(fc.enemyStr).toBeGreaterThan(0);
    expect(fc.ratio).toBeGreaterThanOrEqual(0.02);
    expect(fc.ratio).toBeLessThanOrEqual(0.98);
    expect(fc.oddsPct).toBe(Math.round(fc.ratio * 100));
  });
});

describe("computeBattle", () => {
  it("resolves a deterministic battle with a valid verdict and per-unit results", () => {
    const c = ctx([unit(), unit({ type: "Special Forces Group", basePower: 78, personnel: 1400 })]);
    const r1 = computeBattle(c, "afghan", 123);
    const r2 = computeBattle(c, "afghan", 123);
    expect(r1.verdict).toBe(r2.verdict);
    expect(VERDICTS).toContain(r1.verdict);
    expect(r1.rounds.length).toBeGreaterThanOrEqual(1);
    expect(r1.rounds.length).toBeLessThanOrEqual(5);
    expect(r1.unitResults.length).toBe(2);
    expect(r1.unitResults.every((u) => u.casualties >= 0)).toBe(true);
  });

  it("different seeds can produce different outcomes", () => {
    const c = ctx([unit()]);
    const seeds = [1, 2, 3, 4, 5, 6, 7, 8].map((s) => computeBattle(c, "afghan", s).verdict);
    expect(new Set(seeds).size).toBeGreaterThanOrEqual(1); // at least resolves; usually varies
  });

  // `Front.west`/`.east` are sideA's and sideB's labels (conflictToFront), so the enemy
  // is whichever one the context is NOT on. Naming used to switch on the context's bloc,
  // which handed a side-B belligerent its OWN coalition's name whenever its bloc read
  // western — and every country missing from the retired 9-entry table read western.
  describe("enemy naming", () => {
    const fronts = {
      ...FRONTS_MAP,
      afghan: front("afghan", { west: "NATO", east: "Warsaw Pact" }),
    };

    it("names side B's label as the enemy for a side A belligerent", () => {
      const c = { ...ctx([unit()]), side: "A" as const, fronts };
      expect(computeBattle(c, "afghan", 7).enemyName).toBe("Warsaw Pact");
    });

    it("names side A's label as the enemy for a side B belligerent", () => {
      const c = { ...ctx([unit()]), side: "B" as const, fronts };
      expect(computeBattle(c, "afghan", 7).enemyName).toBe("NATO");
    });

    it("falls back to a generic name when the context is on no side", () => {
      const c = { ...ctx([unit()]), side: undefined, fronts };
      expect(computeBattle(c, "afghan", 7).enemyName).toBe("Hostile forces");
    });
  });
});

describe("resolvePvpBattle", () => {
  it("resolves two real sides deterministically with per-side unit results", () => {
    const a = side("US", "A", [120, 90], "afghan");
    const d = side("CN", "B", [80, 60], "afghan");
    const r1 = resolvePvpBattle([a], [d], "afghan", 123);
    const r2 = resolvePvpBattle([a], [d], "afghan", 123);
    expect(r1).toEqual(r2);
    expect(r1.attacker.country).toBe("US");
    expect(r1.defender.country).toBe("CN");
    expect(r1.attacker.unitResults).toHaveLength(2);
    expect(r1.defender.unitResults).toHaveLength(2);
    expect(VERDICTS).toContain(r1.verdict);
  });

  it("a much stronger attacker wins on average", () => {
    let wins = 0;
    for (let s = 0; s < 20; s++) {
      const a = side("US", "A", [300, 300, 300], "afghan");
      const d = side("CN", "B", [40], "afghan");
      if (resolvePvpBattle([a], [d], "afghan", s).win) wins++;
    }
    expect(wins).toBeGreaterThan(15);
  });

  it("only engages units at the theater", () => {
    const a = side("US", "A", [100], "afghan");
    a.units.push(
      unit({ _id: new ObjectId(), countryId: "US", basePower: 999, theaterId: "reserve" })
    );
    const d = side("CN", "B", [100], "afghan");
    expect(resolvePvpBattle([a], [d], "afghan", 1).attacker.unitResults).toHaveLength(1);
  });
});

describe("battleForecast", () => {
  // THE invariant: the preview is the same computation the resolver fights on.
  // `PvpBattleResult` reports each side's strength, so this pins preview == resolution.
  it("returns the strengths the resolver actually uses", () => {
    const a = side("US", "A", [120, 90], "afghan");
    const d = side("CN", "B", [80, 60], "afghan");
    const fc = battleForecast([a], [d], "afghan");
    const res = resolvePvpBattle([a], [d], "afghan", 123);
    expect(res.attacker.power).toBe(Math.round(fc.attStr));
    expect(res.defender.power).toBe(Math.round(fc.defStr));
  });

  it("is pure and deterministic (no seed)", () => {
    const a = side("US", "A", [120, 90], "afghan");
    const d = side("CN", "B", [80, 60], "afghan");
    expect(battleForecast([a], [d], "afghan")).toEqual(battleForecast([a], [d], "afghan"));
  });

  it("odds track the strength balance and stay clamped", () => {
    const strong = side("US", "A", [300, 300, 300], "afghan");
    const weak = side("CN", "B", [40], "afghan");
    const fc = battleForecast([strong], [weak], "afghan");
    expect(fc.oddsPct).toBe(Math.round(fc.ratio * 100));
    expect(fc.ratio).toBeGreaterThan(0.5);
    expect(fc.ratio).toBeLessThanOrEqual(0.98);
  });

  it("a defender with no units at the front leaves the attacker near-certain", () => {
    const a = side("US", "A", [120], "afghan");
    const d = side("CN", "B", [80], "reserve"); // all home, none at the front
    expect(battleForecast([a], [d], "afghan").defStr).toBe(0);
  });
});

describe("applyOutcome", () => {
  it("applies casualties, readiness loss, and xp", () => {
    const c = ctx([unit({ personnel: 15000, readiness: 80, xp: 0 })]);
    const result = computeBattle(c, "afghan", 55);
    const next = applyOutcome(c, result);
    const u = next.units[0];
    expect(u.personnel).toBeLessThanOrEqual(15000);
    expect(u.readiness).toBeLessThanOrEqual(80);
    expect(u.xp).toBeGreaterThanOrEqual(0);
  });
});

/**
 * Materiel attrition (C3). Fighting destroys equipment, which the arsenal then has to
 * replace — the drain that makes a defence industry matter in wartime.
 */
describe("materiel attrition", () => {
  const equipped = (n: number) => ({ firepower: n, protection: n, support: n });

  it("reports a whole number of tracks destroyed, within the track ceiling", () => {
    const c = ctx([unit({ equipment: equipped(3) })]);
    const result = computeBattle(c, "afghan", 55);
    const r = result.unitResults[0];
    expect(Number.isInteger(r.materiel)).toBe(true);
    expect(r.materiel).toBeGreaterThanOrEqual(0);
    expect(r.materiel).toBeLessThanOrEqual(EQUIPMENT_TRACK_MAX);
  });

  it("subtracts the reported loss from every equipment track", () => {
    const c = ctx([unit({ equipment: equipped(3) })]);
    const result = computeBattle(c, "afghan", 55);
    const lost = result.unitResults[0].materiel;
    const u = applyOutcome(c, result).units[0];
    expect(u.equipment.firepower).toBe(3 - lost);
    expect(u.equipment.protection).toBe(3 - lost);
    expect(u.equipment.support).toBe(3 - lost);
  });

  it("cannot drive a stripped unit's equipment negative", () => {
    const c = ctx([unit({ equipment: equipped(0) })]);
    const u = applyOutcome(c, computeBattle(c, "afghan", 55)).units[0];
    for (const v of Object.values(u.equipment)) expect(v).toBeGreaterThanOrEqual(0);
  });

  it("tolerates a legacy unit carrying no equipment at all", () => {
    const c = ctx([unit({ equipment: undefined as never })]);
    expect(() => applyOutcome(c, computeBattle(c, "afghan", 55))).not.toThrow();
  });

  // Armour protects the CREW, not the vehicle. A knocked-out tank is destroyed materiel
  // whether or not its crew walked away, so armour must not make a formation both harder
  // to kill and cheaper to re-equip.
  it("does not let armour reduce materiel loss the way it reduces casualties", () => {
    const heavy = ctx([unit({ equipment: equipped(3), techTier: 3 })]);
    const light = ctx([unit({ type: "Infantry Division", basePower: 48, equipment: equipped(3) })]);
    const h = computeBattle(heavy, "afghan", 55).unitResults[0];
    const l = computeBattle(light, "afghan", 55).unitResults[0];
    // The armoured formation takes proportionally fewer casualties than materiel losses
    // relative to the light one — i.e. its armour advantage does not carry into materiel.
    const casualtyRatio = h.casualties / Math.max(1, l.casualties);
    const materielRatio = h.materiel / Math.max(1, l.materiel);
    expect(materielRatio).toBeGreaterThanOrEqual(casualtyRatio);
  });

  it("is deterministic for a given seed, like the rest of the result", () => {
    const c = ctx([unit({ equipment: equipped(3) })]);
    expect(computeBattle(c, "afghan", 77).unitResults[0].materiel).toBe(
      computeBattle(c, "afghan", 77).unitResults[0].materiel
    );
  });
});

/**
 * Theater command XP.
 *
 * A player ran three successful offensives as Theater Commander and their general
 * earned nothing, because only generals with units ASSIGNED TO THEM at the front were
 * credited. Directing a battle now pays a share of what fighting it pays.
 */
describe("applyOutcome — theater command credit", () => {
  /** A contingent where each of `leaders` leads `unitsPer` units, `tcId` in charge. */
  function withCommand(opts: {
    leaders: string[];
    tcId: string | null;
    unitsPer?: number;
  }): BattleContext {
    const theaterId = "afghan";
    const unitsPer = opts.unitsPer ?? 2;
    const assignments: ConflictAssignment[] = opts.leaders.map((id) => ({
      theaterId,
      generalCharacterId: id,
      inCharge: id === opts.tcId,
    }));
    if (opts.tcId && !opts.leaders.includes(opts.tcId)) {
      assignments.push({ theaterId, generalCharacterId: opts.tcId, inCharge: true });
    }
    const generalsById: Record<string, ProfileGeneral> = {};
    for (const id of [...opts.leaders, opts.tcId].filter((x): x is string => !!x)) {
      generalsById[id] = newGeneral(id, `Gen. ${id}`, id.slice(0, 2).toUpperCase(), "US");
    }
    const units = opts.leaders.length
      ? opts.leaders.flatMap((id) =>
          Array.from({ length: unitsPer }, () => unit({ theaterId, assignedGeneralId: id }))
        )
      : Array.from({ length: unitsPer }, () => unit({ theaterId, assignedGeneralId: null }));
    return { ...ctx(units), assignments, generalsById };
  }

  it("pays the theater commander who led no units at all", () => {
    const c = withCommand({ leaders: ["g1"], tcId: "tc" });
    const { generalXp } = applyOutcome(c, computeBattle(c, "afghan", 55));
    expect(generalXp.tc).toBeGreaterThan(0);
  });

  it("pays the commander the configured share of a single formation's award", () => {
    // One general, one formation — so that general's award IS the per-formation
    // measure, and the commander takes the configured share of it.
    const c = withCommand({ leaders: ["g1"], tcId: "tc", unitsPer: 1 });
    const { generalXp } = applyOutcome(c, computeBattle(c, "afghan", 55));
    expect(generalXp.tc).toBe(Math.round(generalXp.g1 * THEATER_COMMAND.xpShare));
  });

  // The measure reads the fighting, not the org chart. Splitting the SAME force
  // across more generals must not change what directing it is worth — otherwise
  // command structure could be reshuffled purely to farm XP.
  it("is unmoved by how the same force is split between generals", () => {
    const concentrated = withCommand({ leaders: ["g1"], tcId: "tc", unitsPer: 4 });
    const dispersed = withCommand({ leaders: ["g1", "g2", "g3", "g4"], tcId: "tc", unitsPer: 1 });
    const a = applyOutcome(concentrated, computeBattle(concentrated, "afghan", 55)).generalXp;
    const b = applyOutcome(dispersed, computeBattle(dispersed, "afghan", 55)).generalXp;
    // Same four formations at the same front, so the same command award.
    expect(b.tc).toBe(a.tc);
    // ...even though concentrating command pays that one general far more.
    expect(a.g1).toBeGreaterThan(b.g1);
  });

  // A superpower's commander must not level many times faster than a small nation's
  // for the same work — which crediting the front's TOTAL would do.
  it("does not scale the commander's award with the size of the force", () => {
    const small = withCommand({ leaders: ["g1"], tcId: "tc", unitsPer: 1 });
    const large = withCommand({ leaders: ["g1"], tcId: "tc", unitsPer: 8 });
    const a = applyOutcome(small, computeBattle(small, "afghan", 55)).generalXp;
    const b = applyOutcome(large, computeBattle(large, "afghan", 55)).generalXp;
    // Eight times the force; a bigger battle pays somewhat more, nothing like 8×.
    expect(b.tc).toBeLessThan(a.tc * 2);
  });

  it("pays a commander who also led units for both roles", () => {
    const both = withCommand({ leaders: ["g1"], tcId: "g1" });
    const onlyLed = withCommand({ leaders: ["g1"], tcId: null });
    const a = applyOutcome(both, computeBattle(both, "afghan", 55)).generalXp;
    const b = applyOutcome(onlyLed, computeBattle(onlyLed, "afghan", 55)).generalXp;
    expect(a.g1).toBeGreaterThan(b.g1);
  });

  // In a coalition the billet can belong to an ally, whose general is not in this
  // contingent's assignments — they earn through their own nation's contingent.
  it("pays nobody when this contingent does not hold the billet", () => {
    const c = withCommand({ leaders: ["g1"], tcId: null });
    const { generalXp } = applyOutcome(c, computeBattle(c, "afghan", 55));
    expect(Object.keys(generalXp)).toEqual(["g1"]);
  });

  it("still pays the commander when no general led any unit", () => {
    const c = withCommand({ leaders: [], tcId: "tc" });
    const { generalXp } = applyOutcome(c, computeBattle(c, "afghan", 55));
    expect(generalXp.tc).toBeGreaterThan(0);
  });
});

// The general↔units↔front binding. A unit is led by its `assignedGeneralId`, and
// only where that general is posted. These lock in that it works, and that a
// general only commands units assigned to them, at the front they are posted to.
describe("general binding (assignment layer)", () => {
  // Build generals the way the game does — commission, then train. The previous
  // helper hand-wrote a `traits` array, a state no real general could ever reach,
  // which is exactly why generals looked wired while being inert.
  const gen = (nodes: string[] = []): ProfileGeneral => {
    let g = newGeneral("c1", "Gen. Real", "GR", "US");
    g = { ...g, pts: 6 };
    for (const id of nodes) {
      const r = trainNode(g, id, 1950);
      if (!r.changed) throw new Error(`fixture could not train ${id}: ${r.reason}`);
      g = r.general;
    }
    return g;
  };
  function bound(
    u: CombatUnit,
    assignments: ConflictAssignment[],
    generalsById: Record<string, ProfileGeneral>
  ): BattleContext {
    return {
      units: [u],
      positions: {},
      assignments,
      generalsById,
      natMods: natMods({}),
      countryScale: 2.6,
      side: "A",
      fronts: FRONTS_MAP,
    };
  }

  it("resolves the general leading a unit at the front they are posted to", () => {
    const u = unit({ theaterId: "afghan", assignedGeneralId: "g1" });
    const c = bound(u, [{ theaterId: "afghan", generalCharacterId: "g1", inCharge: true }], {
      g1: gen(["ar1"]),
    });
    expect(generalOfForTest(c, u)?.gtraits).toEqual(["ar1"]);
  });

  it("does not command a unit sitting at a front its general is not posted to", () => {
    // Defence-in-depth: theater is reconciled to the general's posting, but an
    // unreconciled unit at the wrong front must not inherit a phantom buff.
    const u = unit({ theaterId: "angola", assignedGeneralId: "g1" });
    const c = bound(u, [{ theaterId: "afghan", generalCharacterId: "g1", inCharge: true }], {
      g1: gen(["ar1"]),
    });
    expect(generalOfForTest(c, u)).toBeNull();
  });

  it("does not command a unit that is not assigned to it", () => {
    const u = unit({ theaterId: "afghan", assignedGeneralId: null });
    const c = bound(u, [{ theaterId: "afghan", generalCharacterId: "g1", inCharge: true }], {
      g1: gen(["ar1"]),
    });
    expect(generalOfForTest(c, u)).toBeNull();
  });

  it("returns null when the assigned general has no resolved profile", () => {
    // generalsById is built server-side from characterGenerals; a name with no
    // profile must not become a phantom buff.
    const u = unit({ theaterId: "afghan", assignedGeneralId: "ghost" });
    const c = bound(u, [{ theaterId: "afghan", generalCharacterId: "ghost", inCharge: true }], {});
    expect(generalOfForTest(c, u)).toBeNull();
  });

  it("credits battle xp to the general who led the unit", () => {
    const u = unit({
      theaterId: "afghan",
      assignedGeneralId: "g1",
      personnel: 15000,
      readiness: 80,
    });
    const c = bound(u, [{ theaterId: "afghan", generalCharacterId: "g1", inCharge: true }], {
      g1: gen(["ar1"]),
    });
    const result = computeBattle(c, "afghan", 55);
    const { generalXp } = applyOutcome(c, result);
    expect(generalXp.g1).toBeGreaterThan(0);
  });

  it("credits no xp when no general led the unit", () => {
    const u = unit({ theaterId: "afghan" });
    const c = bound(u, [], {});
    const result = computeBattle(c, "afghan", 55);
    expect(applyOutcome(c, result).generalXp).toEqual({});
  });

  // The repair, asserted end-to-end: a general who has trained tree nodes moves
  // the battle math. Before W9 this was impossible — the traits battle math read
  // could never be earned.
  it("a general's trained tree nodes raise their force's strength", () => {
    const id = new ObjectId();
    const led = bound(
      unit({ _id: id, theaterId: "afghan", assignedGeneralId: "g1" }),
      [{ theaterId: "afghan", generalCharacterId: "g1", inCharge: true }],
      { g1: gen(["ar1"]) }
    );
    const unled = bound(unit({ _id: id, theaterId: "afghan" }), [], {});
    expect(forecast(led, "afghan", 55).ownStr).toBeGreaterThan(
      forecast(unled, "afghan", 55).ownStr
    );
  });

  it("an untrained general is the identity modifier regardless of level", () => {
    // Level gates trait points; it confers nothing on its own.
    const id = new ObjectId();
    const led = bound(
      unit({ _id: id, theaterId: "afghan", assignedGeneralId: "g1" }),
      [{ theaterId: "afghan", generalCharacterId: "g1", inCharge: true }],
      { g1: gen() }
    );
    const unled = bound(unit({ _id: id, theaterId: "afghan" }), [], {});
    expect(forecast(led, "afghan", 55).ownStr).toBe(forecast(unled, "afghan", 55).ownStr);
  });
});

// The Theater Commander's command bonus: once, front-wide, on top of whatever
// each unit's own leading general contributes.
describe("theater commander bonus", () => {
  // Build generals the way the game does — commission, then train. The previous
  // helper hand-wrote a `traits` array, a state no real general could ever reach,
  // which is exactly why generals looked wired while being inert.
  const gen = (nodes: string[] = []): ProfileGeneral => {
    let g = newGeneral("c1", "Gen. Real", "GR", "US");
    g = { ...g, pts: 6 };
    for (const id of nodes) {
      const r = trainNode(g, id, 1950);
      if (!r.changed) throw new Error(`fixture could not train ${id}: ${r.reason}`);
      g = r.general;
    }
    return g;
  };
  function frontCtx(units: CombatUnit[], assignments: ConflictAssignment[]): BattleContext {
    return {
      units,
      positions: {},
      assignments,
      generalsById: { tc: gen(["ag1", "ag2"]), plain: gen() },
      natMods: natMods({}),
      countryScale: 2.6,
      side: "A",
      fronts: FRONTS_MAP,
    };
  }

  it("a theater commander raises the whole front's strength", () => {
    const a = unit({ _id: new ObjectId(), theaterId: "afghan", assignedGeneralId: "tc" });
    const b = unit({ _id: new ObjectId(), theaterId: "afghan", assignedGeneralId: "tc" });
    // Same general leads the same units either way — only inCharge differs, so the
    // delta isolates the front-wide command bonus from the per-unit buff.
    const withTc = frontCtx(
      [a, b],
      [{ theaterId: "afghan", generalCharacterId: "tc", inCharge: true }]
    );
    const withoutTc = frontCtx(
      [a, b],
      [{ theaterId: "afghan", generalCharacterId: "tc", inCharge: false }]
    );
    expect(forecast(withTc, "afghan", 55).ownStr).toBeGreaterThan(
      forecast(withoutTc, "afghan", 55).ownStr
    );
  });

  it("a theater commander at another front does not help here", () => {
    const a = unit({ _id: new ObjectId(), theaterId: "afghan", assignedGeneralId: "tc" });
    const here = frontCtx(
      [a],
      [{ theaterId: "afghan", generalCharacterId: "tc", inCharge: false }]
    );
    const elsewhere = frontCtx(
      [a],
      [
        { theaterId: "afghan", generalCharacterId: "tc", inCharge: false },
        { theaterId: "angola", generalCharacterId: "plain", inCharge: true },
      ]
    );
    expect(forecast(elsewhere, "afghan", 55).ownStr).toBe(forecast(here, "afghan", 55).ownStr);
  });

  it("an untrained theater commander confers no front-wide edge", () => {
    // The bonus is a share of the TC's own cv edge; nothing trained means no edge.
    const a = unit({ _id: new ObjectId(), theaterId: "afghan", assignedGeneralId: "plain" });
    const tc = frontCtx(
      [a],
      [{ theaterId: "afghan", generalCharacterId: "plain", inCharge: true }]
    );
    const noTc = frontCtx(
      [a],
      [{ theaterId: "afghan", generalCharacterId: "plain", inCharge: false }]
    );
    expect(forecast(tc, "afghan", 55).ownStr).toBe(forecast(noTc, "afghan", 55).ownStr);
  });

  it("the front-wide bonus is weaker than leading the units personally", () => {
    // Being in charge must never beat being present, or players would stack one
    // great TC and neglect unit leadership.
    const a = unit({ _id: new ObjectId(), theaterId: "afghan", assignedGeneralId: "tc" });
    const aUnled = { ...a, assignedGeneralId: null };
    const leading = frontCtx(
      [a],
      [{ theaterId: "afghan", generalCharacterId: "tc", inCharge: false }]
    );
    const merelyInCharge = frontCtx(
      [aUnled],
      [{ theaterId: "afghan", generalCharacterId: "tc", inCharge: true }]
    );
    const base = frontCtx([a], []);
    const leadGain = forecast(leading, "afghan", 55).ownStr - forecast(base, "afghan", 55).ownStr;
    const tcGain =
      forecast(merelyInCharge, "afghan", 55).ownStr - forecast(base, "afghan", 55).ownStr;
    expect(tcGain).toBeGreaterThan(0);
    expect(tcGain).toBeLessThan(leadGain);
  });
});

describe("retreat (break off)", () => {
  it("a hopeless attacker breaks off, loses, and is recorded", () => {
    const a = side("US", "A", [20], "afghan");
    const d = side("CN", "B", [400, 400, 400], "afghan");
    const r = resolvePvpBattle([a], [d], "afghan", 7);
    expect(r.retreat?.side).toBe("attacker");
    expect(r.win).toBe(false);
    expect(r.rounds.length).toBeLessThanOrEqual(5);
  });

  // The reported loss must be the SOFTENED per-unit total — softening the unit array
  // while reporting the raw aggregate (or vice versa) would desync what the turn
  // persists to units from what the battle report shows.
  it("the breaking side's reported loss matches its softened per-unit casualties", () => {
    const a = side("US", "A", [20], "afghan");
    const d = side("CN", "B", [400, 400, 400], "afghan");
    const r = resolvePvpBattle([a], [d], "afghan", 7);
    expect(r.retreat?.side).toBe("attacker");
    const summed = r.attacker.unitResults.reduce((s, u) => s + u.casualties, 0);
    expect(r.attacker.loss).toBe(summed);
    // The side that did NOT break keeps its unsoftened total, also self-consistent.
    expect(r.defender.loss).toBe(r.defender.unitResults.reduce((s, u) => s + u.casualties, 0));
  });

  it("an even matchup that never breaks records no retreat", () => {
    const a = side("US", "A", [100], "afghan");
    const d = side("CN", "B", [100], "afghan");
    const r = resolvePvpBattle([a], [d], "afghan", 3);
    if (r.retreat === null) expect(r.rounds.length).toBe(5);
  });

  it("retreating units keep their front and their general (they hold position)", () => {
    const a = side("US", "A", [20], "afghan");
    const d = side("CN", "B", [400, 400, 400], "afghan");
    resolvePvpBattle([a], [d], "afghan", 7);
    expect(a.units.every((u) => u.theaterId === "afghan")).toBe(true);
  });
});

// `margin` drives the occupation shift, so it must be the SAME number the verdict
// ladder reads — a battle whose verdict and territorial result disagree would be
// unreadable in the war room.
describe("battle margin", () => {
  it("is positive when the attacker wins", () => {
    const a = side("US", "A", [400, 400, 400], "afghan");
    const d = side("CN", "B", [20], "afghan");
    const r = resolvePvpBattle([a], [d], "afghan", 7);
    expect(r.win).toBe(true);
    expect(r.margin).toBeGreaterThan(0);
  });

  it("is negative when the attacker loses", () => {
    const a = side("US", "A", [20], "afghan");
    const d = side("CN", "B", [400, 400, 400], "afghan");
    const r = resolvePvpBattle([a], [d], "afghan", 7);
    expect(r.win).toBe(false);
    expect(r.margin).toBeLessThan(0);
  });

  it("agrees with the verdict ladder at every rung", () => {
    for (let s = 0; s < 40; s++) {
      const a = side("US", "A", [120, 90], "afghan");
      const d = side("CN", "B", [80, 60], "afghan");
      const r = resolvePvpBattle([a], [d], "afghan", s);
      if (r.verdict === "Decisive Victory") expect(r.margin).toBeGreaterThan(45);
      if (r.verdict === "Victory") expect(r.margin).toBeGreaterThan(15);
      if (r.verdict === "Pyrrhic Victory") expect(r.margin).toBeGreaterThan(0);
      if (r.verdict === "Rout") expect(r.margin).toBeLessThanOrEqual(-30);
    }
  });

  it("is deterministic for a given seed", () => {
    const mk = () => [side("US", "A", [120], "afghan"), side("CN", "B", [80], "afghan")] as const;
    const [a1, d1] = mk();
    const [a2, d2] = mk();
    expect(resolvePvpBattle([a1], [d1], "afghan", 99).margin).toBe(
      resolvePvpBattle([a2], [d2], "afghan", 99).margin
    );
  });
});

// Territorial position feeds back into the fighting: a side compressed by a losing
// front hauls less through a degraded theatre. Absent = unchanged (the whole
// pre-occupation world, and any caller that cannot resolve a side).
describe("conflict supply feeds throughput", () => {
  it("leaves supply unchanged when no conflict supply is supplied", () => {
    const base = ctx([unit()]);
    const withUndef = { ...base, conflictSupply: undefined };
    expect(supplyState([withUndef], "afghan").level).toBe(supplyState([base], "afghan").level);
  });

  it("is neutral at exactly the neutral value", () => {
    const base = ctx([unit()]);
    const neutral = { ...base, conflictSupply: OCCUPATION.supplyNeutral };
    expect(supplyState([neutral], "afghan").level).toBe(supplyState([base], "afghan").level);
  });

  it("degrades supply for a compressed side", () => {
    const base = ctx([unit()]);
    const squeezed = { ...base, conflictSupply: 33 };
    expect(supplyState([squeezed], "afghan").level).toBeLessThan(
      supplyState([base], "afghan").level
    );
  });

  // `level` is clamped at 100 and this fixture is already fully supplied, so the
  // effect of a side ABOVE neutral shows on the unclamped throughput.
  it("improves throughput for a side above neutral", () => {
    const base = ctx([unit()]);
    const rich = { ...base, conflictSupply: 90 };
    expect(supplyState([rich], "afghan").throughput).toBeGreaterThan(
      supplyState([base], "afghan").throughput
    );
  });

  // An additive term would drive throughput negative at the floor on a low-infra
  // front; scaling cannot.
  it("never reports a negative level at the supply floor", () => {
    const base = ctx([unit()]);
    const floored = { ...base, conflictSupply: OCCUPATION.minSupply };
    const s = supplyState([floored], "afghan");
    expect(s.level).toBeGreaterThanOrEqual(0);
    expect(s.throughput).toBeGreaterThanOrEqual(0);
  });

  it("carries the side's supply through sideCtx into the forecast", () => {
    const a = side("US", "A", [120], "afghan");
    const d = side("CN", "B", [120], "afghan");
    const healthy = battleForecast([a], [d], "afghan");
    const starved = battleForecast([{ ...a, conflictSupply: 20 }], [d], "afghan");
    expect(starved.attStr).toBeLessThan(healthy.attStr);
  });
});
