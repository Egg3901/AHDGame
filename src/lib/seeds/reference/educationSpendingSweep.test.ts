import { describe, expect, it } from "vitest";
import type { LegislationType } from "@/lib/db/types";
import { legislationTypes } from "./legislationTypes";
import { deLegislationTypes } from "../de/deLegislationTypes";
import { cnLegislationTypes } from "../cn/cnLegislationTypes";
import { ieLegislationTypes } from "../ie/ieLegislationTypes";
import { jpLegislationTypes } from "../jp/jpLegislationTypes";

/**
 * §4.7 education spending sweep guard (P2a). The education outcome metrics below
 * are ENGINE-DERIVED: per-capita `spending.byCategory.education` drives them via
 * the spending channel (registry/education.ts), so an education-FUNDING law that
 * also targets one directly double-counts — the money moves the readout through
 * the channel AND the preserved policy delta. Funding laws must target ROOT
 * drivers (educationSpending, rdIntensity, apprenticeshipRate) instead.
 *
 * KEEP-LIST: laws whose mechanism is REGULATORY or PRICE, not money — standards
 * acts (pedagogy → testPerformance/gcseAttainment) and tuition acts (price →
 * enrollment). Their budgetCategory only books admin cost; the direct effect
 * models a distinct mechanism the channel cannot. Additions need the same
 * mechanism-based justification.
 */
const SPEND_DRIVEN_EDUCATION_READOUTS = new Set([
  "highSchoolGradRate",
  "testPerformance",
  "literacyRate",
  "workforceSkill",
  "gcseAttainment",
  "universityEnrollment",
]);

const REGULATORY_MECHANISM_KEEP_LIST = new Set([
  "us_school_standards", // standards/choice → testPerformance (pedagogy)
  "uk_education_standards", // standards → gcseAttainment (pedagogy)
  "uk_tuition_fees", // price → universityEnrollment
  "de_university_tuition", // price/BAföG → enrollment-side effects
  // price/SUSI grants → enrollment; its workforceSkill term models the
  // enrollment→skill mechanism, an edge the engine does NOT have (workforceSkill
  // derives from gradRate/testPerf/apprenticeship only).
  "ie_higher_education",
]);

function readoutHits(lt: LegislationType): string[] {
  const hits: string[] = [];
  if (
    lt.effectTarget?.metricCategoryId === "education" &&
    SPEND_DRIVEN_EDUCATION_READOUTS.has(lt.effectTarget.metricId)
  ) {
    hits.push(`effectTarget ${lt.effectTarget.metricId}`);
  }
  for (const w of lt.effectTargetsWeighted ?? []) {
    if (w.metricCategoryId === "education" && SPEND_DRIVEN_EDUCATION_READOUTS.has(w.metricId)) {
      hits.push(`weighted ${w.metricId} (${w.weight})`);
    }
  }
  for (const opt of lt.policyOptions ?? []) {
    for (const e of opt.metricEffects ?? []) {
      if (e.category === "education" && SPEND_DRIVEN_EDUCATION_READOUTS.has(e.metricId)) {
        hits.push(`option tick ${e.metricId}`);
      }
    }
  }
  return hits;
}

describe("§4.7 education spending sweep", () => {
  const all = [
    ...legislationTypes,
    ...deLegislationTypes,
    ...cnLegislationTypes,
    ...ieLegislationTypes,
    ...jpLegislationTypes,
  ];

  it("no education-FUNDING law targets a spend-driven education readout", () => {
    const offenders: string[] = [];
    for (const lt of all) {
      // A law is a "funding" law for this sweep's purposes when its PRIMARY
      // effect target is the root spend metric itself (educationSpending) —
      // that's what actually drives the engine's spending channel. Bills
      // whose primary target is a readout metric (testPerformance,
      // collegeEnrollment, apprenticeshipRate, ...) are a structurally
      // different case (their own effectTarget may itself need channel
      // wiring) and are deliberately out of scope here, not silently swept.
      //
      // `budgetCategory` is checked with the same fallback the runtime uses
      // (enactedLaws.ts: `legislationType.budgetCategory || policyDomain`) —
      // ticket #826 item 14 found `us_state_education_funding` and
      // `cn_provincial_education` slipped through the sweep specifically
      // because they rely on that fallback instead of an explicit field.
      const effectiveBudgetCategory = lt.budgetCategory || lt.policyDomain;
      if (effectiveBudgetCategory !== "education") continue;
      if (lt.effectTarget?.metricCategoryId !== "education") continue;
      if (lt.effectTarget?.metricId !== "educationSpending") continue;
      if (REGULATORY_MECHANISM_KEEP_LIST.has(lt._id)) continue;
      for (const hit of readoutHits(lt)) offenders.push(`${lt._id} → ${hit}`);
    }
    expect(offenders, `education double-counts present:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("keep-list (regulatory/price mechanism) laws still carry their direct effects", () => {
    for (const id of REGULATORY_MECHANISM_KEEP_LIST) {
      const lt = all.find((l) => l._id === id);
      if (!lt) continue; // country file absence is fine
      expect(readoutHits(lt).length, `${id} should keep its regulatory effect`).toBeGreaterThan(0);
    }
  });

  it("no longer double-counts on the two funding laws found via the policyDomain fallback (ticket #826 item 14)", () => {
    // us_state_education_funding and cn_provincial_education both slipped
    // through the original budgetCategory-only check because neither set an
    // explicit budgetCategory field — they relied on the runtime fallback
    // (enactedLaws.ts: budgetCategory || policyDomain). Both now set the
    // field explicitly (matching us_federal_education_funding) AND have had
    // their double-counting secondaries trimmed; the widened gate above
    // covers the fallback case regardless for any bill that doesn't.
    for (const id of ["us_state_education_funding", "cn_provincial_education"]) {
      const lt = all.find((l) => l._id === id);
      expect(lt, `${id} should exist`).toBeDefined();
      expect(lt!.budgetCategory).toBe("education");
      expect(lt!.effectTarget?.metricId).toBe("educationSpending");
      expect(readoutHits(lt!), `${id} should have no spend-driven readout hits`).toEqual([]);
    }
  });

  it("does not flag reform/curriculum laws whose primary target isn't the spend root (de_academic_reform, ie_curriculum_reform)", () => {
    // These are genuinely regulatory/pedagogy-mechanism bills (their
    // effectTarget is testPerformance, not educationSpending) — they should
    // never need a keep-list entry because the funding-law gate excludes
    // them structurally.
    for (const id of ["de_academic_reform", "ie_curriculum_reform"]) {
      const lt = all.find((l) => l._id === id);
      expect(lt, `${id} should exist`).toBeDefined();
      expect(lt!.effectTarget?.metricId).not.toBe("educationSpending");
    }
  });
});
