import type { Db, AnyBulkWriteOperation } from "mongodb";
import type { InfraProject } from "@/lib/db/types/infraProject";
import type { CountryId } from "@/lib/constants/countries";
import {
  aggregateInfra,
  getInfraArchetype,
  buildFundingDef,
  INFRA_EFFECT,
  INFRA_UPKEEP_UNIT,
  resolveInfraPosition,
} from "@/lib/constants/cabinetInfra";
import { getInfraProjectsCollection } from "@/lib/db/collections/infraProjects";
import { getCabinetMechanics } from "@/lib/constants/cabinetMechanics";
import { resolveMetricPath } from "@/lib/cabinet/resolveMetricPath";
import { resolveInfraEnvelope } from "./infraEnvelope";

/** Pure: an operational project's standing per-turn metric deltas ({} while building). */
export function computeProjectDeltas(project: InfraProject): Record<string, number> {
  if (project.status !== "operational") return {};
  const arch = getInfraArchetype(project.archetypeId);
  if (!arch) return {};
  const out: Record<string, number> = {};
  for (const [path, base] of Object.entries(arch.effects)) out[path] = base;
  return out;
}

/** Pure: advance a construction project's progress one turn at its funded speed. */
export function advanceProgress(
  project: Pick<InfraProject, "progress" | "buildDuration" | "fundingLevel">
): { progress: number; completed: boolean } {
  const next = +(project.progress + buildFundingDef(project.fundingLevel).speedMult).toFixed(4);
  return { progress: next, completed: next >= project.buildDuration };
}

/**
 * Turn step for one (country, transportation seat): advance construction progress
 * (flip to operational at duration, stamping completedTurn), emit operational
 * standing deltas → bucket.regional, and tilt national budgetBalance by committed
 * spend vs the transportation envelope. Read-only on the budget.
 */
export async function applyInfraEffects(
  db: Db,
  countryId: string,
  positionId: string,
  bucket: { national: Record<string, number>; regional: Record<string, Record<string, number>> },
  currentTurn: number
): Promise<void> {
  if (!resolveInfraPosition(countryId, positionId)) return;
  const mechanics = getCabinetMechanics(countryId, positionId);
  if (!mechanics) return;

  const col = getInfraProjectsCollection(db);
  const projects = await col.find({ countryId: countryId as CountryId, positionId }).toArray();
  if (projects.length === 0) return;

  const metrics = [...mechanics.nationalMetrics, ...mechanics.regionalMetrics];

  // 1. Operational standing effects → sited region.
  for (const p of projects) {
    const deltas = computeProjectDeltas(p);
    for (const [rawPath, v] of Object.entries(deltas)) {
      if (!v) continue;
      const path = resolveMetricPath(rawPath, metrics);
      (bucket.regional[p.regionId] ??= {})[path] = (bucket.regional[p.regionId][path] ?? 0) + v;
    }
  }

  // 2. National budget tilt — committed spend (millions) vs envelope (absolute → millions).
  const agg = aggregateInfra(projects);
  const envelopeM = (await resolveInfraEnvelope(db, countryId)) / INFRA_UPKEEP_UNIT;
  if (envelopeM > 0) {
    const gap = Math.max(-1, Math.min(1, (envelopeM - agg.committedSpend) / envelopeM));
    const bpath = resolveMetricPath("governance.budgetBalance", metrics);
    bucket.national[bpath] =
      (bucket.national[bpath] ?? 0) + +(gap * INFRA_EFFECT.budgetWeight).toFixed(4);
  }

  // 3. Advance construction progress; flip finished projects to operational.
  const ops: AnyBulkWriteOperation<InfraProject>[] = [];
  for (const p of projects) {
    if (p.status !== "construction") continue;
    const { progress, completed } = advanceProgress(p);
    ops.push({
      updateOne: {
        filter: { _id: p._id },
        update: completed
          ? { $set: { progress, status: "operational", completedTurn: currentTurn } }
          : { $set: { progress } },
      },
    });
  }
  if (ops.length) await col.bulkWrite(ops);
}
