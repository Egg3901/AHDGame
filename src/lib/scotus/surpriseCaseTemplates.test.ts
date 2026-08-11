import { describe, expect, it } from "vitest";
import { SURPRISE_CASE_TEMPLATES, templatesForYear } from "./surpriseCaseTemplates";
import { legislationTypes } from "@/lib/seeds/reference/legislationTypes";

describe("SURPRISE_CASE_TEMPLATES", () => {
  // #3607 scoped this to a small pool. Era windows changed what "small" has to
  // mean: the raw count is no longer the number a player can draw from, because
  // a 1953 court and a 2019 court see different subsets. The invariant that
  // matters is per-era depth, asserted in the era block below.
  it("stays a small authored pool, per #3607 scope", () => {
    expect(SURPRISE_CASE_TEMPLATES.length).toBeGreaterThanOrEqual(5);
    expect(SURPRISE_CASE_TEMPLATES.length).toBeLessThanOrEqual(16);
  });

  it("has unique, non-empty templateKeys and titles", () => {
    const keys = SURPRISE_CASE_TEMPLATES.map((t) => t.templateKey);
    expect(new Set(keys).size).toBe(keys.length);
    for (const t of SURPRISE_CASE_TEMPLATES) {
      expect(t.templateKey.length).toBeGreaterThan(0);
      expect(t.title.length).toBeGreaterThan(0);
      expect(["economic", "social"]).toContain(t.axis);
    }
  });

  it("titles are non-historical case names distinct from real docket-content style (no year suffix)", () => {
    for (const t of SURPRISE_CASE_TEMPLATES) {
      expect(t.title).toMatch(/ v\. | re /);
      expect(t.title).not.toMatch(/\(\d{4}\)/);
    }
  });

  it("every effect references a real, currently-seeded legislationTypeId and policyOptionId", () => {
    const typesById = new Map(legislationTypes.map((lt) => [lt._id, lt]));
    for (const t of SURPRISE_CASE_TEMPLATES) {
      for (const effect of [t.positiveEffect, t.negativeEffect]) {
        const lt = typesById.get(effect.legislationTypeId);
        expect(lt, `unknown legislationTypeId ${effect.legislationTypeId}`).toBeDefined();
        const option = lt?.policyOptions?.find((opt) => opt.id === effect.policyOptionId);
        expect(
          option,
          `unknown policyOptionId ${effect.policyOptionId} on ${effect.legislationTypeId}`
        ).toBeDefined();
      }
    }
  });

  it("positiveEffect and negativeEffect always target the same legislationTypeId (just different options)", () => {
    for (const t of SURPRISE_CASE_TEMPLATES) {
      expect(t.positiveEffect.legislationTypeId).toBe(t.negativeEffect.legislationTypeId);
      expect(t.positiveEffect.policyOptionId).not.toBe(t.negativeEffect.policyOptionId);
    }
  });
});

describe("era windows", () => {
  const ERAS = [1953, 1960, 1979, 1991, 2019, 2026];

  it("keeps a usable pool in every era, on both axes", () => {
    for (const year of ERAS) {
      const pool = templatesForYear(SURPRISE_CASE_TEMPLATES, year);
      // Below ~4 the hazard draws the same one or two cases all game.
      expect(pool.length, `${year} pool`).toBeGreaterThanOrEqual(4);
      for (const axis of ["economic", "social"] as const) {
        expect(
          pool.filter((t) => t.axis === axis).length,
          `${year} ${axis}`
        ).toBeGreaterThanOrEqual(2);
      }
    }
  });

  // The whole point: a 1953 Court cannot hear a case about a solar cartel, and
  // a 2019 Court cannot sue an agency abolished in 1970. Windows cut both ways.
  it("excludes anachronisms in both directions", () => {
    const y1953 = templatesForYear(SURPRISE_CASE_TEMPLATES, 1953).map((t) => t.templateKey);
    expect(y1953).not.toContain("sunbelt-solar-cartel-v-federal-power-commission");
    expect(y1953).not.toContain("moonlight-drive-in-owners-guild-v-secretary-of-homeland-affairs");
    expect(y1953).not.toContain("great-lakes-ferry-cooperative-v-national-highway-trust");
    expect(y1953).toContain("confederated-cannery-workers-v-bureau-of-the-budget");

    const y2019 = templatesForYear(SURPRISE_CASE_TEMPLATES, 2019).map((t) => t.templateKey);
    expect(y2019).not.toContain("confederated-cannery-workers-v-bureau-of-the-budget");
    expect(y2019).not.toContain("phantom-fizz-bottling-v-interstate-commerce-guild");
    expect(y2019).toContain("sunbelt-solar-cartel-v-federal-power-commission");
  });

  it("keeps the whole pool when the era clock is off", () => {
    expect(templatesForYear(SURPRISE_CASE_TEMPLATES, null)).toEqual(SURPRISE_CASE_TEMPLATES);
  });

  it("has coherent windows — no template that can never be heard", () => {
    for (const t of SURPRISE_CASE_TEMPLATES) {
      if (t.activeFrom != null && t.activeUntil != null) {
        expect(t.activeFrom, t.templateKey).toBeLessThanOrEqual(t.activeUntil);
      }
      // A window nobody's clock reaches is authored content that never ships.
      const everEligible = ERAS.some(
        (y) => y >= (t.activeFrom ?? -Infinity) && y <= (t.activeUntil ?? Infinity)
      );
      expect(everEligible, `${t.templateKey} is unreachable`).toBe(true);
    }
  });
});
