import { describe, expect, it } from "vitest";
import {
  POLITICAL_METRIC_CATEGORIES,
  REQUIRED_CATEGORY_LEANS,
  type PoliticalMetricFamily,
} from "./types";
import {
  FAMILIES_BY_CATEGORY,
  POLITICAL_METRIC_FAMILIES,
  getFamily,
  isFamilyActive,
} from "./families";

describe("political metric catalog invariants", () => {
  it("has 9 categories × 7 families = 63, in catalog order", () => {
    expect(POLITICAL_METRIC_CATEGORIES).toHaveLength(9);
    expect(POLITICAL_METRIC_FAMILIES).toHaveLength(63);
  });

  it("every category carries the exact lean ladder -5..+5 in order", () => {
    for (const cat of POLITICAL_METRIC_CATEGORIES) {
      const fams = FAMILIES_BY_CATEGORY[cat.id];
      expect(fams.map((f) => f.lean)).toEqual([...REQUIRED_CATEGORY_LEANS]);
    }
  });

  it("ids are unique and formed as {categoryId}.{slug}", () => {
    const ids = POLITICAL_METRIC_FAMILIES.map((f) => f.id);
    expect(new Set(ids).size).toBe(63);
    for (const f of POLITICAL_METRIC_FAMILIES) {
      expect(f.id).toBe(`${f.categoryId}.${f.slug}`);
    }
  });

  it("every family has content: description, drivers, both indicator eras", () => {
    for (const f of POLITICAL_METRIC_FAMILIES) {
      expect(f.description.length).toBeGreaterThan(10);
      expect(f.pos.length).toBeGreaterThan(0);
      expect(f.neg.length).toBeGreaterThan(0);
      expect(f.indicators.early.length).toBeGreaterThan(0);
      expect(f.indicators.modern.length).toBeGreaterThan(0);
      expect(f.higherIsBetter).toBe(true);
      expect(f.activeFromYear).toBe(1953);
      expect(f.activeToYear).toBeNull();
    }
  });

  it("getFamily resolves and throws on unknown id", () => {
    expect(getFamily("economy.workerSecurity").lean).toBe(-5);
    expect(() => getFamily("economy.nope" as never)).toThrow();
  });

  it("player-visible catalog text contains no calendar years", () => {
    for (const f of POLITICAL_METRIC_FAMILIES) {
      const visible = [
        f.description,
        ...f.pos,
        ...f.neg,
        ...f.indicators.early,
        ...f.indicators.modern,
      ];
      for (const s of visible) expect(s).not.toMatch(/\b(19|20)\d{2}\b/);
    }
  });
});

describe("isFamilyActive", () => {
  const base = { activeFromYear: 1960, activeToYear: null } as PoliticalMetricFamily;

  it("is false before the from year and true from it onward", () => {
    expect(isFamilyActive(base, 1959)).toBe(false);
    expect(isFamilyActive(base, 1960)).toBe(true);
    expect(isFamilyActive(base, 2100)).toBe(true);
  });

  it("respects a closed window inclusively", () => {
    const closed = { activeFromYear: 1960, activeToYear: 1990 } as PoliticalMetricFamily;
    expect(isFamilyActive(closed, 1990)).toBe(true);
    expect(isFamilyActive(closed, 1991)).toBe(false);
  });

  it("treats every shipped family as active in 1953", () => {
    for (const family of POLITICAL_METRIC_FAMILIES) {
      expect(isFamilyActive(family, 1953)).toBe(true);
    }
  });
});
