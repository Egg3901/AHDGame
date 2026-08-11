import { describe, expect, it } from "vitest";
import type { LegislationType } from "@/lib/db/types";
import { legislationTypes } from "./legislationTypes";
import { deLegislationTypes } from "../de/deLegislationTypes";
import { cnLegislationTypes } from "../cn/cnLegislationTypes";
import { ieLegislationTypes } from "../ie/ieLegislationTypes";
import { jpLegislationTypes } from "../jp/jpLegislationTypes";

/**
 * §4.7 infrastructure spending sweep guard (P2c). The infrastructure metrics are
 * ENGINE-DERIVED (maintenance-decay on the infrastructure spending channel —
 * registry/infrastructure.ts), so an infrastructure-FUNDING law that also
 * targets one directly double-counts.
 *
 * KEEP-LIST = SUB-ALLOCATION mechanism (the P2b precedent): the channel only
 * knows TOTAL infrastructure spend — a Broadband Act / Transit Act / water act
 * picks WHICH infrastructure to build, which the channel cannot express.
 * Metric-specific acts therefore keep their direct effects; only GENERIC
 * whole-infrastructure funding acts are swept, and infrastructureInvestmentGap
 * (the channel's own needed-vs-actual readout) may not be targeted by anything.
 */
const SPEND_DRIVEN_INFRA_READOUTS = new Set([
  "roadCondition",
  "broadbandAccess",
  "publicTransit",
  "waterQuality",
  "powerGridReliability",
  "infrastructureInvestmentGap",
  "transportEfficiency",
]);

const SUB_ALLOCATION_KEEP_LIST = new Set<string>([
  // Each act picks WHICH infrastructure to build (broadband/rail/water/grid/
  // roads) — an allocation choice the total-spend channel cannot express. Their
  // infrastructureInvestmentGap secondaries WERE stripped (the gap rule below).
  "us_transportation",
  "uk_transport_rail",
  "uk_regional_transport",
  "uk_regional_utilities",
  "uk_energy_grid",
  "jp_rail_transport",
  "jp_regional_transport",
  "jp_regional_utilities",
  "jp_digital_infrastructure",
  "cn_rail_transport",
  "cn_digital_infrastructure",
  "uk_digital_broadband",
  "us_broadband_energy",
]);

function readoutHits(lt: LegislationType): string[] {
  const hits: string[] = [];
  if (
    lt.effectTarget?.metricCategoryId === "infrastructure" &&
    SPEND_DRIVEN_INFRA_READOUTS.has(lt.effectTarget.metricId)
  ) {
    hits.push(`effectTarget ${lt.effectTarget.metricId}`);
  }
  for (const w of lt.effectTargetsWeighted ?? []) {
    if (w.metricCategoryId === "infrastructure" && SPEND_DRIVEN_INFRA_READOUTS.has(w.metricId)) {
      hits.push(`weighted ${w.metricId} (${w.weight})`);
    }
  }
  for (const opt of lt.policyOptions ?? []) {
    for (const e of opt.metricEffects ?? []) {
      if (e.category === "infrastructure" && SPEND_DRIVEN_INFRA_READOUTS.has(e.metricId)) {
        hits.push(`option tick ${e.metricId}`);
      }
    }
  }
  return hits;
}

describe("§4.7 infrastructure spending sweep", () => {
  const all = [
    ...legislationTypes,
    ...deLegislationTypes,
    ...cnLegislationTypes,
    ...ieLegislationTypes,
    ...jpLegislationTypes,
  ];

  it("no generic infrastructure-FUNDING law targets a spend-driven infra readout", () => {
    const offenders: string[] = [];
    for (const lt of all) {
      if (lt.budgetCategory !== "infrastructure") continue;
      if (SUB_ALLOCATION_KEEP_LIST.has(lt._id)) continue;
      for (const hit of readoutHits(lt)) offenders.push(`${lt._id} → ${hit}`);
    }
    expect(offenders, `infrastructure double-counts present:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("NOTHING targets infrastructureInvestmentGap (the channel's own readout)", () => {
    const offenders: string[] = [];
    for (const lt of all) {
      const gapHits = readoutHits(lt).filter((h) => h.includes("infrastructureInvestmentGap"));
      for (const hit of gapHits) offenders.push(`${lt._id} → ${hit}`);
    }
    expect(offenders, `investment-gap targets present:\n${offenders.join("\n")}`).toEqual([]);
  });
});
