import { describe, expect, it } from "vitest";
import {
  buildCalendarWaves,
  buildPrimaryViewModel,
  isInStaggerWindow,
  pickDefaultSelectedState,
  resolvePrimaryTurnsToEnd,
  type PrimaryCandidateInfo,
} from "./primaryViewModel";
import { STRETCHED_SCHEDULE, getPrimaryWaveSchedule } from "@/lib/constants/primaryCalendar";

const candidates: PrimaryCandidateInfo[] = [
  { id: "c1", name: "Smith", color: "#ff0000", archetype: "Populist" },
  { id: "c2", name: "Jones", color: "#0000ff", archetype: "Moderate" },
  { id: "c3", name: "Lee", color: "#00ff00" },
];

describe("buildCalendarWaves", () => {
  it("returns waves sorted earliest-first by turnsRemaining (descending)", () => {
    const waves = buildCalendarWaves({});
    for (let i = 0; i < waves.length - 1; i++) {
      expect(waves[i].turnsRemaining).toBeGreaterThanOrEqual(waves[i + 1].turnsRemaining);
    }
  });

  it("flags every wave as past when votedStateIds covers them all", () => {
    const allStates = buildCalendarWaves({}).flatMap((w) => w.stateIds);
    const voted = new Set(allStates);
    const waves = buildCalendarWaves({ votedStateIds: voted });
    for (const w of waves) {
      expect(w.isPast).toBe(true);
    }
  });

  it("uses currentTurn vs primaryEndTurn when no votedStateIds passed", () => {
    // primaryEndTurn = 100, currentTurn = 97 → turnsToEnd = 3.
    // Waves with turnsRemaining > 3 (i.e. 4, 5) are past.
    const waves = buildCalendarWaves({ currentTurn: 97, primaryEndTurn: 100 });
    const t5 = waves.find((w) => w.turnsRemaining === 5);
    const t4 = waves.find((w) => w.turnsRemaining === 4);
    const t3 = waves.find((w) => w.turnsRemaining === 3);
    const t2 = waves.find((w) => w.turnsRemaining === 2);
    expect(t5?.isPast).toBe(true);
    expect(t4?.isPast).toBe(true);
    expect(t3?.isPast).toBe(false);
    expect(t2?.isPast).toBe(false);
  });

  it("votedStateIds takes precedence over turn math when both are present", () => {
    // Even with current=97 / end=100, if Iowa is voted, the IA wave is past
    // (already true here). The point: ad-hoc admin force-resolves are honored.
    const voted = new Set(["IA", "NH"]);
    const waves = buildCalendarWaves({
      votedStateIds: voted,
      currentTurn: 0,
      primaryEndTurn: 100,
    });
    const iaWave = waves.find((w) => w.stateIds.includes("IA"));
    expect(iaWave?.isPast).toBe(true);
  });

  it("falls back to all-upcoming when neither input is present", () => {
    const waves = buildCalendarWaves({});
    for (const w of waves) {
      expect(w.isPast).toBe(false);
    }
  });
});

describe("resolvePrimaryTurnsToEnd", () => {
  const NOW = new Date("2026-05-31T15:00:00Z");

  it("uses primaryEndTurn − currentTurn when the turn field is present", () => {
    // The exact live-incident shape: turn counter behind wall-clock. The turn
    // field (48) wins over primaryEndTime (~1h away) so the UI matches the
    // engine instead of drifting to "Super Tuesday now".
    const turnsToEnd = resolvePrimaryTurnsToEnd({
      primaryEndTurn: 48,
      primaryEndTime: new Date("2026-05-31T16:00:00Z"),
      currentTurn: 21,
      now: NOW,
    });
    expect(turnsToEnd).toBe(27);
  });

  it("ignores wall-clock entirely when primaryEndTurn is set", () => {
    // primaryEndTime far in the past must NOT pull turnsToEnd negative when the
    // turn field still has the primary open.
    const turnsToEnd = resolvePrimaryTurnsToEnd({
      primaryEndTurn: 30,
      primaryEndTime: new Date("2020-01-01T00:00:00Z"),
      currentTurn: 25,
      now: NOW,
    });
    expect(turnsToEnd).toBe(5);
  });

  it("falls back to wall-clock hours only when primaryEndTurn is absent", () => {
    const turnsToEnd = resolvePrimaryTurnsToEnd({
      primaryEndTime: new Date("2026-05-31T18:30:00Z"), // 3.5h → ceil 4
      currentTurn: 10,
      now: NOW,
    });
    expect(turnsToEnd).toBe(4);
  });

  it("returns null when neither deadline is set", () => {
    expect(resolvePrimaryTurnsToEnd({ currentTurn: 5, now: NOW })).toBeNull();
  });
});

describe("isInStaggerWindow", () => {
  it("is true only for turnsToEnd in [0, 5] on the default compressed schedule", () => {
    expect(isInStaggerWindow(5)).toBe(true);
    expect(isInStaggerWindow(0)).toBe(true);
    expect(isInStaggerWindow(6)).toBe(false);
    expect(isInStaggerWindow(27)).toBe(false); // the live incident — NOT in window
    expect(isInStaggerWindow(-1)).toBe(false);
    expect(isInStaggerWindow(null)).toBe(false);
  });

  it("widens to [0, 40] on the stretched schedule", () => {
    // The compressed window (6 turns) would have excluded T-27; on the stretched
    // calendar the primary is already staggering by then.
    expect(isInStaggerWindow(40, STRETCHED_SCHEDULE)).toBe(true);
    expect(isInStaggerWindow(27, STRETCHED_SCHEDULE)).toBe(true);
    expect(isInStaggerWindow(0, STRETCHED_SCHEDULE)).toBe(true);
    expect(isInStaggerWindow(41, STRETCHED_SCHEDULE)).toBe(false);
    expect(isInStaggerWindow(-1, STRETCHED_SCHEDULE)).toBe(false);
    expect(isInStaggerWindow(null, STRETCHED_SCHEDULE)).toBe(false);
  });
});

describe("buildCalendarWaves — schedule awareness", () => {
  it("uses compressed offsets by default", () => {
    const waves = buildCalendarWaves({});
    expect(waves.map((w) => w.turnsRemaining)).toEqual([5, 4, 3, 2, 1, 0]);
  });

  it("uses stretched offsets when the stretched schedule is passed", () => {
    const schedule = getPrimaryWaveSchedule({ primaryCalendar: "stretched" });
    const waves = buildCalendarWaves({ schedule });
    expect(waves.map((w) => w.turnsRemaining)).toEqual([40, 32, 24, 16, 8, 0]);
    // Same state membership, just re-spaced (IA still leads).
    expect(waves[0].stateIds).toEqual(["IA"]);
  });

  it("computes isPast against the stretched spacing", () => {
    // primaryEndTurn=100, currentTurn=68 -> turnsToEnd=32. On stretched, waves
    // with turnsRemaining > 32 (i.e. 40) are past; 32 and below are not.
    const schedule = getPrimaryWaveSchedule({ primaryCalendar: "stretched" });
    const waves = buildCalendarWaves({ currentTurn: 68, primaryEndTurn: 100, schedule });
    const t40 = waves.find((w) => w.turnsRemaining === 40);
    const t32 = waves.find((w) => w.turnsRemaining === 32);
    const t24 = waves.find((w) => w.turnsRemaining === 24);
    expect(t40?.isPast).toBe(true);
    expect(t32?.isPast).toBe(false);
    expect(t24?.isPast).toBe(false);
  });
});

describe("pickDefaultSelectedState", () => {
  it("picks the first state of the earliest upcoming wave", () => {
    const waves = buildCalendarWaves({ currentTurn: 95, primaryEndTurn: 100 });
    // T-5 wave is past (turnsToEnd=5 ≮ 5 actually; recheck: turnsToEnd = 5,
    // wave with turnsRemaining=5 is NOT past per `<` strict; so first upcoming is T-5).
    const def = pickDefaultSelectedState(waves);
    expect(def).toBe("IA");
  });

  it("falls back to first state when every wave is past", () => {
    const allStates = buildCalendarWaves({}).flatMap((w) => w.stateIds);
    const waves = buildCalendarWaves({ votedStateIds: new Set(allStates) });
    expect(pickDefaultSelectedState(waves)).toBe("IA");
  });

  it("returns null for an empty wave list", () => {
    expect(pickDefaultSelectedState([])).toBe(null);
  });
});

describe("buildPrimaryViewModel", () => {
  it("converts byState votes into percentage slices", () => {
    const vm = buildPrimaryViewModel({
      candidates,
      byState: {
        IA: { c1: 60, c2: 30, c3: 10 },
        NH: { c1: 25, c2: 75 },
      },
    });
    expect(vm.perStateSlices.IA).toHaveLength(3);
    expect(vm.perStateSlices.IA[0].candidateId).toBe("c1");
    expect(vm.perStateSlices.IA[0].pct).toBeCloseTo(60);
    expect(vm.perStateSlices.IA[2].pct).toBeCloseTo(10);
    expect(vm.perStateSlices.NH[0].candidateId).toBe("c2");
    expect(vm.perStateSlices.NH[0].pct).toBeCloseTo(75);
  });

  it("slices sum to ~100 per state (within float tolerance)", () => {
    const vm = buildPrimaryViewModel({
      candidates,
      byState: { CA: { c1: 1, c2: 1, c3: 1 } },
    });
    const sum = vm.perStateSlices.CA.reduce((s, x) => s + x.pct, 0);
    expect(sum).toBeCloseTo(100);
  });

  it("returns empty slices for states with zero total votes", () => {
    const vm = buildPrimaryViewModel({
      candidates,
      byState: { CA: { c1: 0, c2: 0 } },
    });
    expect(vm.perStateSlices.CA).toEqual([]);
  });

  it("skips slices for unknown candidate IDs (defensive — votes for a withdrawn candidate)", () => {
    const vm = buildPrimaryViewModel({
      candidates,
      byState: { CA: { c1: 50, dropped: 50 } },
    });
    // Only c1 retained; the dropped candidate is filtered out
    expect(vm.perStateSlices.CA).toHaveLength(1);
    expect(vm.perStateSlices.CA[0].candidateId).toBe("c1");
  });

  it("populates stateNameById from input where provided, falls back to stateId", () => {
    const vm = buildPrimaryViewModel({
      candidates,
      byState: {},
      stateNameById: { IA: "Iowa" },
    });
    expect(vm.stateNameById.IA).toBe("Iowa");
    // NH not in input but appears in waves → falls back to "NH"
    expect(vm.stateNameById.NH).toBe("NH");
  });

  it("provides defaultSelectedStateId when waves are present", () => {
    const vm = buildPrimaryViewModel({ candidates, byState: {} });
    expect(vm.defaultSelectedStateId).toBe("IA");
  });
});
