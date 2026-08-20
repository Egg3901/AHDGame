import { describe, it, expect } from "vitest";
import {
  applyVietnamMove,
  clampVietnamLevel,
  deescalationApprovalCost,
  deriveVietnamDials,
  emptyVietnamState,
  escalationApprovalCost,
  rungForLevel,
  supportPctGdpForLevel,
  tickVietnamWarClock,
  vietnamProcurementMultiplier,
  vietnamSideForCountry,
  vietnamTemplateKeyForLevel,
  VIETNAM_MAX_LEVEL,
  VIETNAM_RUNGS,
  VIETNAM_RUNG_PRESSURE,
  VIETNAM_WAR_LEVEL,
  type VietnamEscalationState,
} from "./vietnamEscalation";

function stateAt(level: number, over: Partial<VietnamEscalationState> = {}) {
  return { ...emptyVietnamState(), hasOpened: true, level, ...over };
}

/** Repeatedly support from one side until the ladder stops climbing. */
function climb(from: VietnamEscalationState, side: "west" | "east", moves: number) {
  let s = from;
  for (let i = 0; i < moves; i++) s = applyVietnamMove(s, side, "support");
  return s;
}

describe("Vietnam escalation ladder", () => {
  describe("rung table", () => {
    it("is a contiguous 1..N ladder", () => {
      expect(VIETNAM_RUNGS.map((r) => r.level)).toEqual([1, 2, 3, 4, 5, 6]);
      expect(VIETNAM_MAX_LEVEL).toBe(6);
    });

    it("puts the naval incident before the shooting war, not after it", () => {
      const tonkin = VIETNAM_RUNGS.find((r) => r.key === "tonkin_incident")!;
      const air = VIETNAM_RUNGS.find((r) => r.key === "air_campaign")!;
      expect(tonkin.level).toBeLessThan(air.level);
      expect(air.level).toBe(VIETNAM_WAR_LEVEL);
    });

    it("escalates readiness, cost and procurement monotonically", () => {
      for (let i = 1; i < VIETNAM_RUNGS.length; i++) {
        expect(VIETNAM_RUNGS[i].defcon).toBeLessThanOrEqual(VIETNAM_RUNGS[i - 1].defcon);
        expect(VIETNAM_RUNGS[i].supportPctGdp).toBeGreaterThan(VIETNAM_RUNGS[i - 1].supportPctGdp);
        expect(VIETNAM_RUNGS[i].procurementMultiplier).toBeGreaterThan(
          VIETNAM_RUNGS[i - 1].procurementMultiplier
        );
      }
    });

    it("maps every rung to a template key and level 0 to none", () => {
      for (const rung of VIETNAM_RUNGS) {
        expect(vietnamTemplateKeyForLevel(rung.level)).toBe(`vietnam_${rung.key}`);
      }
      expect(vietnamTemplateKeyForLevel(0)).toBeNull();
      expect(rungForLevel(0)).toBeNull();
    });

    it("puts only the two superpowers on the ladder", () => {
      expect(vietnamSideForCountry("US")).toBe("west");
      expect(vietnamSideForCountry("RU")).toBe("east");
      expect(vietnamSideForCountry("UK")).toBeNull();
      expect(vietnamSideForCountry("DD")).toBeNull();
    });

    it("clamps levels to the ladder", () => {
      expect(clampVietnamLevel(-4)).toBe(0);
      expect(clampVietnamLevel(99)).toBe(VIETNAM_MAX_LEVEL);
      expect(clampVietnamLevel(Number.NaN)).toBe(0);
    });
  });

  describe("transitions", () => {
    it("does not climb on a single pledge", () => {
      const next = applyVietnamMove(stateAt(1), "west", "support");
      expect(next.level).toBe(1);
      expect(next.westSupport).toBeGreaterThan(0);
    });

    it("climbs one rung once a side clears the pressure threshold", () => {
      const next = climb(stateAt(1), "west", 2);
      expect(next.westSupport).toBeGreaterThanOrEqual(0);
      expect(next.level).toBe(2);
    });

    it("climbs at most one rung per move", () => {
      let s = stateAt(1);
      const seen: number[] = [];
      for (let i = 0; i < 12; i++) {
        const before = s.level;
        s = applyVietnamMove(s, "west", "support");
        expect(s.level - before).toBeLessThanOrEqual(1);
        seen.push(s.level);
      }
      expect(Math.max(...seen)).toBeGreaterThan(1);
    });

    it("never climbs past the top rung", () => {
      const s = climb(stateAt(VIETNAM_MAX_LEVEL), "east", 20);
      expect(s.level).toBe(VIETNAM_MAX_LEVEL);
    });

    it("hold changes nothing on the ladder", () => {
      const before = stateAt(3, { westSupport: 11, eastSupport: 7 });
      const after = applyVietnamMove(before, "west", "hold");
      expect(after.level).toBe(3);
      expect(after.westSupport).toBe(11);
      expect(after.eastSupport).toBe(7);
    });

    it("de-escalation drains a side's own pressure before the rung comes down", () => {
      const before = stateAt(4, { westSupport: VIETNAM_RUNG_PRESSURE });
      const once = applyVietnamMove(before, "west", "deescalate");
      expect(once.level).toBe(4);
      expect(once.westSupport).toBeLessThan(before.westSupport);
      const twice = applyVietnamMove(once, "west", "deescalate");
      expect(twice.westSupport).toBe(0);
      expect(twice.level).toBe(3);
    });

    it("one capital's restraint does not cancel the other's commitment", () => {
      const before = stateAt(4, { eastSupport: 40 });
      const after = applyVietnamMove(before, "west", "deescalate");
      expect(after.eastSupport).toBe(40);
    });

    it("bottoms out at level 0 and stays there", () => {
      let s = stateAt(1);
      for (let i = 0; i < 8; i++) s = applyVietnamMove(s, "west", "deescalate");
      expect(s.level).toBe(0);
    });

    it("a full escalate-then-deescalate cycle returns the ladder to where it started", () => {
      const start = stateAt(2);
      const up = climb(start, "west", 2);
      expect(up.level).toBe(3);
      let down = up;
      for (let i = 0; i < 6; i++) down = applyVietnamMove(down, "west", "deescalate");
      expect(down.level).toBeLessThanOrEqual(start.level);
    });
  });

  describe("war clock", () => {
    it("does not run below the war rung", () => {
      const s = tickVietnamWarClock(stateAt(VIETNAM_WAR_LEVEL - 1));
      expect(s.warTurns).toBe(0);
    });

    it("runs at and above the war rung", () => {
      const s = tickVietnamWarClock(stateAt(VIETNAM_WAR_LEVEL));
      expect(s.warTurns).toBe(1);
    });
  });

  describe("derived dials", () => {
    it("reads calm with an empty ladder", () => {
      const d = deriveVietnamDials(emptyVietnamState());
      expect(d.defcon).toBe(5);
      expect(d.warWeariness).toBe(0);
      expect(d.procurementMultiplier).toBe(1);
      expect(d.detenteGoodwillPenalty).toBe(0);
    });

    it("drops readiness and raises procurement demand as the ladder climbs", () => {
      const low = deriveVietnamDials(stateAt(1));
      const high = deriveVietnamDials(stateAt(6));
      expect(high.defcon).toBeLessThan(low.defcon);
      expect(high.procurementMultiplier).toBeGreaterThan(low.procurementMultiplier);
      expect(high.detenteGoodwillPenalty).toBeGreaterThan(low.detenteGoodwillPenalty);
    });

    it("only produces war weariness once the war is a shooting war", () => {
      expect(deriveVietnamDials(stateAt(VIETNAM_WAR_LEVEL - 1)).warWeariness).toBe(0);
      expect(deriveVietnamDials(stateAt(VIETNAM_WAR_LEVEL)).warWeariness).toBeGreaterThan(0);
    });

    it("worsens weariness the longer the war runs", () => {
      const fresh = deriveVietnamDials(stateAt(5, { warTurns: 0 }));
      const long = deriveVietnamDials(stateAt(5, { warTurns: 20 }));
      expect(long.warWeariness).toBeGreaterThan(fresh.warWeariness);
    });

    it("rewards the side that has committed more with bloc cohesion", () => {
      const d = deriveVietnamDials(stateAt(3, { westSupport: 60, eastSupport: 0 }));
      expect(d.cohesionWest).toBeGreaterThan(d.cohesionEast);
    });

    it("burns both sides' cohesion in a long war", () => {
      const short = deriveVietnamDials(stateAt(5, { warTurns: 0 }));
      const long = deriveVietnamDials(stateAt(5, { warTurns: 30 }));
      expect(long.cohesionWest).toBeLessThan(short.cohesionWest);
      expect(long.cohesionEast).toBeLessThan(short.cohesionEast);
    });

    it("keeps every dial inside its range", () => {
      for (const level of [0, 1, 2, 3, 4, 5, 6]) {
        for (const warTurns of [0, 10, 60]) {
          const d = deriveVietnamDials(stateAt(level, { warTurns, westSupport: 100 }));
          expect(d.defcon).toBeGreaterThanOrEqual(1);
          expect(d.defcon).toBeLessThanOrEqual(5);
          expect(d.cohesionWest).toBeGreaterThanOrEqual(0);
          expect(d.cohesionWest).toBeLessThanOrEqual(100);
          expect(d.cohesionEast).toBeGreaterThanOrEqual(0);
          expect(d.cohesionEast).toBeLessThanOrEqual(100);
          expect(d.warWeariness).toBeLessThanOrEqual(100);
        }
      }
    });

    it("exposes the same procurement multiplier as the standalone helper", () => {
      for (const rung of VIETNAM_RUNGS) {
        expect(deriveVietnamDials(stateAt(rung.level)).procurementMultiplier).toBe(
          vietnamProcurementMultiplier(rung.level)
        );
      }
      expect(vietnamProcurementMultiplier(0)).toBe(1);
    });
  });

  describe("approval costs", () => {
    it("charges escalation to anti-war opinion, worse at higher rungs", () => {
      const low = escalationApprovalCost(stateAt(1))[0].value;
      const high = escalationApprovalCost(stateAt(6))[0].value;
      expect(low).toBeLessThan(0);
      expect(high).toBeLessThan(low);
    });

    it("charges escalation more the longer the war has already run", () => {
      const fresh = escalationApprovalCost(stateAt(5, { warTurns: 0 }))[0].value;
      const long = escalationApprovalCost(stateAt(5, { warTurns: 36 }))[0].value;
      expect(long).toBeLessThan(fresh);
    });

    it("charges de-escalation to hawks, worse the higher the climb-down", () => {
      const low = deescalationApprovalCost(stateAt(1))[0].value;
      const high = deescalationApprovalCost(stateAt(6))[0].value;
      expect(low).toBeLessThan(0);
      expect(high).toBeLessThan(low);
    });

    it("authors both costs on the native approval scale", () => {
      for (const effects of [
        escalationApprovalCost(stateAt(3)),
        deescalationApprovalCost(stateAt(3)),
      ]) {
        for (const e of effects) {
          expect(e.targetType).toBe("approval");
          expect(Math.abs(e.value)).toBeGreaterThanOrEqual(0.1);
        }
      }
    });
  });

  it("prices support as a rising share of GDP", () => {
    expect(supportPctGdpForLevel(1)).toBeLessThan(supportPctGdpForLevel(6));
    expect(supportPctGdpForLevel(0)).toBeGreaterThan(0);
  });

  describe("earliestYear rung floor", () => {
    it("holds the ladder below the next rung's year no matter the pressure", () => {
      const l1 = stateAt(1);
      const nextYear = rungForLevel(2)!.earliestYear;
      // Both sides pour in support many years early; the rung cannot climb.
      let s = l1;
      for (let i = 0; i < 10; i++) {
        s = applyVietnamMove(s, "west", "support", nextYear - 1);
        s = applyVietnamMove(s, "east", "support", nextYear - 1);
      }
      expect(s.level).toBe(1);
      // Pressure is held at the threshold, not ballooned to 100.
      expect(s.westSupport).toBeLessThanOrEqual(VIETNAM_RUNG_PRESSURE);
    });

    it("climbs once the calendar reaches the rung's earliestYear", () => {
      const nextYear = rungForLevel(2)!.earliestYear;
      let s = stateAt(1);
      // Prime pressure while blocked, then the year arrives.
      s = applyVietnamMove(s, "west", "support", nextYear - 1);
      s = applyVietnamMove(s, "west", "support", nextYear);
      expect(s.level).toBe(2);
    });

    it("climbs at most one rung per move even with the year wide open", () => {
      const s = applyVietnamMove(
        stateAt(1, { westSupport: VIETNAM_RUNG_PRESSURE }),
        "west",
        "support",
        3000
      );
      expect(s.level).toBe(2);
    });

    it("without a year (pure state-machine callers) falls back to pressure-only", () => {
      let s = stateAt(1);
      s = applyVietnamMove(s, "west", "support");
      s = applyVietnamMove(s, "west", "support");
      expect(s.level).toBe(2);
    });
  });
});
