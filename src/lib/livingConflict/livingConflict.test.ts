import { describe, it, expect } from "vitest";
import type { Db } from "mongodb";
import {
  applyCommitment,
  canAdvance,
  emptyConflictState,
  governingPressure,
  maxPhaseLevel,
  openConflict,
  phaseFor,
  relieveCommitment,
  selectEvents,
  tickConflict,
} from "./engine";
import { targetsFor, publishEvent, newPolicy, meetsSeverity } from "./broadcast";
import { collectingSink } from "./sinks";
import { LIVING_CONFLICT_DEFS, livingConflictDef } from "./registry";
import { VIETNAM_DEF } from "./defs/vietnam";
import { PANDEMIC_DEF } from "./defs/pandemic";
import { driveConflictTurn, nationsForRoles, type ConflictParticipants } from "./driver";
import type { FiredEvent, LivingConflictDef } from "./types";

const firedEvent = (severity: "minor" | "major" | "critical", key = "e"): FiredEvent => ({
  id: `test:phase:1:${key}`,
  defKey: "test",
  phaseKey: "phase",
  turn: 1,
  event: { key, kind: "authored", severity, affects: "all", headline: "H", body: "B" },
});

describe("living-conflict engine", () => {
  describe("opening and ticking", () => {
    it("opens at phase 1 and is idempotent", () => {
      const opened = openConflict(emptyConflictState("vietnam"), 1955);
      expect(opened.hasOpened).toBe(true);
      expect(opened.phaseLevel).toBe(1);
      expect(opened.openedYear).toBe(1955);
      expect(openConflict(opened, 1960).phaseLevel).toBe(1);
    });

    it("ticks both clocks", () => {
      const t = tickConflict(tickConflict(openConflict(emptyConflictState("v"), 1955)));
      expect(t.totalTurns).toBe(2);
      expect(t.phaseTurns).toBe(2);
    });
  });

  describe("phase advance gating", () => {
    it("climbs when pressure clears the threshold and the gate is open", () => {
      let s = openConflict(emptyConflictState("vietnam"), 1955);
      s = applyCommitment(VIETNAM_DEF, s, "a", 24, 1959);
      expect(s.phaseLevel).toBe(2);
    });

    it("holds below the next phase's earliestYear no matter the pressure", () => {
      let s = openConflict(emptyConflictState("vietnam"), 1955);
      for (let i = 0; i < 10; i++) s = applyCommitment(VIETNAM_DEF, s, "a", 12, 1956);
      expect(s.phaseLevel).toBe(1);
      expect(governingPressure(s)).toBeLessThanOrEqual(phaseFor(VIETNAM_DEF, 1)!.advancePressure);
    });

    it("respects minDwellTurns on the pandemic", () => {
      // outbreak (phase 2) requires 3 dwell turns on emergence; pandemic (phase 3)
      // requires 4 dwell turns on outbreak. Pressure alone does not advance.
      let s = openConflict(emptyConflictState("pandemic"), 2000);
      s = applyCommitment(PANDEMIC_DEF, s, "a", 20); // pressure met, but 0 dwell
      expect(s.phaseLevel).toBe(1);
      s = { ...s, phaseTurns: 3 };
      s = applyCommitment(PANDEMIC_DEF, s, "a", 20); // now dwell met -> phase 2
      expect(s.phaseLevel).toBe(2);
      s = applyCommitment(PANDEMIC_DEF, s, "a", 28); // pressure met, 0 dwell on outbreak
      expect(s.phaseLevel).toBe(2);
      s = { ...s, phaseTurns: 4 };
      s = applyCommitment(PANDEMIC_DEF, s, "a", 28);
      expect(s.phaseLevel).toBe(3);
    });

    it("descends only after a side's own pressure is drained", () => {
      let s = openConflict(emptyConflictState("vietnam"), 1965);
      s = { ...s, phaseLevel: 3, pressure: { a: 24 } };
      s = relieveCommitment(VIETNAM_DEF, s, "a", 15);
      expect(s.phaseLevel).toBe(3);
      s = relieveCommitment(VIETNAM_DEF, s, "a", 15);
      expect(s.phaseLevel).toBe(2);
    });

    it("canAdvance is false at the top phase", () => {
      const top = {
        ...openConflict(emptyConflictState("vietnam"), 1970),
        phaseLevel: maxPhaseLevel(VIETNAM_DEF),
      };
      expect(canAdvance(VIETNAM_DEF, top, 1975)).toBe(false);
    });
  });

  describe("event selection", () => {
    it("fires an onPhaseEnter authored beat only on the entry turn", () => {
      const s = openConflict(emptyConflictState("pandemic"), 2000); // phaseTurns 0
      expect(selectEvents(PANDEMIC_DEF, s, 5).some((f) => f.event.key === "patient_zero")).toBe(
        true
      );
      const later = { ...s, phaseTurns: 2 };
      expect(selectEvents(PANDEMIC_DEF, later, 6).some((f) => f.event.key === "patient_zero")).toBe(
        false
      );
    });

    it("produces deterministic, phase-scoped ids", () => {
      const s = openConflict(emptyConflictState("pandemic"), 2000);
      const [f] = selectEvents(PANDEMIC_DEF, s, 5);
      expect(f.id).toBe("pandemic:emergence:5:patient_zero");
    });

    it("never emits reactive events from selection", () => {
      const def: LivingConflictDef = {
        key: "t",
        type: "disaster",
        name: "T",
        roleResolver: () => "bystander",
        phases: [
          {
            level: 1,
            key: "p",
            label: "P",
            summary: "s",
            advancePressure: 10,
            decisionTrees: {},
            events: [
              {
                key: "r",
                kind: "reactive",
                severity: "major",
                affects: "all",
                headline: "h",
                body: "b",
              },
            ],
          },
        ],
      };
      const s = openConflict(emptyConflictState("t"), 2000);
      expect(selectEvents(def, s, 1)).toHaveLength(0);
    });
  });
});

describe("broadcast bus", () => {
  it("keeps minor events off Discord and puts major events on it", () => {
    const minor = targetsFor(firedEvent("minor"), ["US"]).map((t) => t.channel);
    expect(minor).toContain("wire_global");
    expect(minor).not.toContain("discord_global");
    const major = targetsFor(firedEvent("major"), ["US"]).map((t) => t.channel);
    expect(major).toContain("discord_global");
    expect(major).toContain("discord_national");
  });

  it("dedupes by event id across publishes", async () => {
    const wire = collectingSink("wire_global");
    const policy = newPolicy();
    const ev = firedEvent("minor");
    await publishEvent(ev, [], [wire], policy);
    await publishEvent(ev, [], [wire], policy);
    expect(wire.messages).toHaveLength(1);
  });

  it("enforces a per-sink severity floor", () => {
    const discord = collectingSink("discord_global", "major");
    expect(meetsSeverity(discord, "minor")).toBe(false);
    expect(meetsSeverity(discord, "major")).toBe(true);
  });

  it("rate-limits a single target", async () => {
    const wire = collectingSink("wire_global");
    const policy = newPolicy(2);
    for (let i = 0; i < 5; i++) {
      await publishEvent(firedEvent("minor", `e${i}`), [], [wire], policy);
    }
    expect(wire.messages).toHaveLength(2);
  });
});

describe("definitions", () => {
  const defs = Object.values(LIVING_CONFLICT_DEFS);

  it("registers vietnam and pandemic", () => {
    expect(livingConflictDef("vietnam")).toBeTruthy();
    expect(livingConflictDef("pandemic")).toBeTruthy();
    expect(livingConflictDef("nope")).toBeNull();
  });

  it("every def has a contiguous 1..N phase ladder with unique keys", () => {
    for (const def of defs) {
      const levels = def.phases.map((p) => p.level);
      expect(levels).toEqual(levels.map((_, i) => i + 1));
      const keys = new Set(def.phases.map((p) => p.key));
      expect(keys.size).toBe(def.phases.length);
    }
  });

  it("vietnam floors its rungs to the historical years", () => {
    const byKey = Object.fromEntries(VIETNAM_DEF.phases.map((p) => [p.key, p.earliestYear]));
    expect(byKey.tonkin_incident).toBe(1964);
    expect(byKey.air_campaign).toBe(1965);
    expect(VIETNAM_DEF.phases[0].earliestYear).toBeUndefined();
  });

  it("pandemic offers per-role decisions across phases", () => {
    const outbreak = PANDEMIC_DEF.phases.find((p) => p.key === "outbreak")!;
    expect(Object.keys(outbreak.decisionTrees)).toEqual(
      expect.arrayContaining(["belligerent", "neighbor", "bystander"])
    );
  });
});

describe("driver", () => {
  // Minimal in-memory Db stub covering findOne / updateOne(upsert).
  function fakeDb() {
    const store = new Map<string, unknown>();
    return {
      collection() {
        return {
          async findOne(q: { defKey: string }) {
            return store.get(q.defKey) ?? null;
          },
          async updateOne(q: { defKey: string }, u: { $set: Record<string, unknown> }) {
            store.set(q.defKey, { ...(store.get(q.defKey) ?? {}), ...u.$set });
          },
        };
      },
    } as unknown as Db;
  }

  const participants: ConflictParticipants = {
    belligerents: ["SVN", "NVN"],
    backerA: "US",
    backerB: "RU",
    neighbors: ["KH"],
    blocMembers: ["UK"],
  };

  it("maps roles to nations, including all", () => {
    expect(nationsForRoles(participants, ["backer_a"])).toEqual(["US"]);
    expect(nationsForRoles(participants, ["belligerent"])).toEqual(["SVN", "NVN"]);
    expect(nationsForRoles(participants, "all").sort()).toEqual([
      "KH",
      "NVN",
      "RU",
      "SVN",
      "UK",
      "US",
    ]);
  });

  it("does not open outside the era window", async () => {
    const db = fakeDb();
    const res = await driveConflictTurn(db, VIETNAM_DEF, participants, 10, 1940);
    expect(res.state.hasOpened).toBe(false);
    expect(res.events).toHaveLength(0);
  });

  it("opens in window and emits the phase-entry beat with its audience", async () => {
    const db = fakeDb();
    const res = await driveConflictTurn(db, VIETNAM_DEF, participants, 10, 1955);
    expect(res.state.hasOpened).toBe(true);
    expect(res.state.phaseLevel).toBe(1);
    const beat = res.events.find((e) => e.fired.event.key === "advisors_beat");
    expect(beat).toBeTruthy();
    expect(beat!.affectedNations.length).toBeGreaterThan(0);
  });

  it("lets a pandemic climb on its own momentum over turns", async () => {
    const db = fakeDb();
    // Open, then drive enough turns that naturalPressure clears emergence.
    let res = await driveConflictTurn(
      db,
      PANDEMIC_DEF,
      { belligerents: ["CN"], neighbors: [], blocMembers: [] },
      1,
      2000
    );
    expect(res.state.phaseLevel).toBe(1);
    for (let turn = 2; turn <= 6; turn++) {
      res = await driveConflictTurn(
        db,
        PANDEMIC_DEF,
        { belligerents: ["CN"], neighbors: [], blocMembers: [] },
        turn,
        2000
      );
    }
    expect(res.state.phaseLevel).toBeGreaterThanOrEqual(2);
  });
});
