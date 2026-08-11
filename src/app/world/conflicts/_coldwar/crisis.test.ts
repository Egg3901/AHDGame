import { describe, it, expect } from "vitest";
import {
  CRISIS,
  credMult,
  step,
  crisisDefconColor,
  crisisDefconNote,
  nerveColor,
  credColor,
  type CrisisCore,
} from "./crisis";

// cred 50 → cf 1.0 gives clean integer dents (escalate −15, hold −7).
const base: CrisisCore = { rung: 4, nerve: 68, pc: 60, defcon: 3, cred: 50 };

describe("credMult", () => {
  it("scales 0.5 (broken bloc) → 1.5 (united)", () => {
    expect(credMult(0)).toBe(0.5);
    expect(credMult(50)).toBe(1);
    expect(credMult(100)).toBe(1.5);
  });
});

describe("step · escalate", () => {
  it("climbs a rung, lowers DEFCON, dents nerve by 15·cf", () => {
    const r = step(base, "escalate");
    expect(r.rung).toBe(5);
    expect(r.defcon).toBe(2);
    expect(r.nerve).toBe(53);
    expect(r.outcome).toBe("war"); // nerve 53 > 38 at the nuclear rung
  });
  it("at the nuclear rung, a broken nerve (≤38) looks away — no war", () => {
    const r = step({ ...base, nerve: 50 }, "escalate");
    expect(r.nerve).toBe(35);
    expect(r.outcome).toBeNull();
  });
  it("driving nerve to 0 wins the crisis (Moscow blinks)", () => {
    const r = step({ ...base, nerve: 15 }, "escalate");
    expect(r.nerve).toBe(0);
    expect(r.outcome).toBe("victory");
  });
});

describe("step · hold", () => {
  it("dents nerve by 7·cf, no escalation", () => {
    const r = step(base, "hold");
    expect(r.rung).toBe(4);
    expect(r.nerve).toBe(61);
    expect(r.outcome).toBeNull();
  });
});

describe("step · channel", () => {
  it("blocks when capital < 10", () => {
    const r = step({ ...base, pc: 5 }, "channel");
    expect(r.blocked).toBe(true);
    expect(r.pc).toBe(5);
  });
  it("spends 10 PC, eases nerve + a rung, raises DEFCON", () => {
    const r = step(base, "channel");
    expect(r.pc).toBe(50);
    expect(r.nerve).toBe(56);
    expect(r.rung).toBe(3);
    expect(r.defcon).toBe(4);
  });
});

describe("step · standdown", () => {
  it("drops a rung; reaching rung 0 is a climbdown", () => {
    const r = step({ ...base, rung: 1 }, "standdown");
    expect(r.rung).toBe(0);
    expect(r.defcon).toBe(4);
    expect(r.outcome).toBe("climbdown");
  });
  it("clamps nerve at 100", () => {
    const r = step({ ...base, rung: 3, nerve: 95 }, "standdown");
    expect(r.nerve).toBe(100);
  });
});

describe("presentational helpers", () => {
  it("DEFCON 1 is the cocked pistol", () => {
    expect(crisisDefconColor(1)).toBe("#ff3b3b");
    expect(crisisDefconNote(1)).toBe("COCKED PISTOL");
  });
  it("nerve color: calm green → wavering amber → defiant (side color)", () => {
    expect(nerveColor(30, "#ef8a8a")).toBe("#86d978");
    expect(nerveColor(50, "#ef8a8a")).toBe("#eab308");
    expect(nerveColor(70, "#ef8a8a")).toBe("#ef8a8a");
  });
  it("cred color thresholds", () => {
    expect(credColor(70)).toBe("#86d978");
    expect(credColor(50)).toBe("#eab308");
    expect(credColor(49)).toBe("#ff5a3c");
  });
});

describe("CRISIS config", () => {
  it("both sides carry 5 ladder rungs ending at the nuclear alert", () => {
    for (const side of ["west", "east"] as const) {
      expect(CRISIS[side].rungs).toHaveLength(5);
      expect(CRISIS[side].rungs[4]).toContain("Nuclear alert");
    }
  });
  it("seeds credibility from the matching bloc cohesion key", () => {
    expect(CRISIS.west.cohesionKey).toBe("ahd_west_cohesion");
    expect(CRISIS.east.cohesionKey).toBe("ahd_east_cohesion");
  });
  it("swaps whose nerve is on the line", () => {
    expect(CRISIS.west.nerveLabel).toContain("SOVIET");
    expect(CRISIS.east.nerveLabel).toContain("AMERICAN");
  });
});
