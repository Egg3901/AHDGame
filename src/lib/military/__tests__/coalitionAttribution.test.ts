import { describe, it, expect } from "vitest";
import { resolvePvpBattle, contingentsOf } from "../battle";
import { side, FRONTS_MAP } from "./battleFixtures";

const T = "afghan";
void FRONTS_MAP;

/**
 * Coalition casualty attribution.
 *
 * A side result used to carry ONE country — the principal — beside a loss summed
 * across every contingent, so an allied offensive reported its ally's dead under the
 * principal's flag. Live report 6a8fb6a1715ff52ed01059ce showed "DD 16,299" for a
 * DD+RU attack in which DD lost 5,360 and RU lost 10,939.
 */
describe("coalition casualty attribution", () => {
  it("splits a coalition side's losses per contingent", () => {
    const res = resolvePvpBattle(
      [side("DD", "A", [120, 110], T), side("RU", "A", [100, 95, 90], T)],
      [side("US", "B", [80], T)],
      T,
      12345
    );
    const cs = res.attacker.contingents;
    expect(cs?.map((c) => c.country)).toEqual(["DD", "RU"]);
    // Nothing is invented and nothing is lost: the parts are the whole.
    expect(cs!.reduce((a, c) => a + c.loss, 0)).toBe(res.attacker.loss);
    // Both allies actually bled — a zero would mean the split silently collapsed.
    for (const c of cs!) expect(c.loss).toBeGreaterThan(0);
  });

  it("apportions the side's power across contingents", () => {
    const res = resolvePvpBattle(
      [side("DD", "A", [120], T), side("RU", "A", [100], T)],
      [side("US", "B", [80], T)],
      T,
      777
    );
    const cs = res.attacker.contingents!;
    // Rounded per contingent, so allow the rounding drift the split can introduce.
    const total = cs.reduce((a, c) => a + c.power, 0);
    expect(Math.abs(total - res.attacker.power)).toBeLessThanOrEqual(cs.length);
    for (const c of cs) expect(c.power).toBeGreaterThan(0);
  });

  it("stamps each unit result with the country that owns the unit", () => {
    const res = resolvePvpBattle(
      [side("DD", "A", [120, 110], T), side("RU", "A", [100], T)],
      [side("US", "B", [80], T)],
      T,
      42
    );
    const byCountry: Record<string, number> = {};
    for (const u of res.attacker.unitResults) {
      expect(u.country).toBeTruthy();
      byCountry[u.country!] = (byCountry[u.country!] ?? 0) + u.casualties;
    }
    expect(Object.keys(byCountry).sort()).toEqual(["DD", "RU"]);
    for (const c of res.attacker.contingents!) {
      expect(byCountry[c.country]).toBe(c.loss);
    }
  });

  it("gives a solo side a single contingent equal to the side", () => {
    const res = resolvePvpBattle([side("US", "A", [120], T)], [side("CN", "B", [80], T)], T, 9);
    expect(res.attacker.contingents).toEqual([
      { country: "US", power: res.attacker.power, loss: res.attacker.loss },
    ]);
  });

  it("keeps split-vs-solo casualties identical for the same army", () => {
    // [120, 110, 100, 90] under one flag vs [120, 110] + [100, 90] under two:
    // same army, same doctrine, same seed, so the attacker loss must not move.
    // It used to: `share` renormalised inside each contingent, so the split army
    // bled 2817 where the solo one bled 2192 — the same divisions charged extra
    // men for being filed under two flags.
    //
    // Each unit's casualties are individually rounded, so the totals may drift by
    // up to a man per unit even when the arithmetic agrees; the tolerance is four
    // men for four units.
    const enemy = [side("US", "B", [80], T)];
    const solo = resolvePvpBattle([side("DD", "A", [120, 110, 100, 90], T)], enemy, T, 4242);
    const split = resolvePvpBattle(
      [side("DD", "A", [120, 110], T), side("XX", "A", [100, 90], T)],
      enemy,
      T,
      4242
    );
    expect(Math.abs(split.attacker.loss - solo.attacker.loss)).toBeLessThanOrEqual(4);
  });

  it("does not punish a small ally for being small", () => {
    // Six DD divisions and one XX division of the same type and role, one shared
    // enemy and seed. Per man, the lone ally must bleed about like the big
    // contingent — before the side-relative denominator it bled more than twice
    // as hard per man (2.11x at this seed), because its `share` read 1.0 while a
    // DD division's read 1/6.
    const res = resolvePvpBattle(
      [side("DD", "A", [100, 100, 100, 100, 100, 100], T), side("XX", "A", [100], T)],
      [side("US", "B", [120, 120, 120, 120], T)],
      T,
      7
    );
    const big = res.attacker.contingents!.find((c) => c.country === "DD")!;
    const tiny = res.attacker.contingents!.find((c) => c.country === "XX")!;
    expect(big.loss).toBeGreaterThan(0);
    expect(tiny.loss).toBeGreaterThan(0);
    const ratio = tiny.loss / 15000 / (big.loss / (6 * 15000));
    expect(ratio).toBeLessThan(1.5);
  });

  it("leaves single-nation battles exactly as they were", () => {
    // 1492 is the loss this battle produced before `share` went side-relative,
    // measured once by hand. One contingent means the side denominator IS the
    // contingent total, so the fallback path must reproduce it man for man —
    // if this drifts, the optional parameter stopped being optional.
    const res = resolvePvpBattle([side("US", "A", [120], T)], [side("CN", "B", [80], T)], T, 9);
    expect(res.attacker.loss).toBe(1492);
  });

  it("keeps the retreat discount inside the per-contingent split", () => {
    // A side that breaks off takes a fraction of its casualties. The discount is
    // applied per unit, so the contingent totals must be the DISCOUNTED ones —
    // otherwise the parts would exceed the whole on every retreat.
    const res = resolvePvpBattle(
      [side("DD", "A", [10], T), side("RU", "A", [10], T)],
      [side("US", "B", [400, 400, 400], T)],
      T,
      5
    );
    const cs = res.attacker.contingents!;
    expect(cs.reduce((a, c) => a + c.loss, 0)).toBe(res.attacker.loss);
  });
});

describe("contingentsOf", () => {
  it("falls back to the principal on a report written before contingents existed", () => {
    // Old documents in `battleReports` have no `contingents`. Readers must get the
    // scalar back rather than an empty list, or a historic war loses its casualties.
    const legacy = { country: "DD", power: 5000, loss: 16299, unitResults: [] };
    expect(contingentsOf(legacy)).toEqual([{ country: "DD", power: 5000, loss: 16299 }]);
  });

  it("returns the recorded contingents when they are present", () => {
    const rec = {
      country: "DD",
      power: 5000,
      loss: 16299,
      unitResults: [],
      contingents: [
        { country: "DD", power: 1650, loss: 5360 },
        { country: "RU", power: 3350, loss: 10939 },
      ],
    };
    expect(contingentsOf(rec)).toEqual(rec.contingents);
  });
});
