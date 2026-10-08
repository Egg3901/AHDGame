import { describe, it, expect } from "vitest";
import { ELECTION_DAY_TURNS, FINAL_POOL_SHARE } from "@/lib/electionEngine/voteCalculations";
import { mulberry32 } from "./simulateResults";
import { computeUnitResult } from "./computeResults";
import { US_POLL_CLOSE_ET_HOURS, pollCloseEtHour } from "./usPollClosing";
import {
  NIGHT_CALL_SAFETY,
  NIGHT_COUNTING_FLOOR,
  NIGHT_FIRST_CLOSE_FRACTION,
  NIGHT_LAST_CLOSE_FRACTION,
  NIGHT_LEADER_FLOOR,
  NIGHT_NOISE_MAX,
  computePresidentialNight,
  finalTurnVoteRatio,
  finalTurnVoteRatioForElection,
  reportingAt,
  unitSchedule,
  type NightUnitInput,
  type PresidentialNightInput,
} from "./presidentialNight";

const ELECTION = "e1";
const START = Date.UTC(2024, 10, 6, 0, 0, 0);
const WINDOW = 60 * 60 * 1000;
const RATIO = finalTurnVoteRatio(24);

const STATES = Object.keys(US_POLL_CLOSE_ET_HOURS);

function makeUnits(seed: number, count = STATES.length): NightUnitInput[] {
  const rand = mulberry32(seed);
  return STATES.slice(0, count).map((id) => {
    const total = 50_000 + Math.floor(rand() * 5_000_000);
    const a = 0.3 + rand() * 0.4;
    const third = rand() * 0.06;
    return {
      unitId: id,
      name: id,
      weight: 3 + Math.floor(rand() * 20),
      votes: {
        A: Math.round(total * a),
        B: Math.round(total * (1 - a - third)),
        C: Math.round(total * third),
      },
    };
  });
}

function run(units: NightUnitInput[], nowMs: number, ratio = RATIO) {
  const input: PresidentialNightInput = {
    electionId: ELECTION,
    units,
    totalEv: units.reduce((s, u) => s + u.weight, 0),
    evNeeded: Math.floor(units.reduce((s, u) => s + u.weight, 0) / 2) + 1,
    windowStartMs: START,
    windowMs: WINDOW,
    nowMs,
    finalTurnRatio: ratio,
  };
  return computePresidentialNight(input);
}

describe("finalTurnVoteRatio", () => {
  it("prices the last turn from the real weighting (not a hardcoded 7.5%)", () => {
    const last = FINAL_POOL_SHARE / ELECTION_DAY_TURNS;
    expect(finalTurnVoteRatio(24)).toBeCloseTo(last / (1 - last), 9);
    expect(finalTurnVoteRatio(13)).toBeCloseTo(last / (1 - last), 9);
  });

  it("short windows spread the pool evenly, so the last turn is bigger", () => {
    expect(finalTurnVoteRatio(4)).toBeCloseTo(1 / 3, 9);
    expect(finalTurnVoteRatio(1)).toBe(Number.POSITIVE_INFINITY);
  });

  it("derives the window from election turns (primary end anchors the general)", () => {
    const r = finalTurnVoteRatioForElection({ startTurn: 0, primaryEndTurn: 100, endTurn: 124 });
    expect(r).toBeCloseTo(finalTurnVoteRatio(25), 9);
    expect(finalTurnVoteRatioForElection({})).toBeCloseTo(1 / 3, 9);
  });
});

describe("poll closing schedule", () => {
  it("covers all 50 states and DC", () => {
    expect(STATES).toHaveLength(51);
  });

  it("closes states in real-world order, inside the window", () => {
    const sched = STATES.map((id) => unitSchedule(ELECTION, id, START, WINDOW));
    for (const a of sched) {
      expect(a.closeMs).toBeGreaterThan(START + (NIGHT_FIRST_CLOSE_FRACTION - 0.01) * WINDOW);
      expect(a.closeMs).toBeLessThan(START + (NIGHT_LAST_CLOSE_FRACTION + 0.01) * WINDOW);
    }
    for (const a of sched) {
      for (const b of sched) {
        if (pollCloseEtHour(a.unitId) < pollCloseEtHour(b.unitId)) {
          expect(a.closeMs).toBeLessThan(b.closeMs);
        }
      }
    }
  });

  it("jitter only separates states inside a batch", () => {
    const closes = ["GA", "IN", "KY", "SC", "VT", "VA"].map(
      (id) => unitSchedule(ELECTION, id, START, WINDOW).closeMs
    );
    expect(new Set(closes).size).toBeGreaterThan(1);
    expect(Math.max(...closes) - Math.min(...closes)).toBeLessThan(0.02 * WINDOW);
  });

  it("ME/NE districts close with their state", () => {
    expect(pollCloseEtHour("ME_CD2")).toBe(pollCloseEtHour("ME"));
    expect(pollCloseEtHour("NE_CD1")).toBe(pollCloseEtHour("NE"));
  });

  it("leaves room after the last closing for counting", () => {
    const ak = unitSchedule(ELECTION, "AK", START, WINDOW);
    expect(START + WINDOW - ak.closeMs).toBeGreaterThan(ak.rampMs);
  });

  it("is deterministic", () => {
    expect(unitSchedule(ELECTION, "OH", START, WINDOW)).toEqual(
      unitSchedule(ELECTION, "OH", START, WINDOW)
    );
  });
});

describe("board wipe", () => {
  it("starts grey: every state uncalled, no lean, 0% reporting", () => {
    const { units, night } = run(makeUnits(1), START);
    for (const u of units) {
      expect(u.nightStatus).toBe("polls_open");
      expect(u.reportingPct).toBe(0);
      expect(u.called).toBe(false);
      expect(u.leaderId).toBeUndefined();
      expect(u.totalVotes).toBe(0);
      expect(u.candidates).toEqual([]);
      expect(new Date(u.pollsCloseAt!).getTime()).toBeGreaterThan(START);
    }
    expect(night.statesCalled).toBe(0);
    expect(night.calledEv).toEqual({});
    expect(night.feed).toEqual([]);
    expect(night.statesPollsClosed).toBe(0);
    expect(night.nextClose?.stateIds.sort()).toEqual(["GA", "IN", "KY", "SC", "VA", "VT"]);
  });
});

describe("fog of war", () => {
  const units = makeUnits(2);

  it("shows no leader right after close, then lean, then call", () => {
    const s = unitSchedule(ELECTION, "GA", START, WINDOW);
    const ga = (t: number) => run(units, t).units.find((u) => u.id === "GA")!;
    expect(ga(s.closeMs - 1000).nightStatus).toBe("polls_open");
    expect(ga(s.closeMs + 1).nightStatus).toBe("counting");
    const early = ga(s.closeMs + s.rampMs * 0.03);
    expect(early.reportingPct).toBeGreaterThanOrEqual(NIGHT_COUNTING_FLOOR);
    expect(early.reportingPct).toBeLessThan(NIGHT_LEADER_FLOOR);
    expect(early.nightStatus).toBe("too_early");
    expect(early.leaderId).toBeUndefined();
    const mid = ga(s.closeMs + s.rampMs * 0.3);
    expect(["leaning", "too_close", "called"]).toContain(mid.nightStatus);
    expect(mid.leaderId).toBeDefined();
  });

  it("noise shrinks and shares converge on the real tally at the cap", () => {
    const wide = makeUnits(3).map((u) => ({ ...u, votes: { A: 600_000, B: 400_000 } }));
    const s = unitSchedule(ELECTION, "GA", START, WINDOW);
    const err = (t: number) => {
      const u = run(wide, t).units.find((x) => x.id === "GA")!;
      const a = u.candidates.find((c) => c.candidateId === "A")!;
      return Math.abs(a.voteShare - 60);
    };
    // Worst-case displayed error is bounded by the noise envelope.
    for (const f of [0.1, 0.25, 0.5, 0.75]) {
      const t = s.closeMs + s.rampMs * f;
      const q = reportingAt(s, t) / s.cap;
      const bound = NIGHT_NOISE_MAX * Math.pow(1 - q, 2) * 100 * 2 + 1e-6;
      expect(err(t)).toBeLessThanOrEqual(bound);
    }
    expect(err(s.closeMs + s.rampMs * 5)).toBeLessThan(1e-6);
    const final = run(wide, s.closeMs + s.rampMs * 5).units.find((x) => x.id === "GA")!;
    expect(final.totalVotes).toBe(1_000_000);
    expect(final.candidates[0].votes).toBe(600_000);
  });

  it("is identical for every viewer at a fixed now", () => {
    const t = START + 0.4 * WINDOW;
    expect(run(units, t)).toEqual(run(units, t));
  });

  it("never hits 100% reporting inside the window", () => {
    for (const t of [START + WINDOW * 0.9, START + WINDOW]) {
      for (const u of run(units, t).units) expect(u.reportingPct).toBeLessThan(100);
    }
  });

  it("does not leak the real tally in displayed totals while counting", () => {
    const t = START + 0.3 * WINDOW;
    const { units: out } = run(units, t);
    for (const u of out) {
      const real = units.find((x) => x.unitId === u.id)!;
      const realTotal = Object.values(real.votes).reduce((s, v) => s + v, 0);
      expect(u.totalVotes).toBeLessThanOrEqual(realTotal);
    }
  });
});

describe("calls are never reversed", () => {
  it("fuzz: a called leader still leads after the worst-case final turn", () => {
    let calledSeen = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const rand = mulberry32(seed * 7919);
      const units = makeUnits(seed).map((u) => {
        // Cluster margins around the call threshold to stress the boundary.
        const total = 1_000_000;
        const m = RATIO * NIGHT_CALL_SAFETY * (0.5 + rand() * 1.5);
        const leader = rand() < 0.5 ? "A" : "B";
        const other = leader === "A" ? "B" : "A";
        const lead = Math.round((total * (1 + m)) / 2);
        return { ...u, votes: { [leader]: lead, [other]: total - lead } };
      });
      const { units: out } = run(units, START + WINDOW);
      for (const o of out) {
        if (!o.called) continue;
        calledSeen++;
        const real = units.find((x) => x.unitId === o.id)!;
        const counted = Object.values(real.votes).reduce((s, v) => s + v, 0);
        const remaining = counted * RATIO;
        const leaderVotes = real.votes[o.calledFor!];
        const rival = Object.entries(real.votes)
          .filter(([c]) => c !== o.calledFor)
          .map(([, v]) => v)
          .sort((a, b) => b - a)[0];
        // All remaining votes to the runner-up.
        expect(leaderVotes).toBeGreaterThan(rival + remaining);
        // Displayed leader never contradicts the call.
        expect(o.leaderId).toBe(o.calledFor);
      }
    }
    expect(calledSeen).toBeGreaterThan(100);
  });

  it("does not call a state inside the worst-case swing", () => {
    const units = makeUnits(4).map((u) => ({
      ...u,
      votes: { A: 500_000 * (1 + RATIO * 0.9), B: 500_000 * (1 - RATIO * 0.9) },
    }));
    const { units: out, night } = run(units, START + WINDOW);
    expect(out.some((u) => u.called)).toBe(false);
    expect(night.statesCalled).toBe(0);
    expect(out.filter((u) => u.nightStatus === "leaning").length).toBeGreaterThan(30);
  });

  it("marks near-ties too close once well reported", () => {
    const units = makeUnits(5).map((u) => ({ ...u, votes: { A: 500_500, B: 499_500 } }));
    const { units: out } = run(units, START + WINDOW);
    expect(out.filter((u) => u.nightStatus === "too_close").length).toBeGreaterThan(20);
  });

  it("hands off seamlessly: every in-window call matches the resolved result", () => {
    for (let seed = 1; seed <= 40; seed++) {
      const rand = mulberry32(seed * 104729);
      const units = makeUnits(seed);
      const { units: out } = run(units, START + WINDOW);
      for (const o of out) {
        if (!o.called) continue;
        const real = units.find((x) => x.unitId === o.id)!;
        // The final turn adds up to RATIO of the counted vote, split adversarially
        // or randomly; the resolved unit must still call for the same candidate.
        const counted = Object.values(real.votes).reduce((s, v) => s + v, 0);
        const toRival = rand() < 0.5 ? 1 : rand();
        const final: Record<string, number> = { ...real.votes };
        const rivalId = Object.keys(final).find((c) => c !== o.calledFor)!;
        final[rivalId] += counted * RATIO * toRival;
        final[o.calledFor!] += counted * RATIO * (1 - toRival);
        const resolved = computeUnitResult({
          electionId: ELECTION,
          unitId: o.id,
          name: o.name,
          weight: o.weight,
          votes: final,
          isEnded: true,
          baselineReportingPct: 0,
          finalHourProgress: null,
        });
        expect(resolved.called).toBe(true);
        expect(resolved.calledFor).toBe(o.calledFor);
        expect(resolved.reportingPct).toBe(100);
      }
    }
  });
});

describe("monotonic night", () => {
  it("reporting, called set, EV and feed only grow", () => {
    const units = makeUnits(6);
    let prev = run(units, START);
    for (let i = 1; i <= 300; i++) {
      const next = run(units, START + (i / 300) * WINDOW);
      next.units.forEach((u, idx) => {
        const p = prev.units[idx];
        expect(u.reportingPct).toBeGreaterThanOrEqual(p.reportingPct);
        if (p.called) {
          expect(u.called).toBe(true);
          expect(u.calledFor).toBe(p.calledFor);
        }
      });
      expect(next.night.statesCalled).toBeGreaterThanOrEqual(prev.night.statesCalled);
      for (const [cid, ev] of Object.entries(prev.night.calledEv)) {
        expect(next.night.calledEv[cid]).toBeGreaterThanOrEqual(ev);
      }
      expect(next.night.feed.slice(0, prev.night.feed.length)).toEqual(prev.night.feed);
      prev = next;
    }
    expect(prev.night.statesCalled).toBeGreaterThan(0);
    expect(prev.night.statesPollsClosed).toBe(STATES.length);
    expect(prev.night.nextClose).toBeNull();
  });

  it("a late joiner sees the same history as a continuous viewer", () => {
    const units = makeUnits(7);
    const t = START + 0.55 * WINDOW;
    const late = run(units, t).night.feed;
    const later = run(units, START + 0.9 * WINDOW).night.feed;
    expect(later.slice(0, late.length)).toEqual(late);
    for (const e of late) expect(new Date(e.at).getTime()).toBeLessThanOrEqual(t);
    expect(late.filter((e) => e.kind === "call").every((e) => e.candidateId)).toBe(true);
  });

  it("the feed orders closings and calls by time", () => {
    const { night } = run(makeUnits(8), START + WINDOW);
    const times = night.feed.map((e) => new Date(e.at).getTime());
    expect([...times].sort((a, b) => a - b)).toEqual(times);
    const firstCall = night.feed.findIndex((e) => e.kind === "call");
    const callState = night.feed[firstCall].stateId;
    const closeIdx = night.feed.findIndex(
      (e) => e.kind === "polls_close" && e.stateId === callState
    );
    expect(closeIdx).toBeGreaterThanOrEqual(0);
    expect(closeIdx).toBeLessThan(firstCall);
  });

  it("national tallies count only called states, news style", () => {
    const units = makeUnits(9);
    const { units: out, night } = run(units, START + WINDOW);
    const byCandidate: Record<string, number> = {};
    for (const u of out)
      if (u.called) byCandidate[u.calledFor!] = (byCandidate[u.calledFor!] ?? 0) + u.weight;
    expect(night.calledEv).toEqual(byCandidate);
    expect(night.totalStates).toBe(STATES.length);
    expect(night.statesCalled).toBe(out.filter((u) => u.called).length);
  });

  it("does not count Maine and Nebraska district units as extra states", () => {
    const units = makeUnits(9);
    const districts = ["ME_CD1", "ME_CD2", "NE_CD2"].map((unitId) => ({
      ...units[0],
      unitId,
      name: unitId,
      weight: 1,
    }));
    const { units: out, night } = run([...units, ...districts], START + WINDOW);
    expect(night.totalStates).toBe(STATES.length);
    expect(night.statesPollsClosed).toBe(STATES.length);
    expect(night.statesCalled).toBe(out.filter((u) => u.called && !/_CD\d$/.test(u.id)).length);
  });
});
