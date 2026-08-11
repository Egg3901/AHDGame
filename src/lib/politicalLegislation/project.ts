/**
 * Projection: typed PoliticalLaw → the legislationTypes doc shape the existing
 * bill pipeline consumes unmodified (design spec §6). New-generation docs carry
 * costModelV2 per option (program laws) or taxSlider (tax laws) — never the
 * legacy flat cost fields or old-generation effect fields.
 */

import type { LegislationPolicyOption, LegislationType } from "@/lib/db/types/legislation";
import { getFamily } from "../politicalMetrics/families";
import type { PoliticalMetricCategoryId } from "../politicalMetrics/types";
import { budgetKeyForLaw } from "./budgetKeys";
import type { LawLevel, PoliticalLaw } from "./types";

/**
 * §6 axis mapping: categories expressing lean on the economic axis (health and
 * education are spending programs first); the rest express it socially.
 */
const ECONOMIC_AXIS_CATEGORIES: ReadonlySet<PoliticalMetricCategoryId> = new Set([
  "economy",
  "infrastructure",
  "environment",
  "health",
  "education",
] as PoliticalMetricCategoryId[]);

const EFFECT_DIRECTION_LADDER = [-1, -1, 0, 1, 1] as const;

/**
 * Metric category → the PIPELINE's policyDomain vocabulary. The propose flows
 * filter types by CATEGORY_TO_POLICY_DOMAINS (bill category → domains), so a
 * projected doc must speak that vocabulary — raw category ids left `health`,
 * `order`, and `society` laws unproposable through every category filter
 * (audit follow-up). Tax laws use the dedicated "tax" domain/category.
 */
export const PIPELINE_POLICY_DOMAIN: Record<PoliticalMetricCategoryId, string> = {
  economy: "economy",
  education: "education",
  health: "healthcare",
  infrastructure: "infrastructure",
  order: "publicSafety",
  environment: "environment",
  society: "social",
  governance: "governance",
  defense: "defense",
};

function costModelV2For(level: LawLevel): NonNullable<LegislationPolicyOption["costModelV2"]> {
  const model: NonNullable<LegislationPolicyOption["costModelV2"]> = {};
  if (level.gdpCostFraction !== undefined) model.gdpCostFraction = level.gdpCostFraction;
  if (level.incomeCostFraction !== undefined) model.incomeCostFraction = level.incomeCostFraction;
  if (level.gdpRevenueFraction !== undefined) model.gdpRevenueFraction = level.gdpRevenueFraction;
  return model;
}

export function projectLawToLegislationType(law: PoliticalLaw): LegislationType {
  const countryScope = law.countryId.toLowerCase() as NonNullable<LegislationType["countryScope"]>;

  if (law.kind === "tax") {
    const tp = law.taxPolicy!;
    return {
      _id: law.id,
      name: law.title,
      description: law.description,
      policyDomain: "tax",
      subCategory: "tax",
      positions: [],
      countryScope,
      allowedScope: "national",
      politicalMetricTargets: [],
      taxSlider: { ...tp, waypoints: tp.waypoints.map((w) => ({ ...w })) },
      taxRateChange: {
        scope: tp.scope,
        taxType: tp.taxType as NonNullable<LegislationType["taxRateChange"]>["taxType"],
      },
      source: "seed",
    };
  }

  const lead = law.targets[0];
  const lean = getFamily(lead.metricId).lean;
  const axisIsEconomic = ECONOMIC_AXIS_CATEGORIES.has(law.category);

  const policyOptions: LegislationPolicyOption[] = law.levels!.map((level, index) => {
    // Level 0 = the lean-opposed pole, level 4 = the lean-aligned pole (§6):
    // value(level) = lean × (level − 2) / 2 — so a lean −5 law runs +5 → −5.
    // `|| 0` normalizes the −0 the multiplication produces at level 2.
    const value = (lean * (index - 2)) / 2 || 0;
    return {
      id: `l${index}`,
      name: level.name,
      ...(level.description ? { explanation: level.description } : {}),
      stance: value < 0 ? "left" : value > 0 ? "right" : "center",
      effectDirection: EFFECT_DIRECTION_LADDER[index],
      economic: axisIsEconomic ? value : 0,
      social: axisIsEconomic ? 0 : value,
      costModelV2: costModelV2For(level),
    };
  });

  return {
    _id: law.id,
    name: law.title,
    description: law.description,
    policyDomain: PIPELINE_POLICY_DOMAIN[law.category],
    subCategory: law.kind,
    positions: [],
    countryScope,
    allowedScope: law.allowedScope === "regional" ? "state" : law.allowedScope,
    budgetCategory: budgetKeyForLaw(law),
    politicalMetricTargets: law.targets.map((t) => ({ metricId: t.metricId, weight: t.weight })),
    policyOptions,
    source: "seed",
  };
}

/**
 * Generation discriminator (§5.1): a doc is new-generation iff it carries a
 * taxSlider (tax laws) or any option with costModelV2 (program laws).
 */
export function isNewGenerationType(
  doc: Pick<LegislationType, "taxSlider" | "policyOptions"> | null | undefined
): boolean {
  if (!doc) return false;
  if (doc.taxSlider) return true;
  return Boolean(doc.policyOptions?.some((o) => o.costModelV2 !== undefined));
}
