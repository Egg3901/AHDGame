import { describe, it, expect } from "vitest";
import { legislationTypes } from "./legislationTypes";
import { LAW_COUNTRY_IDS } from "@/lib/politicalLegislation/types";
import type { LegislationType, LegislationPolicyOption } from "@/lib/db/types";

/** Countries whose legacy stateMetrics were demolished in favour of politicalMetrics. */
const DEMOLISHED_COUNTRY_SCOPES = new Set<string>(LAW_COUNTRY_IDS);

/**
 * P6c Prong-C symmetry: a law's RIGHT options must improve at least one NATURAL
 * metric for its domain — not merely reduce a left-favored one. This is what
 * turns each policy into a frontier (no universally optimal basket) rather than
 * a ranking. Pairs with P6d's electorate weighting.
 *
 * "Improves" mechanics, mirroring runtime (policyEffects.ts):
 *  - Weighted target: contribution = effectDirection × weight × MAX × scope ×
 *    (isHigherBetter ? 1 : -1). The isHigherBetter sign is baked in, so a metric
 *    improves exactly when `rightEffectDirection × weight > 0`.
 *  - Per-option metricEffect (raw ticks bypass isHigherBetter): a right option's
 *    ratePerTurn improves M iff (isHigherBetter ? r > 0 : r < 0).
 */

type Nat = { category: string; metricId: string; higherBetter: boolean };
const ECON_FREEDOM: Nat[] = [
  { category: "economic", metricId: "economicFreedom", higherBetter: true },
  { category: "economic", metricId: "smallBusinessFormation", higherBetter: true },
  { category: "economic", metricId: "regulatoryBurden", higherBetter: false },
];
const CRIME: Nat[] = [{ category: "publicSafety", metricId: "crimeRate", higherBetter: false }];
const HOUSING: Nat[] = [
  { category: "social", metricId: "housingAffordability", higherBetter: false },
];
const DEFENSE: Nat[] = [
  { category: "governance", metricId: "militaryReadiness", higherBetter: true },
  { category: "governance", metricId: "nationalPride", higherBetter: true },
];
const STATE_MEDIA: Nat[] = [
  { category: "governance", metricId: "nationalPride", higherBetter: true },
  { category: "mediaInformation", metricId: "stateMediaControl", higherBetter: false },
];

/**
 * Universal fiscal upside: a spending CUT (right) improves the budget; this is
 * the classic right-of-centre payoff and most funding laws already carry a
 * budgetBalance target. Crediting it keeps the symmetry guard from demanding a
 * redundant P6a target on funding laws AND avoids the §4.7 double-count of
 * re-pointing a channel readout (e.g. crimeRate on a policing-FUNDING law).
 */
const FISCAL: Nat[] = [
  { category: "governance", metricId: "budgetBalance", higherBetter: true },
  { category: "governance", metricId: "debtToGdp", higherBetter: false },
];

/** Domain → natural right-improvable metrics. */
const DOMAIN_NATURAL: Record<string, Nat[]> = {
  tax: ECON_FREEDOM,
  economic: ECON_FREEDOM,
  labor: ECON_FREEDOM,
  labour: ECON_FREEDOM,
  technology: ECON_FREEDOM,
  education: ECON_FREEDOM,
  healthcare: ECON_FREEDOM,
  welfare: ECON_FREEDOM,
  infrastructure: ECON_FREEDOM,
  environment: [
    { category: "economic", metricId: "economicFreedom", higherBetter: true },
    { category: "economic", metricId: "regulatoryBurden", higherBetter: false },
  ],
  immigration: HOUSING,
  housing: HOUSING,
  publicSafety: CRIME,
  law_justice: CRIME,
  criminal_justice: CRIME,
  defense: DEFENSE,
  mediaInformation: STATE_MEDIA,
};

/**
 * Exempt domains: their right↔left tension is the funding-level tradeoff
 * (already modeled by spending channels), or they are procedurally
 * heterogeneous with no single natural right metric. Explicit, not silent.
 */
const EXEMPT = new Set(["social", "agriculture", "foreign_policy", "governance", "government"]);

function rightOptions(t: LegislationType): LegislationPolicyOption[] {
  return (t.policyOptions ?? []).filter((o) => o.stance === "right");
}

function improvesViaWeighted(t: LegislationType, nat: Nat[], rightDir: number): boolean {
  const targets = t.effectTargetsWeighted ?? [];
  return targets.some(
    (wt) =>
      nat.some((n) => n.category === wt.metricCategoryId && n.metricId === wt.metricId) &&
      rightDir * (wt.weight ?? 0) > 0
  );
}

function improvesViaOptionEffects(rights: LegislationPolicyOption[], nat: Nat[]): boolean {
  return rights.some((opt) =>
    (opt.metricEffects ?? []).some((e) =>
      nat.some(
        (n) =>
          n.category === e.category &&
          n.metricId === e.metricId &&
          (n.higherBetter ? e.ratePerTurn > 0 : e.ratePerTurn < 0)
      )
    )
  );
}

describe("P6c right-option metric symmetry", () => {
  it("every right option improves a natural metric for its domain", () => {
    const all = [...new Map(legislationTypes.map((t) => [t._id, t])).values()];
    const violators: string[] = [];

    for (const t of all) {
      // LAW_COUNTRY_IDS regions run on the politicalMetrics board; they have no
      // legacy political store apart from economic.*/population.* (the same
      // survivor rule inlined in orphanedEffects.test.ts). These laws' publicSafety /
      // social / governance targets are therefore inert, and demanding a
      // right-side upside on a metric that no longer exists is meaningless.
      // The sweep still covers the ~426 types outside those countries.
      if (DEMOLISHED_COUNTRY_SCOPES.has(String(t.countryScope ?? "").toUpperCase())) continue;

      const domain = t.policyDomain ?? "";
      if (EXEMPT.has(domain)) continue;
      // For budget-category (funding) laws, require right/cut options to
      // improve at least 1 ECON_FREEDOM metric beyond just the FISCAL set
      // (budgetBalance / debtToGdp). This ensures funding cuts also deliver
      // economic-freedom upside, not merely fiscal balance.
      if (t.budgetCategory) {
        const rights = rightOptions(t);
        if (rights.length === 0) continue;
        const rightDir = rights[0].effectDirection ?? 0;
        const ok =
          improvesViaWeighted(t, ECON_FREEDOM, rightDir) ||
          improvesViaOptionEffects(rights, ECON_FREEDOM);
        if (!ok) violators.push(`${t._id} [${domain}] (funding: no ECON_FREEDOM upside)`);
        continue;
      }
      const nat = DOMAIN_NATURAL[domain];
      if (!nat) continue; // domain with no defined natural metric → not swept
      const rights = rightOptions(t);
      if (rights.length === 0) continue; // no right option to balance

      const rightDir = rights[0].effectDirection ?? 0;
      const candidates = [...nat, ...FISCAL];
      const ok =
        improvesViaWeighted(t, candidates, rightDir) ||
        improvesViaOptionEffects(rights, candidates);
      if (!ok) violators.push(`${t._id} [${domain}]`);
    }

    expect(
      violators,
      `right options lack a natural-metric upside:\n${violators.join("\n")}`
    ).toEqual([]);
  });
});
