import type { Db } from "mongodb";
import { findMergedRegionMetrics, findMergedRegionMetricsMany } from "@/lib/macroMetrics/merge";
import type { State } from "@/lib/db/types";
import { getEraContext } from "@/lib/era/context";
import type { CountryId } from "@/lib/constants/countries";
import {
  BASE_APPROVAL,
  calculateStateApproval,
  loadElectorateGroups,
  weightingFor,
} from "@/lib/utils/governmentApproval";
import {
  isPoliticalApprovalCountry,
  loadPoliticalApprovalBases,
} from "@/lib/politicalLegislation/politicalApprovalProvider";

export interface MapApprovalState {
  approval: number;
  color: string;
  tooltip: string[];
}

function approvalToHeatColor(approval: number): string {
  const a = Math.max(0, Math.min(100, approval)) / 100;
  return lerpColor("#dc2626", "#22c55e", a);
}

function lerpColor(hex1: string, hex2: string, t: number): string {
  const r1 = parseInt(hex1.slice(1, 3), 16);
  const g1 = parseInt(hex1.slice(3, 5), 16);
  const b1 = parseInt(hex1.slice(5, 7), 16);
  const r2 = parseInt(hex2.slice(1, 3), 16);
  const g2 = parseInt(hex2.slice(3, 5), 16);
  const b2 = parseInt(hex2.slice(5, 7), 16);
  const r = Math.round(r1 + (r2 - r1) * t);
  const g = Math.round(g1 + (g2 - g1) * t);
  const b = Math.round(b1 + (b2 - b1) * t);
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

export async function computeApprovalMap(
  db: Db,
  countryId: CountryId
): Promise<Record<string, MapApprovalState>> {
  const [allMetrics, allStates, groupsByState, eraContext] = await Promise.all([
    // SP5: merged two-store view.
    findMergedRegionMetricsMany(db, { countryId }),
    db.collection<State>("states").find({ countryId }).toArray(),
    loadElectorateGroups(db, { countryId }),
    getEraContext(db),
  ]);
  // Era ruleset — matches the stored/displayed approval so the heatmap agrees
  // with the region hero under non-2019 presets (and under era-aware drift).
  const { preset, year } = eraContext;

  const stateMap = new Map(allStates.map((s) => [s._id, s]));

  const nationalAverages: Record<string, Record<string, number>> = {};
  const categories = [
    "economic",
    "education",
    "healthcare",
    "infrastructure",
    "publicSafety",
    "environment",
    "social",
    "governance",
    "population",
    "mediaInformation",
  ] as const;

  for (const cat of categories) {
    nationalAverages[cat] = {};
    const sample = allMetrics.find((m) => m[cat] != null);
    if (!sample) continue;
    for (const key of Object.keys(sample[cat] as object)) {
      const values = allMetrics
        .map((m) => (m[cat] as Record<string, { value: number }>)?.[key]?.value)
        .filter((v): v is number => v != null);
      if (values.length > 0) {
        nationalAverages[cat][key] = values.reduce((a, b) => a + b, 0) / values.length;
      }
    }
  }

  // SP4: playable countries color the heatmap from the hybrid political base.
  const politicalBases = isPoliticalApprovalCountry(countryId)
    ? await loadPoliticalApprovalBases(db, countryId)
    : null;

  const result: Record<string, MapApprovalState> = {};
  for (const m of allMetrics) {
    const stateId = m._id;
    const state = stateMap.get(stateId);
    const approval = calculateStateApproval(
      m,
      nationalAverages,
      [],
      weightingFor(groupsByState, countryId, String(stateId)),
      preset,
      year,
      isPoliticalApprovalCountry(countryId)
        ? (politicalBases?.byRegion.get(String(stateId)) ?? BASE_APPROVAL)
        : undefined
    );
    result[stateId] = {
      approval,
      color: approvalToHeatColor(approval),
      tooltip: [
        state?.name ?? stateId,
        `Government Approval: ${approval.toFixed(1)}%`,
        "Based on metrics vs national average",
      ],
    };
  }
  return result;
}
