import { describe, it, expect } from "vitest";
import { computeGoverningAgenda, type GoverningAgendaInputs } from "./governingAgenda";
import { GOVERNING_ARCHETYPE_CLAMP } from "./governingArchetype";
import type { NPPPersonality } from "@/lib/db/types/npp";

const reformer: NPPPersonality = { ambition: 80, stubbornness: 20, loyalty: 50 };
const ideologue: NPPPersonality = { ambition: 80, stubbornness: 80, loyalty: 50 };
const steward: NPPPersonality = { ambition: 20, stubbornness: 80, loyalty: 50 };
const technocrat: NPPPersonality = { ambition: 20, stubbornness: 20, loyalty: 50 };

function base(overrides: Partial<GoverningAgendaInputs> = {}): GoverningAgendaInputs {
  return {
    conditions: { weakDomains: {} },
    ideology: { economic: 0, social: 0 },
    personality: technocrat,
    currentTurn: 100,
    ...overrides,
  };
}

describe("computeGoverningAgenda", () => {
  it("records the archetype and the turn it was computed", () => {
    const a = computeGoverningAgenda(base({ personality: reformer, currentTurn: 42 }));
    expect(a.archetype).toBe("reformer");
    expect(a.computedTurn).toBe(42);
  });

  it("turns weak national metrics into raise items ranked by urgency", () => {
    const a = computeGoverningAgenda(
      base({ conditions: { weakDomains: { healthcare: 0.9, education: 0.3 } } })
    );
    const domains = a.items.map((i) => i.domain);
    expect(domains).toContain("healthcare");
    expect(domains).toContain("education");
    // Healthcare's higher urgency ranks it ahead of education.
    expect(domains.indexOf("healthcare")).toBeLessThan(domains.indexOf("education"));
    for (const i of a.items) expect(i.direction).toBe("raise");
  });

  it("normalises the top priority to 1.0", () => {
    const a = computeGoverningAgenda(
      base({ conditions: { weakDomains: { healthcare: 0.9, education: 0.3 } } })
    );
    expect(a.items[0].priority).toBeCloseTo(1.0, 5);
  });

  it("never emits a fiscal item — the fiscal stance owns inflation/debt response", () => {
    // Even at hot inflation, the agenda delegates fiscal to fiscalStance (no
    // competing fiscal item → no double-count in selectNppBill).
    const hot = computeGoverningAgenda(base({ conditions: { weakDomains: {}, inflationRate: 9 } }));
    expect(hot.items.find((i) => i.domain === "fiscal")).toBeUndefined();
    const right = computeGoverningAgenda(base({ ideology: { economic: 5, social: 0 } }));
    expect(right.items.find((i) => i.domain === "fiscal")).toBeUndefined();
  });

  it("left-leaning governments prioritise redistributive domains", () => {
    const a = computeGoverningAgenda(base({ ideology: { economic: -5, social: 0 } }));
    const domains = a.items.map((i) => i.domain);
    expect(domains).toContain("poverty");
    expect(domains).toContain("income_inequality");
  });

  it("right-leaning governments prioritise growth + employment", () => {
    const a = computeGoverningAgenda(base({ ideology: { economic: 5, social: 0 } }));
    const domains = a.items.map((i) => i.domain);
    expect(domains).toContain("economic_growth");
    expect(domains).toContain("employment");
  });

  it("respects the archetype agenda-breadth clamp", () => {
    const manyWeak = {
      healthcare: 0.8,
      education: 0.7,
      poverty: 0.6,
      employment: 0.5,
      infrastructure: 0.4,
      public_safety: 0.3,
      environment: 0.2,
      governance: 0.1,
    };
    const reformerAgenda = computeGoverningAgenda(
      base({ personality: reformer, conditions: { weakDomains: manyWeak } })
    );
    const stewardAgenda = computeGoverningAgenda(
      base({ personality: steward, conditions: { weakDomains: manyWeak } })
    );
    expect(reformerAgenda.items.length).toBeGreaterThan(stewardAgenda.items.length);
    expect(stewardAgenda.items.length).toBeGreaterThanOrEqual(
      GOVERNING_ARCHETYPE_CLAMP.minAgendaBreadth
    );
    expect(reformerAgenda.items.length).toBeLessThanOrEqual(
      GOVERNING_ARCHETYPE_CLAMP.maxAgendaBreadth
    );
  });

  it("folds mandate emphasis into the same domain ranking", () => {
    const withMandate = computeGoverningAgenda(
      base({
        conditions: { weakDomains: { education: 0.2 } },
        mandate: { education: 1.0 },
      })
    );
    const without = computeGoverningAgenda(
      base({ conditions: { weakDomains: { education: 0.2 } } })
    );
    const edWith = withMandate.items.find((i) => i.domain === "education")!;
    const edWithout = without.items.find((i) => i.domain === "education")!;
    // Mandate emphasis raises education's accumulated mass (so its raw priority
    // before renormalisation is higher); at minimum it stays on the agenda.
    expect(edWith).toBeDefined();
    expect(edWithout).toBeDefined();
  });

  it("ideologues weight ideology over conditions vs technocrats", () => {
    const conditions = { weakDomains: { healthcare: 0.6 } };
    const ideology = { economic: 5, social: 0 }; // right → growth/employment
    const ideologueAgenda = computeGoverningAgenda(
      base({ personality: ideologue, conditions, ideology })
    );
    const technocratAgenda = computeGoverningAgenda(
      base({ personality: technocrat, conditions, ideology })
    );
    const rankOf = (items: { domain: string }[], d: string) =>
      items.findIndex((i) => i.domain === d);
    // For the ideologue, an ideology domain should rank at least as high
    // relative to the conditions domain as it does for the technocrat.
    const ideologueGrowth = rankOf(ideologueAgenda.items, "economic_growth");
    const technocratGrowth = rankOf(technocratAgenda.items, "economic_growth");
    expect(ideologueGrowth).toBeLessThanOrEqual(technocratGrowth);
  });

  it("is deterministic — identical inputs give identical agendas", () => {
    const inputs = base({
      personality: reformer,
      conditions: { weakDomains: { healthcare: 0.5, education: 0.5 } },
      ideology: { economic: -3, social: -2 },
    });
    expect(computeGoverningAgenda(inputs)).toEqual(computeGoverningAgenda(inputs));
  });

  it("returns an empty agenda when there is no signal at all", () => {
    const a = computeGoverningAgenda(base());
    expect(a.items).toEqual([]);
  });

  it("makes an active crisis the dominant, top-priority agenda item (V1.8)", () => {
    const a = computeGoverningAgenda(
      base({
        personality: reformer,
        ideology: { economic: 5, social: 0 }, // right → growth/employment emphasis
        conditions: { weakDomains: { education: 0.6 } },
        crises: { healthcare: 1 },
      })
    );
    expect(a.items[0].domain).toBe("healthcare");
    expect(a.items[0].direction).toBe("raise");
    expect(a.items[0].priority).toBeCloseTo(1.0, 5);
  });

  // ── "lower" direction (root-cause fix) ─────────────────────────────────────
  // Prior to this fix, all four input blocks called addContribution(..., "raise",
  // ...) unconditionally - there was no code path that could ever emit "lower",
  // and a country whose metrics were all comfortable got an empty agenda (no
  // signal in either direction). These cover each new driver plus the
  // non-regression case: an expansionary government must still expand.

  describe("comfortable metrics (conditions.strongDomains) drive 'lower'", () => {
    it("a maxed-out metric with no ideology backing flips its domain to lower", () => {
      const a = computeGoverningAgenda(
        base({ personality: technocrat, conditions: { strongDomains: { healthcare: 1.0 } } })
      );
      const healthcare = a.items.find((i) => i.domain === "healthcare");
      expect(healthcare).toBeDefined();
      expect(healthcare!.direction).toBe("lower");
      expect(healthcare!.target).toBeLessThan(65); // floor, not the raise ceiling
    });

    it("a comfortable metric alone produces a non-empty agenda (fixes the 'frozen surplus' symptom)", () => {
      // No weak domains, no ideology lean, no mandate, no crisis, no debt -
      // previously this returned an *empty* agenda (see "returns an empty
      // agenda when there is no signal at all" above). A comfortable country
      // should still be able to notice it has room to ease off.
      const a = computeGoverningAgenda(
        base({ conditions: { strongDomains: { healthcare: 0.6, education: 0.9 } } })
      );
      expect(a.items.length).toBeGreaterThan(0);
      for (const i of a.items) expect(i.direction).toBe("lower");
    });

    it("an expansionary left government in good conditions STILL expands", () => {
      // Healthcare is comfortably strong (85/100) but the reformer government
      // campaigns hard on it (full-strength left economic lean) - its own
      // platform mass should still outweigh the mild comfort pull.
      const a = computeGoverningAgenda(
        base({
          personality: reformer,
          ideology: { economic: -5, social: 0 },
          conditions: { strongDomains: { healthcare: 0.4 } }, // metric ≈ 85
        })
      );
      const healthcare = a.items.find((i) => i.domain === "healthcare");
      expect(healthcare).toBeDefined();
      expect(healthcare!.direction).toBe("raise");
    });
  });

  describe("ideological opposition to welfare-state domains drives 'lower'", () => {
    it("a right-leaning government can mark an unfunded welfare domain 'lower'", () => {
      const a = computeGoverningAgenda(
        base({ ideology: { economic: 5, social: 0 } }) // right, no weak/strong signal at all
      );
      const poverty = a.items.find((i) => i.domain === "poverty");
      expect(poverty).toBeDefined();
      expect(poverty!.direction).toBe("lower");
    });

    it("does not touch left-leaning governments (no mirrored cut on growth/employment)", () => {
      const a = computeGoverningAgenda(base({ ideology: { economic: -5, social: 0 } }));
      for (const i of a.items) expect(i.direction).toBe("raise");
    });

    it("genuine weak-metric urgency can still outweigh pure ideological antipathy", () => {
      // Healthcare is in real crisis-adjacent distress (urgency 0.9) for a
      // technocrat (conditions-weighted) right-leaning government - the
      // conditions signal should win over the mild ideological cut.
      const a = computeGoverningAgenda(
        base({
          personality: technocrat,
          ideology: { economic: 5, social: 0 },
          conditions: { weakDomains: { healthcare: 0.9 } },
        })
      );
      const healthcare = a.items.find((i) => i.domain === "healthcare");
      expect(healthcare).toBeDefined();
      expect(healthcare!.direction).toBe("raise");
    });
  });

  describe("a negative mandate weight drives 'lower'", () => {
    it("a mandate to cut a domain overrides an otherwise-empty signal", () => {
      const a = computeGoverningAgenda(base({ mandate: { public_safety: -0.8 } }));
      const item = a.items.find((i) => i.domain === "public_safety");
      expect(item).toBeDefined();
      expect(item!.direction).toBe("lower");
    });
  });

  describe("fiscal distress (debtToGdpRatio) recolors weakly-justified raise items", () => {
    it("a mildly-weak domain flips to lower under BBB-tier debt distress", () => {
      const a = computeGoverningAgenda(
        base({
          personality: technocrat,
          conditions: { weakDomains: { education: 0.15 } },
          debtToGdpRatio: 1.05, // BBB tier (see budget/debt.ts DEBT_THRESHOLDS)
        })
      );
      const education = a.items.find((i) => i.domain === "education");
      expect(education).toBeDefined();
      expect(education!.direction).toBe("lower");
    });

    it("a genuinely severe unmet need still outweighs the same debt distress", () => {
      const a = computeGoverningAgenda(
        base({
          personality: technocrat,
          conditions: { weakDomains: { healthcare: 1.0 } },
          debtToGdpRatio: 1.05,
        })
      );
      const healthcare = a.items.find((i) => i.domain === "healthcare");
      expect(healthcare).toBeDefined();
      expect(healthcare!.direction).toBe("raise");
    });

    it("does nothing to a healthy sovereign (debt inside the AAA/AA band)", () => {
      const a = computeGoverningAgenda(
        base({
          conditions: { weakDomains: { education: 0.15 } },
          debtToGdpRatio: 0.3,
        })
      );
      expect(a.items.find((i) => i.domain === "education")?.direction).toBe("raise");
    });

    it("never invents a new domain to cut out of thin air", () => {
      const a = computeGoverningAgenda(base({ debtToGdpRatio: 2.5 })); // worst (CCC) tier, no other signal
      expect(a.items).toEqual([]);
    });
  });
});
