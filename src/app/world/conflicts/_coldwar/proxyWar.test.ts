import { describe, it, expect } from "vitest";
import {
  SIDE_CONFIG,
  ORDER,
  CONFLICTS,
  supplyMult,
  playerSupply,
  reserve,
  control,
  outcome,
  type ProxyState,
} from "./proxyWar";

const base: ProxyState = { commit: {}, logi: {}, cohesion: 72 };

describe("proxyWar", () => {
  it("scales cohesion into a 0.55–1.0 supply multiplier", () => {
    expect(supplyMult(0)).toBeCloseTo(0.55);
    expect(supplyMult(100)).toBeCloseTo(1.0);
    expect(supplyMult(72)).toBeCloseTo(0.874);
  });

  it("West reserve = budget minus baseline commitments", () => {
    // 6800 − (1200+800+1100+700) = 3000
    expect(SIDE_CONFIG.west.total).toBe(6800);
    expect(reserve(base, "west")).toBe(3000);
    expect(ORDER).toHaveLength(4);
  });

  it("East starts over-committed (negative reserve)", () => {
    // 6400 − (3400+950+1500+1300) = −750
    expect(SIDE_CONFIG.east.total).toBe(6400);
    expect(reserve(base, "east")).toBe(-750);
  });

  it("caps player supply at 85% even with heavy logistics", () => {
    expect(playerSupply({ ...base, logi: { afg: 2000 } }, "afg", "west")).toBe(85);
  });

  it("control is computed per side from cohesion-adjusted supply", () => {
    // afg @ cohesion 72 — West sees 13% control, East sees 84%
    expect(control(base, "afg", "west")).toBe(13);
    expect(control(base, "afg", "east")).toBe(84);
  });

  it("labels outcome bands from the player side's perspective", () => {
    expect(outcome(66, "west").label).toBe("Western-backed victory likely");
    expect(outcome(40, "west").label).toBe("East-backed advantage");
    expect(outcome(13, "west").label).toBe("East-backed victory likely");
    expect(outcome(66, "east").label).toBe("East-backed victory likely");
    expect(outcome(40, "east").label).toBe("West-backed advantage");
    expect(outcome(20, "east").label).toBe("West-backed victory likely");
  });

  it("ships the four shared theaters", () => {
    expect(Object.keys(CONFLICTS).sort()).toEqual(["afg", "ago", "horn", "nic"]);
    expect(CONFLICTS.afg.superpower).toBe(true);
  });
});
