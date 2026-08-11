import { describe, expect, it } from "vitest";
import type { LegislationType } from "@/lib/db/types";
import { legislationTypes } from "./legislationTypes";
import { deLegislationTypes } from "../de/deLegislationTypes";
import { cnLegislationTypes } from "../cn/cnLegislationTypes";
import { ieLegislationTypes } from "../ie/ieLegislationTypes";
import { jpLegislationTypes } from "../jp/jpLegislationTypes";

/**
 * §4.7 social spending sweep guard (P3a). The income/poverty cluster is
 * ENGINE-DERIVED (the social spending channel + unemployment/inequality DAG —
 * registry/{economic,social}.ts), so a SOCIAL-BUDGET (social/welfare/
 * socialSecurity) funding law that also targets a cluster readout directly
 * double-counts — its booked spend already drives the readout via the channel.
 *
 * KEEP-LIST = mechanisms the channel cannot express: PRICE mechanisms
 * (minimum-wage → medianIncome), STRUCTURE mechanisms (tax progressivity →
 * inequality), and sub-allocation choices — justified per entry.
 */
const CLUSTER_READOUTS = new Set([
  "povertyRate",
  "childPoverty",
  "foodInsecurity",
  "incomeInequality",
  "medianIncome",
  "costOfLiving",
  // P3d — housing + cohesion outcomes (engine-derived from the cluster + roots):
  "housingAffordability",
  "homelessnessRate",
  "socialMobility",
  "socialCohesion",
  "civicParticipation",
  "roughSleeping",
  "vacantPropertyRate",
  "rentalPressureIndex",
]);

const SOCIAL_BUDGET_KEYS = new Set(["social", "welfare", "socialSecurity"]);

const MECHANISM_KEEP_LIST = new Set<string>([
  // TRANSFER-INCIDENCE (sub-population allocation — the P2b precedent): the
  // uniform per-capita social channel cannot express WHO transfers reach.
  // Pension acts target elders, unemployment/credit acts the jobless and
  // families, housing support the housing-insecure — their direct cluster
  // effects encode that incidence. The overlap with the channel's general
  // relief is acknowledged and NAMED for the balance pass (direct magnitudes
  // may warrant trimming once channel effects are observable live).
  "us_social_security",
  "uk_state_pensions",
  "uk_universal_credit",
  "uk_regional_housing_support",
  "jp_pension",
  "de_pension_system",
  "de_unemployment_welfare",
  // STRUCTURE / PRICE / COMPOSITION mechanisms (not budget-driven):
  "cn_common_prosperity", // redistribution structure → inequality
  "jp_gender_equality", // pay-equity price mechanism → medianIncome
  "de_asylum_policy", // population-composition mechanism → povertyRate
]);

/**
 * P3d keeps — pinned PER-LAW allowed readouts (the P3b guard form) for the
 * housing/cohesion tier. Mechanisms the channel + engine paths can't express:
 * early-childhood/training pipelines → socialMobility (the engine derives
 * mobility from schooling/inequality/poverty only), and integration /
 * composition / community-services mechanisms → socialCohesion (the engine
 * derives cohesion from inequality/unemployment/polarization only).
 */
const P3D_KEEP_LIST = new Map<string, Set<string>>([
  ["de_family_policy", new Set(["socialMobility"])], // kita pipeline
  ["uk_childcare", new Set(["socialMobility"])], // early-childhood pipeline
  ["uk_regional_labour", new Set(["socialMobility"])], // training/job-ladder programs
  ["de_immigration_policy", new Set(["socialCohesion"])], // composition mechanism
  ["de_integration_programs", new Set(["socialCohesion"])], // integration sub-allocation
  ["jp_regional_social_services", new Set(["socialCohesion"])], // community-services sub-allocation
]);

function clusterHits(lt: LegislationType): string[] {
  const allowed = P3D_KEEP_LIST.get(lt._id);
  const hits: string[] = [];
  const isCluster = (cat: string, id: string) =>
    (cat === "economic" || cat === "social") && CLUSTER_READOUTS.has(id) && !allowed?.has(id);
  if (lt.effectTarget && isCluster(lt.effectTarget.metricCategoryId, lt.effectTarget.metricId)) {
    hits.push(`effectTarget ${lt.effectTarget.metricId}`);
  }
  for (const w of lt.effectTargetsWeighted ?? []) {
    if (isCluster(w.metricCategoryId, w.metricId)) {
      hits.push(`weighted ${w.metricId} (${w.weight})`);
    }
  }
  for (const opt of lt.policyOptions ?? []) {
    for (const e of opt.metricEffects ?? []) {
      if (isCluster(e.category, e.metricId)) hits.push(`option tick ${e.metricId}`);
    }
  }
  return hits;
}

describe("§4.7 social spending sweep (income/poverty cluster)", () => {
  const all = [
    ...legislationTypes,
    ...deLegislationTypes,
    ...cnLegislationTypes,
    ...ieLegislationTypes,
    ...jpLegislationTypes,
  ];

  it("no social-budget FUNDING law targets a cluster readout", () => {
    const offenders: string[] = [];
    for (const lt of all) {
      if (!lt.budgetCategory || !SOCIAL_BUDGET_KEYS.has(lt.budgetCategory)) continue;
      if (MECHANISM_KEEP_LIST.has(lt._id)) continue;
      for (const hit of clusterHits(lt)) offenders.push(`${lt._id} → ${hit}`);
    }
    expect(offenders, `cluster double-counts present:\n${offenders.join("\n")}`).toEqual([]);
  });
});
