import { describe, it, expect } from "vitest";
import { applyDebateDecay } from "../debateDecay";
import { DEBATE_DECAY_INTERVAL_MS } from "../statsConstants";

const t0 = new Date("2026-06-18T00:00:00.000Z");
const plus = (ms: number) => new Date(t0.getTime() + ms);

describe("applyDebateDecay", () => {
  it("seeds the anchor and does not decay when no anchor exists", () => {
    const r = applyDebateDecay(7, undefined, t0);
    expect(r.debate).toBe(7);
    expect(r.anchor.getTime()).toBe(t0.getTime());
  });

  it("does not decay before a full window elapses", () => {
    const r = applyDebateDecay(7, t0, plus(DEBATE_DECAY_INTERVAL_MS - 1));
    expect(r.debate).toBe(7);
    expect(r.anchor.getTime()).toBe(t0.getTime());
  });

  it("decays one point and advances the anchor after one window", () => {
    const r = applyDebateDecay(7, t0, plus(DEBATE_DECAY_INTERVAL_MS));
    expect(r.debate).toBe(6);
    expect(r.anchor.getTime()).toBe(t0.getTime() + DEBATE_DECAY_INTERVAL_MS);
  });

  it("decays by the number of full windows elapsed", () => {
    const r = applyDebateDecay(7, t0, plus(DEBATE_DECAY_INTERVAL_MS * 3 + 5));
    expect(r.debate).toBe(4);
    expect(r.anchor.getTime()).toBe(t0.getTime() + DEBATE_DECAY_INTERVAL_MS * 3);
  });

  it("clamps debate at the floor but still advances the anchor by all windows", () => {
    const r = applyDebateDecay(2, t0, plus(DEBATE_DECAY_INTERVAL_MS * 5));
    expect(r.debate).toBe(1);
    expect(r.anchor.getTime()).toBe(t0.getTime() + DEBATE_DECAY_INTERVAL_MS * 5);
  });
});
