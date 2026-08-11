import { describe, expect, it } from "vitest";
import {
  ALIGNMENT_ERAS,
  ALIGNMENT_GATES,
  ALIGNMENT_POLES,
  CRISIS_TURN_CAP,
  PER_NATION_TURN_CAP,
  joinGateForPoleCount,
  polesForYear,
  resolveAlignmentEra,
} from "./alignmentEras";

describe("resolveAlignmentEra", () => {
  it("returns the cold-war row through 1990 and post-cold-war from 1991", () => {
    expect(resolveAlignmentEra(1953).key).toBe("cold-war");
    expect(resolveAlignmentEra(1990).key).toBe("cold-war");
    expect(resolveAlignmentEra(1991).key).toBe("post-cold-war");
    expect(resolveAlignmentEra(2023).key).toBe("post-cold-war");
  });

  it("clamps years before the first era to the cold-war row", () => {
    expect(resolveAlignmentEra(1900).key).toBe("cold-war");
  });
});

describe("polesForYear", () => {
  it("is bipolar in 1953 — the movement does not exist yet", () => {
    expect(polesForYear(1953)).toEqual(["WEST", "EAST"]);
  });

  it("stays bipolar for the whole Cold War", () => {
    // Non-alignment is never a pole: it is the remainder no bloc persuaded, so
    // the movement's founding in 1961 changes nothing about the pole set.
    expect(polesForYear(1960)).toEqual(["WEST", "EAST"]);
    expect(polesForYear(1961)).toEqual(["WEST", "EAST"]);
    expect(polesForYear(1979)).toEqual(["WEST", "EAST"]);
  });

  it("is three-pole from 1991", () => {
    expect(polesForYear(1991)).toEqual(["WASHINGTON", "MOSCOW", "BEIJING"]);
    expect(polesForYear(2023)).toEqual(["WASHINGTON", "MOSCOW", "BEIJING"]);
  });
});

describe("joinGateForPoleCount", () => {
  it("loosens as poles multiply", () => {
    expect(joinGateForPoleCount(2)).toBe(50);
    expect(joinGateForPoleCount(3)).toBe(40);
    expect(joinGateForPoleCount(4)).toBe(35);
  });

  it("falls back to the tightest gate for an unexpected count", () => {
    expect(joinGateForPoleCount(1)).toBe(50);
    expect(joinGateForPoleCount(9)).toBe(35);
  });
});

describe("ALIGNMENT_ERAS", () => {
  it("gives the two-pole era an explicit positive axis pole", () => {
    const cold = ALIGNMENT_ERAS.find((e) => e.key === "cold-war")!;
    // The sign of the derived -100..+100 axis must NOT depend on array order.
    expect(cold.axisPositivePoleId).toBe("WEST");
    const modern = ALIGNMENT_ERAS.find((e) => e.key === "post-cold-war")!;
    expect(modern.axisPositivePoleId).toBeUndefined();
  });

  it("inherits cold-war poles into their post-cold-war successors", () => {
    const modern = ALIGNMENT_ERAS.find((e) => e.key === "post-cold-war")!;
    expect(modern.inherit).toEqual({ WEST: "WASHINGTON", EAST: "MOSCOW" });
  });

  it("never channels the UN, and marks the quiet channels as non-provoking", () => {
    for (const era of ALIGNMENT_ERAS) {
      expect(era.channels.some((c) => c.organizationId === "UN")).toBe(false);
      for (const c of era.channels) {
        expect(c.weight).toBeGreaterThan(0);
        expect(c.weight).toBeLessThanOrEqual(1);
        expect(era.poles).toContain(c.poleId);
      }
    }
    const cold = ALIGNMENT_ERAS.find((e) => e.key === "cold-war")!;
    const nato = cold.channels.find((c) => c.organizationId === "NATO")!;
    expect(nato.weight).toBe(1);
  });

  it("gives the two Cold War blocs matched channels", () => {
    // Channel weight per pole IS the balance of the era. The Commonwealth
    // deliberately carries none: stacked behind NATO it handed the West a
    // permanent advantage the Warsaw Pact had no way to answer.
    const cold = ALIGNMENT_ERAS.find((e) => e.key === "cold-war")!;
    const weightFor = (pole: string) =>
      cold.channels.filter((c) => c.poleId === pole).reduce((s, c) => s + c.weight, 0);
    expect(weightFor("WEST")).toBe(weightFor("EAST"));
    expect(cold.channels.some((c) => c.organizationId === "COMMONWEALTH")).toBe(false);
  });

  it("never channels the Non-Aligned Movement — it is not a bloc that pushes", () => {
    for (const era of ALIGNMENT_ERAS) {
      expect(era.channels.some((c) => c.organizationId === "NON_ALIGNED")).toBe(false);
    }
  });

  it("gives every pole a stable id, label and a SEMANTIC token — never a hex", () => {
    // 11 themes ship with the app; a raw colour breaks all of them.
    const allowed = ["info", "error", "warning", "success"];
    for (const [id, pole] of Object.entries(ALIGNMENT_POLES)) {
      expect(pole.id).toBe(id);
      expect(pole.label.length).toBeGreaterThan(0);
      expect(allowed, id).toContain(pole.accentToken);
      expect(JSON.stringify(pole)).not.toMatch(/#[0-9a-f]{6}/i);
    }
    // Every pole is a bloc somebody leads; non-alignment is the remainder, so
    // it is deliberately absent from the pole table entirely.
    expect(ALIGNMENT_POLES).not.toHaveProperty("NAM");
    for (const pole of Object.values(ALIGNMENT_POLES)) {
      expect(pole.leaderCountryId, `${pole.id} must name the bloc's leader`).toBeTruthy();
    }
  });

  it("keeps the poles of any one start visually distinct", () => {
    // Two poles must never share a token within a start, or the Ledger's bars
    // and the map become unreadable.
    for (const year of [1953, 1979, 2019]) {
      const tokens = polesForYear(year).map((id) => ALIGNMENT_POLES[id].accentToken);
      expect(new Set(tokens).size, `year ${year}`).toBe(tokens.length);
    }
  });

  it("exposes era-invariant gates", () => {
    expect(ALIGNMENT_GATES.locked).toBe(85);
    expect(ALIGNMENT_GATES.nonAligned).toBe(20);
    expect(PER_NATION_TURN_CAP).toBe(5);
  });

  it("lets a nation in crisis move further, but not without limit", () => {
    // A flashpoint lifts the brake; it does not remove it.
    expect(CRISIS_TURN_CAP).toBeGreaterThan(PER_NATION_TURN_CAP);
    expect(CRISIS_TURN_CAP).toBe(7.5);
  });

  it("keeps a single turn far short of rewriting a nation", () => {
    // Shares total 100. Even in crisis, swinging a country takes many turns of
    // sustained effort rather than one decisive cheque.
    expect(CRISIS_TURN_CAP).toBeLessThan(20);
  });
});
