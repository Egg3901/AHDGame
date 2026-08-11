import type { Db } from "mongodb";
import type { CabinetEstate, EstateFundingLevel } from "@/lib/db/types/cabinetEstate";
import type { CountryId } from "@/lib/constants/countries";
import {
  aggregateEstates,
  getEstateArchetype,
  fundingDef,
  TIER_MULTIPLIER,
  ESTATE_EFFECT,
  ESTATE_UPKEEP_UNIT,
  resolveEstatePortfolio,
} from "@/lib/constants/cabinetEstates";
import { getCabinetEstatesCollection } from "@/lib/db/collections/cabinetEstates";
import { getCabinetMechanics } from "@/lib/constants/cabinetMechanics";
import { resolveMetricPath } from "@/lib/cabinet/resolveMetricPath";
import { resolvePortfolioEnvelope } from "./portfolioEnvelope";

const CONDITION_DRIFT_STEP = 4;

/** Pure: one estate's per-turn metric deltas (caller routes by siteScope). */
export function computeEstateDeltas(estate: CabinetEstate): Record<string, number> {
  const arch = getEstateArchetype(estate.portfolioKey, estate.archetypeId);
  if (!arch) return {};
  const mult =
    TIER_MULTIPLIER[estate.tier] *
    fundingDef(estate.fundingLevel).outputMult *
    (estate.condition / 100);
  const out: Record<string, number> = {};
  for (const [path, base] of Object.entries(arch.effects)) {
    out[path] = +(base * mult).toFixed(4);
  }
  return out;
}

/** Move condition one bounded step toward its funding-level baseline. */
export function driftCondition(current: number, fundingLevel: EstateFundingLevel): number {
  const target = fundingDef(fundingLevel).conditionBaseline;
  if (current < target) return Math.min(target, current + CONDITION_DRIFT_STEP);
  if (current > target) return Math.max(target, current - CONDITION_DRIFT_STEP);
  return current;
}

/**
 * Turn step for one (country, seat): merge estate metric deltas into the shared
 * per-country bucket — domestic estates → regional[siteId]; foreign → national —
 * tilt national budgetBalance by upkeep-vs-envelope, and drift condition toward
 * the funding baseline. No-op for out-of-scope seats or zero estates. Read-only
 * on the federal budget. All deltas flow downstream through the capped pipeline.
 */
export async function applyEstateEffects(
  db: Db,
  countryId: string,
  positionId: string,
  bucket: { national: Record<string, number>; regional: Record<string, Record<string, number>> }
): Promise<void> {
  const portfolioKey = resolveEstatePortfolio(countryId, positionId);
  if (!portfolioKey) return;
  const mechanics = getCabinetMechanics(countryId, positionId);
  if (!mechanics) return;

  const col = getCabinetEstatesCollection(db);
  const estates = await col.find({ countryId: countryId as CountryId, positionId }).toArray();
  if (estates.length === 0) return;

  const metrics = [...mechanics.nationalMetrics, ...mechanics.regionalMetrics];

  for (const e of estates) {
    const deltas = computeEstateDeltas(e);
    for (const [rawPath, v] of Object.entries(deltas)) {
      if (!v) continue;
      const path = resolveMetricPath(rawPath, metrics);
      if (e.siteScope === "region") {
        (bucket.regional[e.siteId] ??= {})[path] = (bucket.regional[e.siteId][path] ?? 0) + v;
      } else {
        bucket.national[path] = (bucket.national[path] ?? 0) + v;
      }
    }
  }

  // Envelope tilt (national budgetBalance) — total upkeep vs the portfolio envelope.
  // Envelope is absolute currency; upkeep aggregate is in millions → normalize.
  const agg = aggregateEstates(estates);
  const envelope = await resolvePortfolioEnvelope(db, countryId, portfolioKey);
  const envelopeM = envelope / ESTATE_UPKEEP_UNIT;
  if (envelopeM > 0) {
    const gap = Math.max(-1, Math.min(1, (envelopeM - agg.totalUpkeep) / envelopeM));
    const bpath = resolveMetricPath("governance.budgetBalance", metrics);
    bucket.national[bpath] =
      (bucket.national[bpath] ?? 0) + +(gap * ESTATE_EFFECT.budgetWeight).toFixed(4);
  }

  // Condition drift.
  const ops = estates
    .map((e) => ({ e, next: driftCondition(e.condition, e.fundingLevel) }))
    .filter(({ e, next }) => next !== e.condition)
    .map(({ e, next }) => ({
      updateOne: { filter: { _id: e._id }, update: { $set: { condition: next } } },
    }));
  if (ops.length) await col.bulkWrite(ops);
}
