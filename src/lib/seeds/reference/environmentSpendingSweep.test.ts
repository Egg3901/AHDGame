import { describe, expect, it } from "vitest";
import type { LegislationType } from "@/lib/db/types";
import { legislationTypes } from "./legislationTypes";
import { deLegislationTypes } from "../de/deLegislationTypes";
import { cnLegislationTypes } from "../cn/cnLegislationTypes";
import { ieLegislationTypes } from "../ie/ieLegislationTypes";
import { jpLegislationTypes } from "../jp/jpLegislationTypes";

/**
 * §4.7 environment spending sweep guard (P3c). carbonEmissions / airQuality /
 * energyTransitionProgress / floodRisk / agriEmissionsShare are ENGINE-DERIVED
 * (sector mix + renewables root + the environment spending channel —
 * registry/environment.ts), so an environment-budget FUNDING law that also
 * targets one of them directly double-counts. ROOTS (renewableEnergy,
 * recyclingRate, climateResilience, protectedLand, naturalDisaster-
 * preparedness, nuclearSafety) are NOT readouts — funding laws targeting roots
 * are the sub-allocation mechanism by design and stay.
 *
 * KEEP-LIST = per-law pinned allowed readouts (the P3b form) for mechanisms
 * the channel cannot express — justified per entry.
 */
const ENGINE_READOUTS = new Set([
  "carbonEmissions",
  "airQuality",
  "energyTransitionProgress",
  "floodRisk",
  "agriEmissionsShare",
]);

const ENV_BUDGET_KEYS = new Set(["environment"]);

const MECHANISM_KEEP_LIST = new Map<string, Set<string>>([
  // REGULATORY mandates: net-zero / sectoral emission TARGETS bind emitters
  // beyond what the budget channel can express. Their airQuality/transition
  // pass-through secondaries were dropped in the P3c sweep (engine-derived
  // from carbon / the renewables root).
  ["uk_climate_net_zero", new Set(["carbonEmissions"])],
  ["de_climate_targets", new Set(["carbonEmissions"])],
  ["jp_climate_emissions", new Set(["carbonEmissions"])],
  // COMPOSITION mechanism: the nuclear share displaces fossil generation — the
  // engine's carbon node only knows the RENEWABLES root, so nuclear's carbon
  // displacement is invisible to it; the direct secondary encodes it.
  ["de_nuclear_energy", new Set(["carbonEmissions"])],
  ["jp_nuclear_energy", new Set(["carbonEmissions"])],
  // SUB-ALLOCATION: local environmental services (street-level air programs,
  // green spaces, low-emission zones) act on LOCAL air quality beyond the
  // carbon path; floodRisk secondaries were dropped (they act through the
  // climateResilience root these laws already target).
  ["uk_regional_environment", new Set(["airQuality"])],
  ["jp_regional_environment", new Set(["airQuality"])],
]);

function tierHits(lt: LegislationType): string[] {
  const allowed = MECHANISM_KEEP_LIST.get(lt._id);
  const hits: string[] = [];
  const isViolation = (cat: string, id: string) =>
    cat === "environment" && ENGINE_READOUTS.has(id) && !allowed?.has(id);
  if (lt.effectTarget && isViolation(lt.effectTarget.metricCategoryId, lt.effectTarget.metricId)) {
    hits.push(`effectTarget ${lt.effectTarget.metricId}`);
  }
  for (const w of lt.effectTargetsWeighted ?? []) {
    if (isViolation(w.metricCategoryId, w.metricId)) {
      hits.push(`weighted ${w.metricId} (${w.weight})`);
    }
  }
  for (const opt of lt.policyOptions ?? []) {
    for (const e of opt.metricEffects ?? []) {
      if (isViolation(e.category, e.metricId)) hits.push(`option tick ${e.metricId}`);
    }
  }
  return hits;
}

describe("§4.7 environment spending sweep", () => {
  const all = [
    ...legislationTypes,
    ...deLegislationTypes,
    ...cnLegislationTypes,
    ...ieLegislationTypes,
    ...jpLegislationTypes,
  ];

  it("no environment-budget FUNDING law targets a tier readout", () => {
    const offenders: string[] = [];
    for (const lt of all) {
      if (!lt.budgetCategory || !ENV_BUDGET_KEYS.has(lt.budgetCategory)) continue;
      for (const hit of tierHits(lt)) offenders.push(`${lt._id} → ${hit}`);
    }
    expect(offenders, `tier double-counts present:\n${offenders.join("\n")}`).toEqual([]);
  });
});
