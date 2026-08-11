import { describe, expect, it } from "vitest";
import { applyEra1953Adjustments } from "./stateMetricsEra1953";
import { ngStateMetrics } from "@/lib/seeds/ng/ngStateMetrics";
import { ukStateMetrics } from "@/lib/seeds/uk/ukStateMetrics";
import { jpStateMetrics } from "@/lib/seeds/jp/jpStateMetrics";
import { brStateMetrics } from "@/lib/seeds/br/brStateMetrics";
import type { StateMetrics } from "@/lib/db/types";

describe("applyEra1953Adjustments — population demography bands", () => {
  const baseMetrics = (
    id: string,
    countryId: string,
    medianAge: number,
    birthRate?: number
  ): StateMetrics =>
    ({
      _id: id,
      countryId,
      economic: {},
      education: {},
      healthcare: {},
      infrastructure: {},
      publicSafety: {},
      environment: {},
      social: {},
      governance: {},
      mediaInformation: {},
      population: {
        medianAge: { value: medianAge },
        ...(birthRate !== undefined ? { birthRate: { value: birthRate } } : {}),
      },
    }) as unknown as StateMetrics;

  it("does not snap a low-median-age 1953 country up to the old Western floor of 22", () => {
    // Turkey's authored 1953 national medianAge is 20 (trMetricPresets1953).
    // Under the old clamp(v - 8, 22, 36) this became 22; under blanket −8
    // with floor 15 it became 15. Pass-through keeps the era-young 20.
    const out = applyEra1953Adjustments(baseMetrics("TR_IST", "TR", 20));
    expect(out.population!.medianAge!.value).toBe(20);
    expect(out.population!.medianAge!.value).toBeLessThan(22);
    expect(out.population!.medianAge!.value).toBeGreaterThanOrEqual(15);
  });

  it("preserves Nigeria's young seeded medianAge below the old floor of 22", () => {
    // NG authors no 1953 medianAge overlay — the adjuster result is final.
    // NORTH_WEST modern seed is 16; old floor yanked it to 22; blanket −8
    // with floor 15 yanked it to 15. Pass-through keeps 16.
    const nw = ngStateMetrics.find((m) => String(m._id) === "NORTH_WEST")!;
    expect(nw.population.medianAge.value).toBe(16);
    const out = applyEra1953Adjustments(nw);
    expect(out.population!.medianAge!.value).toBe(16);
    expect(out.population!.medianAge!.value).toBeLessThan(22);
    expect(out.population!.medianAge!.value).toBeLessThanOrEqual(16);
  });

  it("keeps the Western (UK London) post-adjuster medianAge unchanged from the prior band", () => {
    // LON modern 36.5 → 36.5 − 8 = 28.5; ceiling 36 was already the Western end
    // and is unchanged, so this value is identical before/after the floor widen.
    // Pass-through does not fire (36.5 > 24).
    const lon = ukStateMetrics.find((m) => String(m._id) === "LON")!;
    expect(lon.population.medianAge.value).toBe(36.5);
    const out = applyEra1953Adjustments(lon);
    expect(out.population!.medianAge!.value).toBe(28.5);
  });

  it("does not slam the birthRate 0–100 index into the old crude-rate ceiling of 30", () => {
    // JP Hokkaido modern birthRate index is 30; old clamp(v + 8, 14, 30) → 30.
    // In index units the baby-boom shift must be allowed to land above 30.
    // 30 < 50 pass-through threshold, so +8 still applies.
    const hok = jpStateMetrics.find((m) => String(m._id) === "HOK")!;
    expect(hok.population.birthRate!.value).toBe(30);
    const out = applyEra1953Adjustments(hok);
    expect(out.population!.birthRate!.value).toBe(38);
    expect(out.population!.birthRate!.value).toBeGreaterThan(30);
  });

  it("admits a high-fertility authored index (RU CAS 68) above the old ceiling", () => {
    // ruMetricPresets1953 CAS birthRate 68 — old band capped at 30; blanket +8
    // would push to 76 until overlay. Pass-through keeps 68.
    const out = applyEra1953Adjustments(baseMetrics("CAS", "RU", 21, 68));
    expect(out.population!.birthRate!.value).toBe(68);
    expect(out.population!.birthRate!.value).toBeGreaterThan(30);
    expect(out.population!.birthRate!.value).toBeLessThanOrEqual(95);
  });
});

describe("applyEra1953Adjustments — demography pass-through guard", () => {
  const baseMetrics = (
    id: string,
    countryId: string,
    medianAge: number,
    birthRate?: number
  ): StateMetrics =>
    ({
      _id: id,
      countryId,
      economic: {},
      education: {},
      healthcare: {},
      infrastructure: {},
      publicSafety: {},
      environment: {},
      social: {},
      governance: {},
      mediaInformation: {},
      population: {
        medianAge: { value: medianAge },
        ...(birthRate !== undefined ? { birthRate: { value: birthRate } } : {}),
      },
    }) as unknown as StateMetrics;

  it("leaves a no-overlay young country inside the era-plausible band (NG)", () => {
    // NG has a 1953 preset bundle but no population.medianAge key — adjuster
    // alone is final. Seed 16 is already era-young; must stay in [15, 36].
    const nw = ngStateMetrics.find((m) => String(m._id) === "NORTH_WEST")!;
    const out = applyEra1953Adjustments(nw);
    const age = out.population!.medianAge!.value;
    expect(age).toBeGreaterThanOrEqual(15);
    expect(age).toBeLessThanOrEqual(36);
    expect(age).toBe(nw.population.medianAge.value);
  });

  it("still ages a modern mid/high medianAge that needs the −8 (BR Norte)", () => {
    // BR Norte seeds 28 — inside the global [15, 36] band but above the
    // already-young threshold, so −8 still applies (→ 20). Full-band
    // pass-through would wrongly leave modern BR ages untouched.
    const norte = brStateMetrics.find((m) => String(m._id) === "NORTE")!;
    expect(norte.population.medianAge.value).toBe(28);
    const out = applyEra1953Adjustments(norte);
    expect(out.population!.medianAge!.value).toBe(20);
  });

  it("does not change the Western adjuster result that overlays never rewrite (UK LON)", () => {
    // UK 1953 overlay has no medianAge — adjuster alone is final. Pass-through
    // must not alter the prior 36.5 → 28.5 path for modern-old inputs.
    const lon = ukStateMetrics.find((m) => String(m._id) === "LON")!;
    const out = applyEra1953Adjustments(lon);
    expect(out.population!.medianAge!.value).toBe(28.5);
  });

  it("does not inflate an already high birthRate index before overlay", () => {
    const out = applyEra1953Adjustments(baseMetrics("CAS", "RU", 21, 68));
    expect(out.population!.birthRate!.value).toBe(68);
  });
});
