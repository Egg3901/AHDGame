import { describe, expect, it } from "vitest";
import {
  PRIMARY_NIGHT_MS,
  activePrimaryNights,
  isPrimaryStateSettled,
  primaryCallFloor,
  primaryNightCloseFraction,
  primaryNightForParty,
  primaryNightState,
} from "./primaryNight";

const T0 = Date.UTC(2026, 9, 9, 20, 0, 0);
const WAVE = ["AL", "AR", "CA", "CO", "ME", "MA", "MN", "NC", "OK", "TN", "TX", "UT", "VT", "VA"];
const base = {
  electionId: "e1",
  partyId: "1",
  waveStates: WAVE,
  finalVotes: { a: 6000, b: 4000 },
  waveAtMs: T0,
};
const at = (stateId: string, frac: number) =>
  primaryNightState({ ...base, stateId, nowMs: T0 + frac * PRIMARY_NIGHT_MS });

describe("primary night schedule", () => {
  it("closes every state of a big wave at its own time, in real closing order", () => {
    const fracs = WAVE.map((s) => primaryNightCloseFraction("e1", s, WAVE));
    expect(new Set(fracs.map((f) => f.toFixed(5))).size).toBe(WAVE.length);
    // Vermont/Virginia (7 PM ET) close before California (11 PM ET).
    expect(primaryNightCloseFraction("e1", "VT", WAVE)).toBeLessThan(
      primaryNightCloseFraction("e1", "CA", WAVE)
    );
    for (const f of fracs) {
      expect(f).toBeGreaterThan(0);
      expect(f).toBeLessThan(0.7);
    }
  });

  it("shows polls open, then climbs, then settles on the final result", () => {
    expect(at("CA", 0.01).status).toBe("polls_open");
    const mid = at("CA", 0.6);
    expect(mid.reportingPct).toBeGreaterThan(0);
    expect(mid.reportingPct).toBeLessThan(100);
    const end = at("CA", 1);
    expect(end.status).toBe("final");
    expect(end.votes).toEqual(base.finalVotes);
  });

  it("never shows reporting going backwards", () => {
    let prev = 0;
    for (let f = 0; f <= 1; f += 0.01) {
      const r = at("TX", f).reportingPct;
      expect(r).toBeGreaterThanOrEqual(prev);
      prev = r;
    }
  });

  it("reveals no numbers before a leader can be shown", () => {
    const early = at("TX", 0.01);
    expect(Object.keys(early.votes)).toHaveLength(0);
    expect(isPrimaryStateSettled(early)).toBe(false);
  });

  it("calls blowouts early and close races late", () => {
    expect(primaryCallFloor(30)).toBeLessThan(primaryCallFloor(3));
    const close = primaryNightState({
      ...base,
      stateId: "TX",
      finalVotes: { a: 5020, b: 4980 },
      nowMs: T0 + 0.35 * PRIMARY_NIGHT_MS,
    });
    const blowout = primaryNightState({
      ...base,
      stateId: "TX",
      finalVotes: { a: 8000, b: 2000 },
      nowMs: T0 + 0.35 * PRIMARY_NIGHT_MS,
    });
    expect(blowout.called).toBe(true);
    expect(close.called).toBe(false);
  });

  it("never shows a called state's leader trailing", () => {
    for (let f = 0; f <= 1; f += 0.02) {
      const s = at("MA", f);
      if (!s.called || Object.keys(s.votes).length === 0) continue;
      expect(s.votes.a).toBeGreaterThan(s.votes.b);
    }
  });
});

describe("active nights", () => {
  const waves = [
    { statesVoted: ["IA"], recordedAt: new Date(T0 - 2 * PRIMARY_NIGHT_MS) },
    { statesVoted: ["NH"], recordedAt: new Date(T0) },
  ];

  it("lists only states whose night is still running", () => {
    const nights = activePrimaryNights(waves, T0 + 1000);
    expect([...nights.keys()]).toEqual(["NH"]);
    expect(activePrimaryNights(waves, T0 + PRIMARY_NIGHT_MS).size).toBe(0);
  });

  it("hides an uncalled state's real result for the party", () => {
    const { byState, hidden } = primaryNightForParty({
      electionId: "e1",
      partyId: "1",
      waves,
      stateVotes: { NH: { a: 5100, b: 4900 }, IA: { a: 1, b: 2 } },
      nowMs: T0 + 0.05 * PRIMARY_NIGHT_MS,
    });
    expect(hidden.has("NH")).toBe(true);
    expect(byState.IA).toBeUndefined();
  });
});
