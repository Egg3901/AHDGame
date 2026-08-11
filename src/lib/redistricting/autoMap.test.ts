import { describe, it, expect } from "vitest";
import {
  autoMap,
  autoMapAll,
  AUTO_MAP_STRATEGIES,
  effectiveRedistrictCaps,
  mapSignature,
  type AutoMapStrategy,
} from "./autoMap";
import { validateRedistrictMap, computeEfficiencyGap } from "./legality";
import { resolveRedistrictCaps, type RedistrictCaps } from "./caps";
import type { DistrictSquares } from "@/lib/db/types/congressionalDistrict";

const N = 10;
// Moderate state: slightly left budget over 10 districts (160 squares).
const BUDGET: DistrictSquares = { left: 70, right: 66, grey: 24 };
// Legislature-drawn + moderate compactness + moderate fairness.
const CAPS: RedistrictCaps = resolveRedistrictCaps(2, 1, 1, N);

function sum(map: DistrictSquares[]): DistrictSquares {
  return map.reduce(
    (a, d) => ({ left: a.left + d.left, right: a.right + d.right, grey: a.grey + d.grey }),
    { left: 0, right: 0, grey: 0 }
  );
}
const rightSeats = (m: DistrictSquares[]) => m.filter((d) => d.right - d.left > 0).length;
const leftSeats = (m: DistrictSquares[]) => m.filter((d) => d.right - d.left < 0).length;
const tossups = (m: DistrictSquares[]) => m.filter((d) => Math.abs(d.right - d.left) < 3).length;

describe("autoMap — invariants for every strategy", () => {
  for (const { id } of AUTO_MAP_STRATEGIES) {
    it(`${id}: conserves the budget and totals 16 per district`, () => {
      const { map } = autoMap(id, BUDGET, CAPS);
      expect(map).toHaveLength(N);
      expect(sum(map)).toEqual(BUDGET);
      for (const d of map) {
        expect(d.left + d.right + d.grey).toBe(16);
        expect(d.left).toBeGreaterThanOrEqual(0);
        expect(d.right).toBeGreaterThanOrEqual(0);
        expect(d.grey).toBeGreaterThanOrEqual(0);
      }
    });

    it(`${id}: produces a legal map`, () => {
      const { map } = autoMap(id, BUDGET, CAPS);
      const v = validateRedistrictMap(map, BUDGET, CAPS);
      expect(v.violations).toEqual([]);
      expect(v.legal).toBe(true);
    });
  }
});

describe("autoMap — strategy intent", () => {
  it("fair keeps the efficiency gap under the cap", () => {
    const { map } = autoMap("fair", BUDGET, CAPS);
    expect(computeEfficiencyGap(map)).toBeLessThanOrEqual(CAPS.efficiencyGapCeiling + 1e-9);
  });

  it("competitive yields at least as many toss-ups as fair", () => {
    const fair = autoMap("fair", BUDGET, CAPS).map;
    const comp = autoMap("competitive", BUDGET, CAPS).map;
    expect(tossups(comp)).toBeGreaterThanOrEqual(tossups(fair));
  });

  it("maxRight wins at least as many right seats as fair", () => {
    const fair = autoMap("fair", BUDGET, CAPS).map;
    const max = autoMap("maxRight", BUDGET, CAPS).map;
    expect(rightSeats(max)).toBeGreaterThanOrEqual(rightSeats(fair));
  });

  it("maxLeft wins at least as many left seats as fair", () => {
    const fair = autoMap("fair", BUDGET, CAPS).map;
    const max = autoMap("maxLeft", BUDGET, CAPS).map;
    expect(leftSeats(max)).toBeGreaterThanOrEqual(leftSeats(fair));
  });

  it("maxRight never wins fewer right seats than leanRight", () => {
    const lean = autoMap("leanRight", BUDGET, CAPS).map;
    const max = autoMap("maxRight", BUDGET, CAPS).map;
    expect(rightSeats(max)).toBeGreaterThanOrEqual(rightSeats(lean));
  });

  it("maxLeft never wins fewer left seats than leanLeft", () => {
    const lean = autoMap("leanLeft", BUDGET, CAPS).map;
    const max = autoMap("maxLeft", BUDGET, CAPS).map;
    expect(leftSeats(max)).toBeGreaterThanOrEqual(leftSeats(lean));
  });

  it("leanRight tilts right of fair and leanLeft tilts left", () => {
    const fair = autoMap("fair", BUDGET, CAPS).map;
    expect(rightSeats(autoMap("leanRight", BUDGET, CAPS).map)).toBeGreaterThanOrEqual(
      rightSeats(fair)
    );
    expect(leftSeats(autoMap("leanLeft", BUDGET, CAPS).map)).toBeGreaterThanOrEqual(
      leftSeats(fair)
    );
  });

  it("is deterministic", () => {
    const a = autoMap("maxRight", BUDGET, CAPS).map;
    const b = autoMap("maxRight", BUDGET, CAPS).map;
    expect(a).toEqual(b);
  });
});

describe("autoMap — directional strategies never invert or go illegal", () => {
  const skew = (m: DistrictSquares[]) => rightSeats(m) - leftSeats(m);
  // A spread of district counts, budgets, and law settings.
  const cases: { n: number; b: DistrictSquares }[] = [];
  for (const n of [3, 5, 7, 9, 13, 30]) {
    const tot = 16 * n;
    for (const lp of [0.35, 0.45, 0.5, 0.55, 0.65]) {
      for (const gp of [0, 0.15, 0.375]) {
        const grey = Math.round(tot * gp);
        const left = Math.round((tot - grey) * lp);
        cases.push({ n, b: { left, right: tot - grey - left, grey } });
      }
    }
  }

  // The two full-grid sweeps (90 budgets × 9 caps combos) finish well under the
  // 15s default locally but time out on slow shared CI runners — give them an
  // explicit budget.
  const SWEEP_TIMEOUT_MS = 120_000;

  it(
    "Max Right is always at least as right-skewed as Max Left (the reported bug)",
    { timeout: SWEEP_TIMEOUT_MS },
    () => {
      for (const { n, b } of cases) {
        for (const comp of [0, 1, 2]) {
          for (const fair of [0, 1, 2]) {
            const caps = resolveRedistrictCaps(2, comp, fair, n);
            const mr = autoMap("maxRight", b, caps).map;
            const ml = autoMap("maxLeft", b, caps).map;
            expect(skew(mr)).toBeGreaterThanOrEqual(skew(ml));
          }
        }
      }
    }
  );

  it("uses uneven grey to find efficient gerrymanders (Iowa sandbox regression)", () => {
    // Balanced 25/25 over 5 districts with heavy grey: an even-grey allocation
    // caps Max Right at a 3-2 / margin-1 map, but a parity-matched uneven grey
    // split yields a legal margin-2 map. Regression for the "lean barely does
    // anything" report.
    const b: DistrictSquares = { left: 25, right: 25, grey: 30 };
    const caps = resolveRedistrictCaps(2, 1, 1, 5);
    const mr = autoMap("maxRight", b, caps).map;
    const ml = autoMap("maxLeft", b, caps).map;
    expect(validateRedistrictMap(mr, b, caps).legal).toBe(true);
    expect(validateRedistrictMap(ml, b, caps).legal).toBe(true);
    expect(rightSeats(mr) - leftSeats(mr)).toBeGreaterThanOrEqual(2);
    expect(leftSeats(ml) - rightSeats(ml)).toBeGreaterThanOrEqual(1);
  });

  it(
    "returns a legal map whenever a legal map exists (proxied by Fair)",
    { timeout: SWEEP_TIMEOUT_MS },
    () => {
      for (const { n, b } of cases) {
        for (const comp of [0, 1, 2]) {
          for (const fair of [0, 1, 2]) {
            const caps = resolveRedistrictCaps(2, comp, fair, n);
            // If even the balanced Fair map is illegal, the budget+caps admit no
            // legal map, so best-effort is acceptable; skip those.
            if (!validateRedistrictMap(autoMap("fair", b, caps).map, b, caps).legal) continue;
            for (const id of AUTO_MAP_STRATEGIES.map((s) => s.id) as AutoMapStrategy[]) {
              const { map } = autoMap(id, b, caps);
              expect(sum(map)).toEqual(b);
              expect(validateRedistrictMap(map, b, caps).legal).toBe(true);
            }
          }
        }
      }
    }
  );

  it("at default law caps, Max Left wins at least as many left seats as Max Right", () => {
    for (const { n, b } of cases) {
      const caps = resolveRedistrictCaps(2, 1, 1, n); // legislature-drawn, moderate/moderate
      if (!validateRedistrictMap(autoMap("fair", b, caps).map, b, caps).legal) continue;
      const ml = autoMap("maxLeft", b, caps).map;
      const mr = autoMap("maxRight", b, caps).map;
      expect(leftSeats(ml)).toBeGreaterThanOrEqual(leftSeats(mr));
      expect(rightSeats(mr)).toBeGreaterThanOrEqual(rightSeats(ml));
    }
  });
});

describe("autoMap — edge cases", () => {
  it("handles a single-district state", () => {
    const budget: DistrictSquares = { left: 6, right: 7, grey: 3 };
    const caps = resolveRedistrictCaps(2, 1, 1, 1);
    const { map } = autoMap("maxRight", budget, caps);
    expect(map).toEqual([{ left: 6, right: 7, grey: 3 }]);
  });

  it("stays legal on a strongly skewed budget under strict caps", () => {
    const budget: DistrictSquares = { left: 110, right: 30, grey: 20 };
    const caps = resolveRedistrictCaps(2, 0, 0, N); // strict compactness + fairness
    for (const id of AUTO_MAP_STRATEGIES.map((s) => s.id) as AutoMapStrategy[]) {
      const { map } = autoMap(id, budget, caps);
      expect(sum(map)).toEqual(budget);
      expect(validateRedistrictMap(map, budget, caps).legal).toBe(true);
    }
  });
});

describe("effectiveRedistrictCaps — feasibility floor", () => {
  it("leaves caps unchanged when the policy ceiling is attainable", () => {
    expect(effectiveRedistrictCaps(BUDGET, CAPS)).toEqual(CAPS);
  });

  it("raises the ceiling so a legal map exists in a lopsided strict-law state", () => {
    // 52 districts, ~65/35 left, strict compactness (dev 4) + strict fairness
    // (0.1): the deviation cap forces every district left, so the efficiency
    // gap is irreducibly above the policy ceiling — no map could ever be legal.
    const budget: DistrictSquares = { left: 487, right: 262, grey: 83 };
    const caps = resolveRedistrictCaps(2, 0, 0, 52);
    const eff = effectiveRedistrictCaps(budget, caps);
    expect(eff.efficiencyGapCeiling).toBeGreaterThan(caps.efficiencyGapCeiling);
    for (const { id } of AUTO_MAP_STRATEGIES) {
      const { map } = autoMap(id, budget, caps);
      expect(validateRedistrictMap(map, budget, eff).legal).toBe(true);
    }
  });

  it("is idempotent", () => {
    const budget: DistrictSquares = { left: 487, right: 262, grey: 83 };
    const caps = resolveRedistrictCaps(2, 0, 0, 52);
    const once = effectiveRedistrictCaps(budget, caps);
    expect(effectiveRedistrictCaps(budget, once)).toEqual(once);
  });
});

describe("autoMap — directional strategies dominate fair in their own direction", () => {
  const sweeps: { n: number; b: DistrictSquares }[] = [
    { n: 8, b: { left: 45, right: 58, grey: 25 } },
    { n: 14, b: { left: 78, right: 101, grey: 45 } },
    { n: 27, b: { left: 151, right: 194, grey: 87 } },
    { n: 52, b: { left: 175, right: 324, grey: 333 } },
  ];
  for (const { n, b } of sweeps) {
    for (const comp of [0, 1, 2]) {
      it(`n=${n} compactness=${comp}: lean/max win at least fair's seats on their side`, () => {
        const caps = resolveRedistrictCaps(2, comp, 1, n);
        const fair = autoMap("fair", b, caps).map;
        expect(leftSeats(autoMap("leanLeft", b, caps).map)).toBeGreaterThanOrEqual(leftSeats(fair));
        expect(leftSeats(autoMap("maxLeft", b, caps).map)).toBeGreaterThanOrEqual(leftSeats(fair));
        expect(rightSeats(autoMap("leanRight", b, caps).map)).toBeGreaterThanOrEqual(
          rightSeats(fair)
        );
        expect(rightSeats(autoMap("maxRight", b, caps).map)).toBeGreaterThanOrEqual(
          rightSeats(fair)
        );
      });
    }
  }
});

describe("autoMapAll — collapse detection for the editor's strategy buttons", () => {
  const cases: { name: string; n: number; b: DistrictSquares; comp: number; fair: number }[] = [
    { name: "moderate balanced", n: 10, b: BUDGET, comp: 1, fair: 1 },
    { name: "strict left-lean", n: 8, b: { left: 70, right: 48, grey: 10 }, comp: 0, fair: 0 },
    { name: "loose right-lean", n: 8, b: { left: 48, right: 70, grey: 10 }, comp: 2, fair: 2 },
  ];
  for (const c of cases) {
    it(`${c.name}: sameAs is set exactly when the maps are identical`, () => {
      const caps = resolveRedistrictCaps(2, c.comp, c.fair, c.n);
      const all = autoMapAll(c.b, caps);
      const byId = new Map(all.map((o) => [o.strategy, o]));
      for (const o of all) {
        expect(o.distinct).toBe(o.sameAs === undefined);
        if (o.sameAs) {
          expect(mapSignature(o.map)).toBe(mapSignature(byId.get(o.sameAs)!.map));
        }
      }
      // Fair and competitive are never marked as collapsed.
      expect(byId.get("fair")!.distinct).toBe(true);
      expect(byId.get("competitive")!.distinct).toBe(true);
    });
  }

  it("marks a directional strategy non-distinct when laws force fair's map", () => {
    // Strict laws in a leaning state: some directional buttons must collapse.
    const caps = resolveRedistrictCaps(2, 0, 0, 8);
    const all = autoMapAll({ left: 70, right: 48, grey: 10 }, caps);
    const fairSig = mapSignature(all.find((o) => o.strategy === "fair")!.map);
    for (const o of all) {
      if (o.strategy === "fair" || o.strategy === "competitive") continue;
      if (mapSignature(o.map) === fairSig) expect(o.distinct).toBe(false);
    }
  });

  it("every strategy's result is legal and conserved", () => {
    const caps = resolveRedistrictCaps(2, 1, 1, N);
    for (const o of autoMapAll(BUDGET, caps)) {
      expect(sum(o.map)).toEqual(BUDGET);
      const eff = effectiveRedistrictCaps(BUDGET, caps);
      expect(validateRedistrictMap(o.map, BUDGET, eff).legal).toBe(true);
    }
  });
});
