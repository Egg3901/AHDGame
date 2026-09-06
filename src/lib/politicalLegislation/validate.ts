/**
 * §10 catalog validators — pure, no db. Every rule returns a human-readable
 * error string naming the offending law id; an empty array means the catalog
 * is structurally valid.
 */

import { POLITICAL_METRIC_FAMILIES } from "../politicalMetrics/families";
import { SEED_TAX_RATES_1953, type SeedTaxType } from "./seedTaxRates";
import type { LawCountryId, LawLevel, PoliticalLaw } from "./types";

const GDP_FRACTION_MAX = 0.12;
const GDP_FRACTION_MAX_RU_INFRA = 0.35;
const INC_FRACTION_MAX = 0.08;
const REV_FRACTION_MAX = 0.1;
// Raised from 40 to admit the intelligence funding law (issue #1409). The bound that
// actually protects the dynamics engine is SECONDARY_TOUCHES below, which is unchanged:
// every metric must still be touched by 2-3 secondaries.
const SECONDARY_POOL = { min: 30, max: 41 };
const SECONDARY_TOUCHES = { min: 2, max: 3 };
const SECONDARY_WEIGHT = { min: 0.25, max: 0.6 };
const SECONDARY_TARGETS = { min: 2, max: 5 };
const GRID_EPS = 1e-9;

const YEAR_RE = /\b(19|20)\d{2}\b/;
const ANCHOR_RE = /₳/;
const CURRENT_RATE_RE = /current rate/i;

function onGrid(value: number, min: number, step: number): boolean {
  const k = (value - min) / step;
  return Math.abs(k - Math.round(k)) < GRID_EPS;
}

function copyErrors(law: PoliticalLaw): string[] {
  const errors: string[] = [];
  const strings: Array<[string, string]> = [
    ["title", law.title],
    ["description", law.description],
  ];
  if (law.reformTitle) strings.push(["reformTitle", law.reformTitle]);
  for (const [i, level] of (law.levels ?? []).entries()) {
    strings.push([`level ${i} name`, level.name], [`level ${i} description`, level.description]);
  }
  for (const wp of law.taxPolicy?.waypoints ?? []) {
    strings.push(["waypoint label", wp.label]);
  }
  for (const [where, text] of strings) {
    if (YEAR_RE.test(text)) errors.push(`${law.id}: calendar year in ${where} ("${text}")`);
    if (ANCHOR_RE.test(text)) errors.push(`${law.id}: anchor symbol ₳ in ${where}`);
    if (CURRENT_RATE_RE.test(text)) errors.push(`${law.id}: "current rate" phrasing in ${where}`);
  }
  return errors;
}

function levelFractionErrors(law: PoliticalLaw, countryId: LawCountryId): string[] {
  const errors: string[] = [];
  const levels = law.levels ?? [];
  // RU and DD front-load plan investment through the infrastructure category
  // (command economies) — both get the raised infra cap.
  const gdpMax =
    (countryId === "RU" || countryId === "DD") && law.category === "infrastructure"
      ? GDP_FRACTION_MAX_RU_INFRA
      : GDP_FRACTION_MAX;
  levels.forEach((level: LawLevel, index) => {
    if (index === 0) {
      if (
        level.gdpCostFraction !== undefined ||
        level.incomeCostFraction !== undefined ||
        level.gdpRevenueFraction !== undefined
      ) {
        errors.push(`${law.id}: level 0 must carry no cost or revenue terms`);
      }
      return;
    }
    if ((level.gdpCostFraction ?? 0) > gdpMax) {
      errors.push(`${law.id}: level ${index} gdpCostFraction ${level.gdpCostFraction} > ${gdpMax}`);
    }
    if ((level.incomeCostFraction ?? 0) > INC_FRACTION_MAX) {
      errors.push(
        `${law.id}: level ${index} incomeCostFraction ${level.incomeCostFraction} > ${INC_FRACTION_MAX}`
      );
    }
    if ((level.gdpRevenueFraction ?? 0) > REV_FRACTION_MAX) {
      errors.push(
        `${law.id}: level ${index} gdpRevenueFraction ${level.gdpRevenueFraction} > ${REV_FRACTION_MAX}`
      );
    }
  });
  return errors;
}

export function validateCatalog(laws: PoliticalLaw[], countryId: LawCountryId): string[] {
  const errors: string[] = [];
  const cc = countryId.toLowerCase();
  const metricIds = POLITICAL_METRIC_FAMILIES.map((f) => f.id);
  const metricIdSet = new Set<string>(metricIds);
  const seedRates = SEED_TAX_RATES_1953[countryId];

  // Id uniqueness + prefix/country consistency
  const seen = new Set<string>();
  for (const law of laws) {
    if (seen.has(law.id)) errors.push(`${law.id}: duplicate law id`);
    seen.add(law.id);
    if (!law.id.startsWith(`${cc}.`)) {
      errors.push(`${law.id}: id prefix does not match country ${countryId} (expected "${cc}.")`);
    }
    if (law.countryId !== countryId) {
      errors.push(`${law.id}: countryId field ${law.countryId} ≠ catalog country ${countryId}`);
    }
    errors.push(...copyErrors(law));
  }

  const primaries = laws.filter((l) => l.kind === "primary");
  const secondaries = laws.filter((l) => l.kind === "secondary");
  const taxLaws = laws.filter((l) => l.kind === "tax");

  // Exactly one primary per metric, id/target agreement
  const primaryByMetric = new Map<string, PoliticalLaw[]>();
  for (const law of primaries) {
    if (law.targets.length !== 1 || law.targets[0].weight !== 1) {
      errors.push(`${law.id}: primary must have exactly one target with weight 1`);
      continue;
    }
    const metricId = law.targets[0].metricId;
    if (law.id !== `${cc}.${metricId}.primary`) {
      errors.push(`${law.id}: primary id must be "${cc}.${metricId}.primary"`);
    }
    primaryByMetric.set(metricId, [...(primaryByMetric.get(metricId) ?? []), law]);
  }
  for (const metricId of metricIds) {
    const found = primaryByMetric.get(metricId) ?? [];
    if (found.length !== 1) {
      errors.push(`metric ${metricId}: expected exactly 1 primary, found ${found.length}`);
    }
  }

  // Secondary pool, targets, weights, coverage
  if (secondaries.length < SECONDARY_POOL.min || secondaries.length > SECONDARY_POOL.max) {
    errors.push(
      `secondary pool size ${secondaries.length} outside [${SECONDARY_POOL.min}, ${SECONDARY_POOL.max}]`
    );
  }
  const touches = new Map<string, number>(metricIds.map((id) => [id, 0]));
  for (const law of secondaries) {
    if (law.targets.length < SECONDARY_TARGETS.min || law.targets.length > SECONDARY_TARGETS.max) {
      errors.push(`${law.id}: secondary target count ${law.targets.length} outside [2, 5]`);
    }
    for (const target of law.targets) {
      if (!metricIdSet.has(target.metricId)) {
        errors.push(`${law.id}: unknown target metric ${target.metricId}`);
        continue;
      }
      if (target.weight < SECONDARY_WEIGHT.min || target.weight > SECONDARY_WEIGHT.max) {
        errors.push(
          `${law.id}: target ${target.metricId} weight ${target.weight} outside [0.25, 0.6]`
        );
      }
      touches.set(target.metricId, (touches.get(target.metricId) ?? 0) + 1);
    }
  }
  for (const [metricId, count] of touches) {
    if (count < SECONDARY_TOUCHES.min || count > SECONDARY_TOUCHES.max) {
      errors.push(`metric ${metricId}: touched by ${count} secondaries, expected [2, 3]`);
    }
  }

  // Program-law structure
  for (const law of [...primaries, ...secondaries]) {
    if (!law.levels || law.levels.length !== 5) {
      errors.push(`${law.id}: program law must have exactly 5 levels`);
      continue;
    }
    if (law.baselineLevel === undefined || law.baselineLevel < 0 || law.baselineLevel > 4) {
      errors.push(`${law.id}: baselineLevel missing or outside [0, 4]`);
    }
    if (law.taxPolicy) errors.push(`${law.id}: non-tax law must not carry taxPolicy`);
    errors.push(...levelFractionErrors(law, countryId));
  }

  // Tax laws (§10 slider rules)
  for (const law of taxLaws) {
    const tp = law.taxPolicy;
    if (!tp) {
      errors.push(`${law.id}: tax law missing taxPolicy`);
      continue;
    }
    if (law.targets.length > 0) errors.push(`${law.id}: tax law targets must be empty in v1`);
    if (law.levels) errors.push(`${law.id}: tax law must not carry levels`);
    if (law.baselineLevel !== undefined) {
      errors.push(`${law.id}: tax law must not carry baselineLevel`);
    }
    if (!(tp.taxType in seedRates)) {
      errors.push(`${law.id}: taxType ${tp.taxType} not a seeded FederalTaxRates key`);
      continue;
    }
    if (tp.step <= 0) errors.push(`${law.id}: step must be > 0`);
    if (!(tp.minRate <= tp.baselineRate && tp.baselineRate <= tp.maxRate)) {
      errors.push(`${law.id}: baselineRate ${tp.baselineRate} outside [min, max]`);
    }
    const seeded = seedRates[tp.taxType as SeedTaxType];
    if (tp.baselineRate !== seeded) {
      errors.push(
        `${law.id}: baselineRate ${tp.baselineRate} ≠ SEED_TAX_RATES_1953.${countryId}.${tp.taxType} (${seeded})`
      );
    }
    if (tp.step > 0) {
      if (!onGrid(tp.baselineRate, tp.minRate, tp.step)) {
        errors.push(
          `${law.id}: baselineRate ${tp.baselineRate} off the slider grid (step ${tp.step})`
        );
      }
      if (!onGrid(tp.maxRate, tp.minRate, tp.step)) {
        errors.push(`${law.id}: maxRate ${tp.maxRate} off the slider grid (step ${tp.step})`);
      }
      for (const wp of tp.waypoints) {
        if (wp.rate < tp.minRate || wp.rate > tp.maxRate) {
          errors.push(`${law.id}: waypoint ${wp.rate} outside bounds`);
        } else if (!onGrid(wp.rate, tp.minRate, tp.step)) {
          errors.push(`${law.id}: waypoint ${wp.rate} off the slider grid (step ${tp.step})`);
        }
      }
    }
  }

  return errors;
}
