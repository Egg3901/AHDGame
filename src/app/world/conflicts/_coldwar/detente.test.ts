import { describe, it, expect } from "vitest";
import {
  DETENTE,
  STAND_GOODWILL,
  STAND_COST,
  posture,
  goodwillAfterTable,
  goodwillAfterStand,
  canStandDown,
  nextDefcon,
  defconMeta,
  pcColor,
} from "./detente";

describe("posture", () => {
  it("steps BELLIGERENT → GUARDED → RECEPTIVE → CONCILIATORY", () => {
    expect(posture(0).label).toBe("BELLIGERENT");
    expect(posture(24).label).toBe("BELLIGERENT");
    expect(posture(25).label).toBe("GUARDED");
    expect(posture(49).label).toBe("GUARDED");
    expect(posture(50).label).toBe("RECEPTIVE");
    expect(posture(71).label).toBe("RECEPTIVE");
    expect(posture(72).label).toBe("CONCILIATORY");
    expect(posture(100).label).toBe("CONCILIATORY");
  });
});

describe("goodwill arithmetic", () => {
  it("table adds trust, capped at 100", () => {
    expect(goodwillAfterTable(10, 12)).toBe(22);
    expect(goodwillAfterTable(90, 24)).toBe(100);
  });
  it("stand-down drops 40, floored at 0", () => {
    expect(goodwillAfterStand(55)).toBe(15);
    expect(goodwillAfterStand(10)).toBe(0);
  });
});

describe("canStandDown gate", () => {
  it("needs goodwill ≥ 55, defcon < 5, and pc ≥ 15", () => {
    expect(canStandDown(STAND_GOODWILL, 3, STAND_COST)).toBe(true);
    expect(canStandDown(54, 3, 60)).toBe(false); // goodwill too low
    expect(canStandDown(80, 5, 60)).toBe(false); // already at peace
    expect(canStandDown(80, 3, 14)).toBe(false); // not enough capital
  });
});

describe("nextDefcon", () => {
  it("eases one level, capped at DEFCON 5", () => {
    expect(nextDefcon(3)).toBe(4);
    expect(nextDefcon(4)).toBe(5);
    expect(nextDefcon(5)).toBe(5);
  });
});

describe("defconMeta", () => {
  it("brink ≤2, fade out ≥5, else heightened", () => {
    expect(defconMeta(2)).toEqual({ color: "#ff5a3c", note: "superpower brink" });
    expect(defconMeta(3).note).toBe("heightened");
    expect(defconMeta(5)).toEqual({ color: "#86d978", note: "fade out" });
  });
});

describe("pcColor", () => {
  it("red < 15, amber < 30, else neutral", () => {
    expect(pcColor(14)).toBe("#ff5a3c");
    expect(pcColor(29)).toBe("#eab308");
    expect(pcColor(30)).toBe("#f3f1ea");
  });
});

describe("DETENTE config", () => {
  it("both sides carry 6 concessions (2 major) and 4 gated responses", () => {
    for (const side of ["west", "east"] as const) {
      const c = DETENTE[side];
      expect(c.concessions).toHaveLength(6);
      expect(c.concessions.filter((x) => x.major)).toHaveLength(2);
      expect(c.responses.map((r) => r.gate)).toEqual([25, 40, 55, 72]);
    }
  });
  it("persists political capital under per-side keys", () => {
    expect(DETENTE.west.pcKey).toBe("ahd_west_pc");
    expect(DETENTE.east.pcKey).toBe("ahd_east_pc");
  });
  it("swaps the responder per side", () => {
    expect(DETENTE.west.respLabel).toContain("MOSCOW");
    expect(DETENTE.east.respLabel).toContain("WASHINGTON");
  });
});
