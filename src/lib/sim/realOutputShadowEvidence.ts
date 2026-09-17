/**
 * Nominal-vs-shadow evidence for the issue-#1470 real-output experiment.
 *
 * Control/treatment comparison lives in the experiments report: the control
 * (flag off) carries NO shadow section at all, while the treatment (flag on)
 * carries per-region nominal sector growth beside the persisted constant-price
 * print, with explicit status semantics:
 *
 * - `ready`: the region printed a shadow growth this turn; `divergence`
 *   (nominal minus shadow) is the price/realization gap the experiment hunts.
 * - `cold-start`: the baseline is seeded but immature (or the current level
 *   was unusable and the baseline is held), so no print exists yet. Comparing
 *   nominal against a missing print would invent evidence; the status says so.
 * - `missing`: the region has no shadow baseline (flag just enabled, or the
 *   region predates the first flagged turn).
 *
 * The pure `buildRealOutputShadowEvidence` is the contract (pinned by tests);
 * the async `collectRealOutputShadowEvidence` is the reporting shell: three
 * batched reads (flag, states projection, macroMetrics projection), no
 * per-state reads, null when the flag is off.
 */

import type { Db } from "mongodb";
import { realOutputShadowDivergence } from "@/lib/turn/gdpGrowth";
import { isRealOutputShadowEnabled } from "@/lib/economy/realOutputShadow";
import { NATIONAL_SCOPE_IDS } from "@/lib/constants/nationalScope";

export type RealOutputShadowRegionStatus = "ready" | "cold-start" | "missing";

export interface RealOutputShadowRegionEvidence {
  stateId: string;
  countryId: string;
  /** Latest nominal sectorGrowth print (null when the region has none yet). */
  nominalSectorGrowth: number | null;
  /** Persisted constant-price print (null unless `ready`). */
  shadowGrowth: number | null;
  /** Nominal minus shadow (null unless both legs are present). */
  divergence: number | null;
  shadowUnits: number | null;
  shadowTurn: number | null;
  status: RealOutputShadowRegionStatus;
}

export interface RealOutputShadowEvidenceReport {
  turn: number;
  flagEnabled: true;
  ready: number;
  coldStart: number;
  missing: number;
  regions: RealOutputShadowRegionEvidence[];
}

export interface RealOutputShadowStateRow {
  _id: string;
  countryId: string;
  sectorRealOutputUnits?: number;
  sectorRealOutputUnitsTurn?: number;
  sectorRealOutputShadowGrowth?: number | null;
}

/**
 * Status of one region's shadow triple. `growth` must be a finite number for
 * `ready`: an explicit null (seeded baseline, held baseline) is cold-start,
 * never evidence.
 */
export function classifyRealOutputShadowRegion(input: {
  units?: number;
  turn?: number;
  growth?: number | null;
}): RealOutputShadowRegionStatus {
  const hasBaseline =
    typeof input.units === "number" &&
    Number.isFinite(input.units) &&
    typeof input.turn === "number" &&
    Number.isFinite(input.turn);
  if (!hasBaseline) return "missing";
  return typeof input.growth === "number" && Number.isFinite(input.growth) ? "ready" : "cold-start";
}

/**
 * Control/treatment evidence builder. Returns null for the control (flag off)
 * so the report carries no shadow section at all; the treatment gets one row
 * per real region (national-scope synthetic docs excluded, mirroring the
 * metric-engine phase that writes the fields) sorted by stateId.
 */
export function buildRealOutputShadowEvidence(input: {
  flagEnabled: boolean;
  turn: number;
  states: RealOutputShadowStateRow[];
  nominalByStateId: Map<string, number> | Record<string, number>;
}): RealOutputShadowEvidenceReport | null {
  if (!input.flagEnabled) return null;
  const nominal =
    input.nominalByStateId instanceof Map
      ? input.nominalByStateId
      : new Map(Object.entries(input.nominalByStateId));
  const regions: RealOutputShadowRegionEvidence[] = [];
  for (const state of input.states) {
    if (NATIONAL_SCOPE_IDS.has(state._id)) continue;
    const growth =
      typeof state.sectorRealOutputShadowGrowth === "number" &&
      Number.isFinite(state.sectorRealOutputShadowGrowth)
        ? state.sectorRealOutputShadowGrowth
        : null;
    const units =
      typeof state.sectorRealOutputUnits === "number" &&
      Number.isFinite(state.sectorRealOutputUnits)
        ? state.sectorRealOutputUnits
        : null;
    const shadowTurn =
      typeof state.sectorRealOutputUnitsTurn === "number" &&
      Number.isFinite(state.sectorRealOutputUnitsTurn)
        ? state.sectorRealOutputUnitsTurn
        : null;
    const nominalSectorGrowth = nominal.get(state._id) ?? null;
    regions.push({
      stateId: state._id,
      countryId: state.countryId,
      nominalSectorGrowth,
      shadowGrowth: growth,
      divergence: realOutputShadowDivergence(nominalSectorGrowth, growth),
      shadowUnits: units,
      shadowTurn,
      status: classifyRealOutputShadowRegion({
        units: units ?? undefined,
        turn: shadowTurn ?? undefined,
        growth,
      }),
    });
  }
  regions.sort((a, b) => a.stateId.localeCompare(b.stateId));
  return {
    turn: input.turn,
    flagEnabled: true,
    ready: regions.filter((r) => r.status === "ready").length,
    coldStart: regions.filter((r) => r.status === "cold-start").length,
    missing: regions.filter((r) => r.status === "missing").length,
    regions,
  };
}

/** Read the latest nominal sectorGrowth print per region (macroMetrics store). */
function nominalSectorGrowthByStateId(
  docs: Array<{ _id: string; economic?: { sectorGrowth?: { value?: unknown } } }>
): Map<string, number> {
  const out = new Map<string, number>();
  for (const doc of docs) {
    const value = doc.economic?.sectorGrowth?.value;
    if (typeof value === "number" && Number.isFinite(value)) out.set(doc._id, value);
  }
  return out;
}

/**
 * Reporting shell: null when the shadow flag is off (control runs report no
 * shadow section), otherwise the per-region evidence. Three batched reads, no
 * per-state reads.
 */
export async function collectRealOutputShadowEvidence(
  db: Db,
  turn: number
): Promise<RealOutputShadowEvidenceReport | null> {
  const config = await db
    .collection<{ _id: string; realOutputShadowEnabled?: unknown }>("gameConfig")
    .findOne({ _id: "default" as never }, { projection: { realOutputShadowEnabled: 1 } })
    .catch(() => null);
  if (!isRealOutputShadowEnabled(config)) return null;
  const [states, metrics] = await Promise.all([
    db
      .collection<RealOutputShadowStateRow>("states")
      .find({})
      .project<RealOutputShadowStateRow>({
        countryId: 1,
        sectorRealOutputUnits: 1,
        sectorRealOutputUnitsTurn: 1,
        sectorRealOutputShadowGrowth: 1,
      })
      .toArray(),
    db
      .collection<{ _id: string; economic?: { sectorGrowth?: { value?: unknown } } }>(
        "macroMetrics"
      )
      .find({})
      .project<{ _id: string; economic?: { sectorGrowth?: { value?: unknown } } }>({
        "economic.sectorGrowth.value": 1,
      })
      .toArray(),
  ]);
  return buildRealOutputShadowEvidence({
    flagEnabled: true,
    turn,
    states,
    nominalByStateId: nominalSectorGrowthByStateId(metrics),
  });
}
