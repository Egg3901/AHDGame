import { describe, expect, it } from "vitest";
import type { LegislationType } from "@/lib/db/types";
import { legislationTypes } from "./legislationTypes";
import { deLegislationTypes } from "../de/deLegislationTypes";
import { cnLegislationTypes } from "../cn/cnLegislationTypes";
import { ieLegislationTypes } from "../ie/ieLegislationTypes";
import { jpLegislationTypes } from "../jp/jpLegislationTypes";

// NOTE: reference `legislationTypes` already spreads the country files — dedupe
// by _id so count-sensitive checks (the socialCredit primaries) aren't doubled.
const all = [
  ...new Map(
    [
      ...legislationTypes,
      ...deLegislationTypes,
      ...cnLegislationTypes,
      ...ieLegislationTypes,
      ...jpLegislationTypes,
    ].map((lt) => [lt._id, lt] as const)
  ).values(),
];

function lawTargets(lt: LegislationType): Array<{ cat: string; id: string }> {
  const out: Array<{ cat: string; id: string }> = [];
  if (lt.effectTarget) {
    out.push({ cat: lt.effectTarget.metricCategoryId, id: lt.effectTarget.metricId });
  }
  for (const w of lt.effectTargetsWeighted ?? []) {
    out.push({ cat: w.metricCategoryId, id: w.metricId });
  }
  for (const opt of lt.policyOptions ?? []) {
    for (const e of opt.metricEffects ?? []) out.push({ cat: e.category, id: e.metricId });
  }
  return out;
}

/**
 * §4.7 country-indices sweep guards (P5).
 *
 * 1. CHANNEL: defense-budget FUNDING laws must not directly target the
 *    defense-channel readout (bundeswehrReadiness) — the booked spend already
 *    drives it. KEEP-LIST per law where a non-budget mechanism justifies it.
 * 2. ROOT-vs-READOUT (direct engine edges): publicTrust→devolutionSatisfaction,
 *    manufacturingCompetitiveness/rdIntensity→roboticsAdoption,
 *    migrationRate→directProvisionLoad. (independenceDesire is no longer an engine
 *    readout — it is owned by the drift engine — so it carries no root-pass-through.)
 */
const DEF_KEEP_LIST = new Map<string, Set<string>>([
  // P6a: the SERVICE MODEL (volunteer vs conscription) is manpower STRUCTURE
  // the defense spending channel cannot express — the recruitment acts'
  // militaryReadiness primaries encode it (their fiscal side still books
  // through the channel; overlap named for the balance pass).
  ["us_national_service", new Set(["militaryReadiness"])],
  ["uk_national_service", new Set(["militaryReadiness"])],
  ["de_wehrpflicht", new Set(["militaryReadiness"])],
  ["cn_conscription", new Set(["militaryReadiness"])],
  ["ie_defence_recruitment", new Set(["militaryReadiness"])],
  ["jp_jsdf_recruitment", new Set(["militaryReadiness"])],
]);

const ROOT_TO_READOUTS: Array<[string, string, string, Set<string>]> = [
  ["governance", "publicTrust", "governance", new Set(["devolutionSatisfaction"])],
  ["economic", "manufacturingCompetitiveness", "governance", new Set(["roboticsAdoption"])],
  ["economic", "rdIntensity", "governance", new Set(["roboticsAdoption"])],
  ["population", "migrationRate", "governance", new Set(["directProvisionLoad"])],
];

const PAIR_KEEP_LIST = new Map<string, Set<string>>([
  // AUTOMATION-POLICY mechanisms: AI/robotics strategy acts choose to automate
  // (the 🔧 half of roboticsAdoption) — distinct from the R&D/manufacturing
  // engine path their root secondaries feed.
  ["de_robotics_ai", new Set(["roboticsAdoption"])],
  ["cn_ai_strategy", new Set(["roboticsAdoption"])],
  // ASYLUM-SYSTEM structure: the law governs the direct-provision system
  // itself (capacity rules, processing) — not just the migration inflow root.
  ["ie_immigration_asylum", new Set(["directProvisionLoad"])],
]);

describe("§4.7 country indices sweep", () => {
  it("no defense-budget FUNDING law targets bundeswehrReadiness directly", () => {
    const offenders: string[] = [];
    for (const lt of all) {
      if (lt.budgetCategory !== "defense") continue;
      const allowed = DEF_KEEP_LIST.get(lt._id);
      for (const t of lawTargets(lt)) {
        if (
          (t.id === "bundeswehrReadiness" || t.id === "militaryReadiness") &&
          !allowed?.has(t.id)
        ) {
          offenders.push(`${lt._id} → ${t.id}`);
        }
      }
    }
    expect(offenders, `defense-channel double-counts:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("no law targets BOTH an index root and its engine-derived readout", () => {
    const offenders: string[] = [];
    for (const lt of all) {
      const targets = lawTargets(lt);
      const allowed = PAIR_KEEP_LIST.get(lt._id);
      for (const [rootCat, root, readCat, readouts] of ROOT_TO_READOUTS) {
        const hasRoot = targets.some((t) => t.cat === rootCat && t.id === root);
        if (!hasRoot) continue;
        for (const t of targets) {
          if (t.cat === readCat && readouts.has(t.id) && !allowed?.has(t.id)) {
            offenders.push(`${lt._id} → ${root} + ${t.id}`);
          }
        }
      }
    }
    expect(offenders, `root+readout pass-throughs:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("socialCreditCoverage wiring is consistent (audit-F1 downscope check)", () => {
    // 2 primary sites @1.0 (cn_internet_governance, cn_cybersecurity) + the
    // secondaries all carry sane |weight| ∈ (0, 1].
    const primaries: string[] = [];
    for (const lt of all) {
      for (const w of lt.effectTargetsWeighted ?? []) {
        if (w.metricId !== "socialCreditCoverage") continue;
        expect(Math.abs(w.weight), `${lt._id} socialCreditCoverage weight`).toBeGreaterThan(0);
        expect(Math.abs(w.weight), `${lt._id} socialCreditCoverage weight`).toBeLessThanOrEqual(1);
        if (Math.abs(w.weight) === 1) primaries.push(lt._id);
      }
    }
    expect(primaries.sort()).toEqual(["cn_cybersecurity", "cn_internet_governance"]);
  });
});
