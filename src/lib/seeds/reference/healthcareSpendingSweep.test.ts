import { describe, expect, it } from "vitest";
import type { LegislationType } from "@/lib/db/types";
import { legislationTypes } from "./legislationTypes";
import { deLegislationTypes } from "../de/deLegislationTypes";
import { cnLegislationTypes } from "../cn/cnLegislationTypes";
import { ieLegislationTypes } from "../ie/ieLegislationTypes";
import { jpLegislationTypes } from "../jp/jpLegislationTypes";

/**
 * §4.7 healthcare spending sweep guard (P2b). These healthcare outcomes are
 * ENGINE-DERIVED (the healthcare spending channel + access/demand DAG —
 * registry/healthcare.ts), so a healthcare-FUNDING law that also targets one
 * directly double-counts. Funding laws must target ROOT drivers instead:
 * uninsuredRate (coverage), publicHealthPreparedness (preparedness),
 * slaintecareProgress (IE reform) — or budget-side metrics.
 *
 * KEEP-LIST: laws whose mechanism is COVERAGE/REGULATORY, not the money itself —
 * the direct effect models a mechanism the spending channel cannot.
 */
const SPEND_DRIVEN_HEALTHCARE_READOUTS = new Set([
  "physicianRate",
  "affordabilityIndex",
  "preventableMortality",
  "lifeExpectancy",
  "mentalHealthAccess",
  "elderCareQuality",
  "nhsWaitingTime",
  "socialCareQuality",
  "hseWaitingListMonths",
]);

const REGULATORY_MECHANISM_KEEP_LIST = new Set<string>([
  // SUB-ALLOCATION mechanism: the engine's channel only knows TOTAL healthcare
  // spend — it cannot express prioritizing mental health / elder care / social
  // care within the budget. These laws' direct effects model that allocation
  // choice, which the channel cannot.
  "uk_mental_health",
  "de_mental_health",
  "jp_mental_health",
  "de_elder_care",
  "jp_elder_care",
  "uk_social_care",
  // PRICE mechanism: drug-price regulation moves affordability/outcomes through
  // prices, not budgets — an edge the engine does not have.
  "us_drug_pricing_medicare",
]);

function readoutHits(lt: LegislationType): string[] {
  const hits: string[] = [];
  if (
    lt.effectTarget?.metricCategoryId === "healthcare" &&
    SPEND_DRIVEN_HEALTHCARE_READOUTS.has(lt.effectTarget.metricId)
  ) {
    hits.push(`effectTarget ${lt.effectTarget.metricId}`);
  }
  for (const w of lt.effectTargetsWeighted ?? []) {
    if (w.metricCategoryId === "healthcare" && SPEND_DRIVEN_HEALTHCARE_READOUTS.has(w.metricId)) {
      hits.push(`weighted ${w.metricId} (${w.weight})`);
    }
  }
  for (const opt of lt.policyOptions ?? []) {
    for (const e of opt.metricEffects ?? []) {
      if (e.category === "healthcare" && SPEND_DRIVEN_HEALTHCARE_READOUTS.has(e.metricId)) {
        hits.push(`option tick ${e.metricId}`);
      }
    }
  }
  return hits;
}

describe("§4.7 healthcare spending sweep", () => {
  const all = [
    ...legislationTypes,
    ...deLegislationTypes,
    ...cnLegislationTypes,
    ...ieLegislationTypes,
    ...jpLegislationTypes,
  ];

  it("no healthcare-FUNDING law targets a spend-driven healthcare readout", () => {
    const offenders: string[] = [];
    for (const lt of all) {
      if (lt.budgetCategory !== "healthcare") continue;
      if (REGULATORY_MECHANISM_KEEP_LIST.has(lt._id)) continue;
      for (const hit of readoutHits(lt)) offenders.push(`${lt._id} → ${hit}`);
    }
    expect(offenders, `healthcare double-counts present:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("keep-list (sub-allocation/price mechanism) laws still carry their direct effects", () => {
    for (const id of REGULATORY_MECHANISM_KEEP_LIST) {
      const lt = all.find((l) => l._id === id);
      if (!lt) continue;
      expect(readoutHits(lt).length, `${id} should keep its mechanism effect`).toBeGreaterThan(0);
    }
  });
});
